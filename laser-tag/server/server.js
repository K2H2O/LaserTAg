const http = require("http");
const WebSocket = require("ws");
const { randomUUID } = require("crypto");
const { parse } = require("url");
const appData = require("./app-data");
const fs =require('fs').promises;
const path =require('path');
const { send } = require("process");
const { type } = require("os");

const server = http.createServer();
const wss = new WebSocket.Server({ server });


// Sound preferences storage
let soundPreferences = new Map();
const SOUND_PREFERENCES_FILE = path.join(__dirname, 'sound_preferences.json');

// Load sound preferences from file on server start
async function loadSoundPreferences() {
    try {
        const data = await fs.readFile(SOUND_PREFERENCES_FILE, 'utf8');
        const preferences = JSON.parse(data);
        soundPreferences = new Map(Object.entries(preferences));
        console.log('Sound preferences loaded from file');
    } catch (error) {
        console.log('No existing sound preferences file found, starting fresh');
    }
}

// Save sound preferences to file
async function saveSoundPreferences() {
    try {
        const preferences = Object.fromEntries(soundPreferences);
        await fs.writeFile(SOUND_PREFERENCES_FILE, JSON.stringify(preferences, null, 2));
        console.log('Sound preferences saved to file');
    } catch (error) {
        console.error('Error saving sound preferences:', error);
    }
}

// Get player's sound preference
function getPlayerSoundPreference(username) {
    const preference = soundPreferences.get(username);
    return preference ? preference.soundEnabled : false; // Default to sound off
}

// Set player's sound preference
async function setPlayerSoundPreference(username, soundEnabled) {
    soundPreferences.set(username, {
        soundEnabled: soundEnabled,
        lastUpdated: new Date().toISOString(),
        username: username
    });
    
    // Save to file for persistence
    await saveSoundPreferences();
    
    console.log(`Sound preference updated for ${username}: ${soundEnabled}`);
}
/*
    Kill messages e.g. player1 killed player2
    Leaderboard updates
*/

function sendToClients(session, message, sendToPlayers, sendToSpectators) {
    if (sendToPlayers) {
        for (let username in session.players) {
            const player = session.players[username];
            player.connection.send(message);
        }
    }
    if (sendToSpectators) {
        for (let id in session.spectators) {
            session.spectators[id].send(message);
        }
    }
}
 //new things added for health
function getPlayerList(session) {
    return Object.keys(session.players).map((username) => {
        const { color, hitsGiven, hitsTaken, points , health } = session.players[username];
        return {
            username,
            color,
            hitsGiven,
            hitsTaken,
            points,
            health

        };
    })
}
// new function for the map
function broadcastPlayerPositions(session) {
    const positions = Object.values(session.players)
        .filter(player => player.position.latitude !== null && player.position.longitude !== null)
        .map(player => ({
            username: player.username,
            color: player.color,
            latitude: player.position.latitude,
            longitude: player.position.longitude,
            lastUpdated: player.position.lastUpdated
        }));

    const message = JSON.stringify({
        type: "playerPositions",
        positions: positions
    });

    sendToClients(session, message, true, true);
}

// game timers, information updates, session closing
setInterval(() => {
    for (let session of Object.values(appData.sessions)) {
        // check if should close session
        if (Object.keys(session.players).length === 0 && Object.keys(session.spectators).length) {
            session.persistTime -= 1;

            if (session.persistTime <= 0) {
                delete appData.sessions[session.id];
                console.info(`Session ${session.id} closed`);

                sendToClients(
                    session,
                    JSON.stringify({
                        type: "sessionClose",
                    }),
                    false,
                    true
                );

                return;
            }
        } else {
            session.persistTime = appData.SESSION_PERSIST_TIME;
        }
        if (session.state === "game") {
            session.timeLeft -= 1;

             const now =Date.now();
             const staleThreshold = 2*60*1000;

            //for players with low health 
            for (let player of Object.values(session.players)){
                if(player.health <= 10 && player.points >0){
                    player.points=0; 
                }
                if (player.position.lastUpdated && 
                    now - player.position.lastUpdated > staleThreshold) {
                    console.info(`Cleaning stale position for ${player.username}`);
                    player.position.latitude = null;
                    player.position.longitude = null;
                    player.position.lastUpdated = null;
                }
                
            }
            sendToClients(
                session,
                JSON.stringify({
                    type: "gameUpdate",
                    timeLeft: session.timeLeft,
                    players: getPlayerList(session),
                }),
                true,
                true
            );

            if (session.timeLeft <= 0) {
                session.state = "finished";
            } else {
                // powerups
                const powerups = ['invincibility', 'instakill','healthBoost'] // new added health boost
                for (let player of Object.values(session.players)) {
                    // decrease durations
                    for (let powerupId in player.activePowerups) {
                        let v = player.activePowerups[powerupId]
                        if (v > 0) player.activePowerups[powerupId]--
                        console.log(`powerup ${powerupId}: ${player.activePowerups[powerupId]}`)
                    }

                    // give new
                    if (Math.random() < 0.06) {
                        const powerups =['invincibility', 'instakill','healthBoost'] // new added health boost
                        const selectedPowerup = powerups[Math.floor(Math.random() * powerups.length)]
                        const powerupDuration = 10
                        
                        // handle health boost powerup
                        if(selectedPowerup === 'healthBoost'){
                            player.health = Math.min(100 , player.health +30);

                        }
                        else{
                           player.activePowerups[selectedPowerup] = powerupDuration
                        }
                        
                        player.connection.send(JSON.stringify({
                            type: 'powerup',
                            powerup: selectedPowerup,
                            duration: powerupDuration
                        }));
                    }
                }
            // broadcast player positions every 5 seconds during the game 
                if (session.timeLeft % 5 === 0) {
                broadcastPlayerPositions(session);
            }
                sendToClients(
                    session,
                    JSON.stringify({
                        type: "gameUpdate",
                        timeLeft: session.timeLeft,
                        players: getPlayerList(session),
                    }),
                    true,
                    true
                );
                if(session.timeLeft <= 0){
                    session.state="finished";
                }
            }
        }
    }
}, 1000);

wss.on("connection", (ws, req) => {
    const { pathname, query } = parse(req.url, true);
    const pathnameParts = pathname.split("/");

    if (pathnameParts.length < 3 || pathnameParts[1] !== "session") {
        ws.close(1000, "Invalid session URL");
        return;
    }

    const sessionId = pathnameParts[2];
    let session = appData.sessions[sessionId];

    // color checking
    if (pathnameParts.length === 4 && pathnameParts[3] === "check_color") {
        ws.on("message", (message) => {
            const { color } = JSON.parse(message);
            let colorAvailable = true

            if (session != null) {
                // check if color is used
                for (let player of Object.values(session.players)) {
                    if (player.color === color) {
                        colorAvailable = false;
                        break;
                    }
                }
            }

            console.info(`Checking color availability for ${color}: ${colorAvailable ? 'available' : 'unavailable'}`)
            ws.send(JSON.stringify({
                type: 'colorResult',
                available: colorAvailable
            }));
        });

        return
    }

    const isSpectator = pathnameParts.length === 4 && pathnameParts[3] === "spectator";

    // create a new session if it doesn't exist
    if (session == null) {
        session = appData.createSession(sessionId);
        console.info(`Session ${sessionId} created`);
    }
    if (isSpectator) {
        console.info(`Spectator connected to session ${sessionId}`);

        // add spectator to session
        const spectatorId = randomUUID();
        session.spectators[spectatorId] = ws;

        ws.on("close", () => {
            // remove spectator from session
            console.info(`Spectator disconnected from session ${sessionId}`);
            delete session.spectators[spectatorId];
        });
    } else {
        let { color, username } = query;

        if (color == null || color.trim() === '' || username == null || username.trim() === "") {
            ws.close(1000, "Username and color is required");
            return;
        }

        // generate a new username if it already exists in the session
        while (Object.keys(session.players).includes(username)) {
            const randomSuffix = Math.floor(Math.random() * 10);
            username += randomSuffix;
        }

        console.info(`Player ${username} connected to session ${sessionId}`);

        // set admin if no admin exists
        if (session.admin == null) {
            console.info(`Player ${username} was made admin for session ${sessionId}`);
            session.admin = username;
        }

        // add player to session
        session.players[username] = {
            connection: ws,
            username,
            color,
            hitsGiven: 0,
            hitsTaken: 0,
            points: 50,
            health: 100,
            activePowerups: {},
            position :{
                latitude : null,
                longitude : null,
                lastUpdated: null
            }
        };


        // Send the player their current sound preference when they connect
        const currentSoundPreference = getPlayerSoundPreference(username);
        ws.send(JSON.stringify({
            type: "soundPreference",
            soundEnabled: currentSoundPreference
        }));

        // send player joined message
        sendToClients(
            session,
            JSON.stringify({
                type: "playerJoin",
                username,
            }),
            true,
            true
        );
        sendToClients(
            session,
            JSON.stringify({
                type: "playerListUpdate",
                admin: session.admin,
                playerList: getPlayerList(session),
            }),
            true,
            true
        );

        ws.on("message", async (message) => {
            try {
                message = JSON.parse(message);
            } catch (error) {
                console.error(
                    `Error processing message from client ${username}:`,
                    error
                );
                return;
            }

            console.info(`Received message from client ${username}:`, message);

            const { type } = message;

            if (type === "hit") {
                const { color, weapon } = message;
                handleHit(session, session.players[username], color, weapon);
            } else if (type === "startGame") {
                session.state = "game";
                session.timeLeft = 3 * 60;
                sendToClients(
                    session,
                    JSON.stringify({
                        type: "startGame",
                        playerList: getPlayerList(session),
                    }),
                    true,
                    true
                );
            } else if (type === "cameraFrame") {
                const { frame , health } = message; // health message here
                session.latestFrames[username] = frame;

                // update players health from client 
                if(health != undefined && session.players[username]){
                    session.players[username].health = health;
                }

                // Send all frames to spectators
                const spectatorMessage = JSON.stringify({
                    type: "cameraFramesBatch",
                    frames: Object.entries(session.latestFrames).map(([user, frame]) => ({
                        username: user,
                        frame,
                        health: session.players[user]?.health ||100 // send players health to spectator data.
                    })),
                });

                sendToClients(session, spectatorMessage, false, true);
            }
            else if (type === "forfeit"){
                console.info(`Player ${username} has forfeited the game.`);
                if (session.players[username]){
                    session.players[username].health =0;
                    session.players[username].points =0;
                }
                // notify other players
                sendToClients(
                    session,
                    JSON.stringify({
                        type:"playerForfeited",
                        forfeitedPlayer: username,
                        message: `${username} has forfeited the game.`
                    }),
                    true,
                    true
                    
                );
                sendToClients(
                    session,
                    JSON.stringify({
                        type: "gameUpdate",
                        admin: session.timeLeft,
                        playerList: getPlayerList(session),
                    }),
                    true,
                    true
                );
            }
            else if (type === "playerPosition") {
    const { latitude, longitude, timestamp } = message;
    
    // Validate coordinates
    if (typeof latitude === 'number' && typeof longitude === 'number' &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        
        // Update player position
        if (session.players[username]) {
            session.players[username].position = {
                latitude: latitude,
                longitude: longitude,
                lastUpdated: timestamp || Date.now()
            };
            
            console.info(`Updated position for ${username}: ${latitude}, ${longitude}`);
            
            // Broadcast updated positions to all players
            broadcastPlayerPositions(session);
        }
    } else {
        console.warn(`Invalid coordinates from ${username}: ${latitude}, ${longitude}`);
    }
}
       //  Handle sound preference updates
            else if (type === "soundPreference") {
                const { soundEnabled } = message;
                
                if (typeof soundEnabled === 'boolean') {
                    try {
                        await setPlayerSoundPreference(username, soundEnabled);
                        
                        // Confirm the preference change back to the player
                        ws.send(JSON.stringify({
                            type: "soundPreferenceUpdated",
                            soundEnabled: soundEnabled,
                            success: true
                        }));
                        
                        // Optional: Notify other players in the session about the sound preference change
                        // (you can remove this if you don't want other players to see sound preferences)
                        sendToClients(
                            session,
                            JSON.stringify({
                                type: "playerSoundPreferenceChanged",
                                username: username,
                                soundEnabled: soundEnabled
                            }),
                            true,
                            false // Don't send to spectators
                        );
                        
                    } catch (error) {
                        console.error(`Error saving sound preference for ${username}:`, error);
                        
                        ws.send(JSON.stringify({
                            type: "soundPreferenceUpdated",
                            soundEnabled: soundEnabled,
                            success: false,
                            error: "Failed to save preference"
                        }));
                    }
                } else {
                    console.warn(`Invalid sound preference from ${username}: ${soundEnabled}`);
                    
                    ws.send(JSON.stringify({
                        type: "soundPreferenceUpdated",
                        soundEnabled: soundEnabled,
                        success: false,
                        error: "Invalid sound preference value"
                    }));
                }
            }
            // NEW: Handle sound preference requests (when player wants to know their current preference)
            else if (type === "getSoundPreference") {
                const currentPreference = getPlayerSoundPreference(username);
                ws.send(JSON.stringify({
                    type: "soundPreference",
                    soundEnabled: currentPreference
                }));
            }
        });

        ws.on("close", () => {
            console.info(`Player ${username} disconnected from session ${sessionId}`);

            // remove player from session
            delete session.players[username];

            // check if admin left
            if (session.admin === username) {
                session.admin =
                    Object.keys(session.players).length > 0
                        ? Object.keys(session.players)[0]
                        : null; // pick new admin
            }

            // send player quit message
            sendToClients(
                session,
                JSON.stringify({
                    type: "playerQuit",
                    username,
                }),
                true,
                true
            );
            sendToClients(
                session,
                JSON.stringify({
                    type: "playerListUpdate",
                    admin: session.admin,
                    playerList: getPlayerList(session),
                }),
                true,
                true
            );
        });
    }
});

function handleHit(session, player, color, weapon) {
    if (color === 'cyan') return // invalid color
    if (player.points <= 0) return // already eliminated
    if(player.health <= 10) return // already eliminated

    // get target player from color
    let target;

    for (let playerUsername in session.players) {
        if (session.players[playerUsername].color === color) {
            target = session.players[playerUsername];
            break;
        }
    }

    if (!target || target.points <= 0 || target.activePowerups.invincibility > 0) return;
    if(!target || target.health <= 10 || target.activePowerups.invincibility > 0) return; // for health

    target.health = Math.max(0, target.health - 10); // decrease health by 10 on each hit
    player.health = Math.min(100, player.health + 10); // increase health by 10 on each hit, max 100

    // update points
    if (player.activePowerups.instakill > 0) {
        // has instakill powerup
        let currentPoints = target.points
        target.points = 0
        player.points += Math.floor(currentPoints / 2)
    } else {
        const weaponDamages = {
            pistol: 6,
            sniper: 32,
            shotgun: 12,
        };
        const damage = weaponDamages[weapon] ?? 0;
        target.points = Math.max(0, target.points - damage)
        player.points += Math.floor(damage / 2)
    }

    // update hits
    player.hitsGiven++
    target.hitsTaken++

    sendToClients(
        session,
        JSON.stringify({
            type: "hit",
            player: player.username,
            target: target.username,
            weapon,
            targetHealth: target.health,
            shooterHealth: player.health // new added
        }),
        true,
        true
    );
    // elimination based on health
    if (target.health <= 10)
        sendToClients(
            session,
            JSON.stringify({
                type: "elimination",
                player: target.username,
                weapon,
                cause:"health_depleted"
            }),
            true,
            true    
    );

    if (target.points <= 0) {
        sendToClients(
            session,
            JSON.stringify({
                type: "elimination",
                player: target.username,
                weapon,
                cause : "points_depleted"
            }),
            true,
            true
        );
    }
}

function start(port) {
    server.listen(port, () => {
        console.info(`WebSocket server running on port ${port}`);
        console.info('Sound preferences system initialized');
    });
}

module.exports = { start };





// NEW: Modified game timer logic (in the main setInterval)
// Add health checking to the existing timer logic: