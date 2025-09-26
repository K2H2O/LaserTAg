const WebSocket = require("ws");
const { parse } = require("url");
const { randomUUID } = require("crypto");
const appData = require("./app-data");
const fs = require('fs').promises;
const path = require('path');

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
    return preference ? preference.soundEnabled : false;
}

// Set player's sound preference
async function setPlayerSoundPreference(username, soundEnabled) {
    soundPreferences.set(username, {
        soundEnabled: soundEnabled,
        lastUpdated: new Date().toISOString(),
        username: username
    });
    
    await saveSoundPreferences();
    console.log(`Sound preference updated for ${username}: ${soundEnabled}`);
}

function sendToClients(session, message, sendToPlayers, sendToSpectators) {
    if (sendToPlayers) {
        for (let username in session.players) {
            const player = session.players[username];
            if (player.connection.readyState === WebSocket.OPEN) {
                player.connection.send(message);
            }
        }
    }
    if (sendToSpectators) {
        for (let id in session.spectators) {
            if (session.spectators[id].readyState === WebSocket.OPEN) {
                session.spectators[id].send(message);
            }
        }
    }
}

function getPlayerList(session) {
    return Object.keys(session.players).map((username) => {
        const { color, hitsGiven, hitsTaken, points, health, teamId } = session.players[username];
        return {
            username,
            color,
            hitsGiven,
            hitsTaken,
            points,
            health,
            teamId: session.mode === "team" ? teamId : undefined
        };
    });
}

function getTeams(session) {
    if (session.mode !== "team") return [];
    
    return Object.entries(session.teams || {}).map(([teamId, usernames]) => ({
        teamId,
        players: usernames.map((u) => {
            const p = session.players[u];
            if (!p) return null;
            return { 
                username: p.username, 
                color: p.color, 
                health: p.health, 
                points: p.points 
            };
        }).filter(p => p !== null),
    }));
}

function broadcastPlayerPositions(session) {
    const positions = Object.values(session.players)
        .filter(player => player.position.latitude !== null && player.position.longitude !== null)
        .map(player => ({
            username: player.username,
            color: player.color,
            teamId: session.mode === "team" ? player.teamId : null,
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

function broadcastPlayerList(session) {
    const isTeamMode = session.mode === "team";
    const messageData = {
        type: "playerListUpdate",
        admin: session.admin,
    };
    
    if (isTeamMode) {
        messageData.teams = getTeams(session);
    } else {
        messageData.playerList = getPlayerList(session);
    }
    
    sendToClients(session, JSON.stringify(messageData), true, true);
}

function handleHit(session, player, color, weapon) {
    if (color === 'cyan' || color === 'aqua') return; // invalid colors
    if (player.points <= 0 || player.health <= 10) return; // shooter eliminated

    // Find target player by color
    let target = null;
    for (let playerUsername in session.players) {
        if (session.players[playerUsername].color === color) {
            target = session.players[playerUsername];
            break;
        }
    }

    if (!target || target.points <= 0 || target.health <= 10 || target.activePowerups.invincibility > 0) {
        return;
    }

    // Team mode: prevent friendly fire
    if (session.mode === "team" && player.teamId === target.teamId) {
        return;
    }

    // Update health
    target.health = Math.max(0, target.health - 10);
    player.health = Math.min(100, player.health + 5); // smaller heal for balance

    // Update points
    if (player.activePowerups.instakill > 0) {
        let currentPoints = target.points;
        target.points = 0;
        player.points += Math.floor(currentPoints / 2);
    } else {
        const weaponDamages = {
            pistol: 6,
            sniper: 32,
            shotgun: 12,
        };
        const damage = weaponDamages[weapon] ?? 6;
        target.points = Math.max(0, target.points - damage);
        player.points += Math.floor(damage / 2);
    }

    // Update hit counters
    player.hitsGiven++;
    target.hitsTaken++;

    // Send hit notification
    sendToClients(
        session,
        JSON.stringify({
            type: "hit",
            player: player.username,
            target: target.username,
            weapon,
            targetHealth: target.health,
            targetPoints: target.points,
            shooterHealth: player.health,
            shooterPoints: player.points
        }),
        true,
        true
    );

    // Check for elimination
    let eliminationCause = null;
    if (target.health <= 10 && target.points <= 0) {
        eliminationCause = "health_and_points_depleted";
    } else if (target.health <= 10) {
        eliminationCause = "health_depleted";
    } else if (target.points <= 0) {
        eliminationCause = "points_depleted";
    }

    if (eliminationCause) {
        sendToClients(
            session,
            JSON.stringify({
                type: "elimination",
                player: target.username,
                weapon,
                cause: eliminationCause
            }),
            true,
            true
        );
    }
}

function attach(server) {
    const wss = new WebSocket.Server({ server });

    // Load sound preferences on startup
    loadSoundPreferences();

    // Game timer and session management
    setInterval(() => {
        for (let session of Object.values(appData.sessions)) {
            // Session persistence logic
            if (Object.keys(session.players).length === 0 && Object.keys(session.spectators).length === 0) {
                session.persistTime = (session.persistTime || appData.SESSION_PERSIST_TIME || 300) - 1;

                if (session.persistTime <= 0) {
                    delete appData.sessions[session.id];
                    console.log(`Session ${session.id} closed due to inactivity`);
                    continue;
                }
            } else {
                session.persistTime = appData.SESSION_PERSIST_TIME || 300;
            }

            if (session.state === "game") {
                session.timeLeft -= 1;
                const now = Date.now();
                const staleThreshold = 2 * 60 * 1000; // 2 minutes

                // Update player states and clean stale positions
                for (let player of Object.values(session.players)) {
                    // Set points to 0 for low health players
                    if (player.health <= 10 && player.points > 0) {
                        player.points = 0;
                    }

                    // Clean stale positions
                    if (player.position.lastUpdated && 
                        now - player.position.lastUpdated > staleThreshold) {
                        console.log(`Cleaning stale position for ${player.username}`);
                        player.position.latitude = null;
                        player.position.longitude = null;
                        player.position.lastUpdated = null;
                    }

                    // Handle powerups
                    for (let powerupId in player.activePowerups) {
                        if (player.activePowerups[powerupId] > 0) {
                            player.activePowerups[powerupId]--;
                        }
                    }

                    // Give new powerups (6% chance per second)
                    if (Math.random() < 0.06) {
                        const powerups = ['invincibility', 'instakill', 'healthBoost'];
                        const selectedPowerup = powerups[Math.floor(Math.random() * powerups.length)];
                        const powerupDuration = 10;

                        if (selectedPowerup === 'healthBoost') {
                            player.health = Math.min(100, player.health + 30);
                        } else {
                            player.activePowerups[selectedPowerup] = powerupDuration;
                        }

                        if (player.connection.readyState === WebSocket.OPEN) {
                            player.connection.send(JSON.stringify({
                                type: 'powerup',
                                powerup: selectedPowerup,
                                duration: powerupDuration
                            }));
                        }
                    }
                }

                // Send game update
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

                // End game if time is up
                if (session.timeLeft <= 0) {
                    session.state = "finished";
                    sendToClients(
                        session,
                        JSON.stringify({
                            type: "gameEnd",
                            finalScores: getPlayerList(session)
                        }),
                        true,
                        true
                    );
                }
            }
        }
    }, 1000);

    wss.on("connection", (ws, req) => {
        const { pathname, query } = parse(req.url, true);
        const parts = pathname.split("/").filter(Boolean);

        if (parts.length < 2) {
            ws.close(1000, "Invalid WebSocket path");
            return;
        }

        const [mode, sessionId] = parts;
        const isTeamMode = mode === "team-session";
        const isSoloMode = mode === "session";

        if (!isTeamMode && !isSoloMode) {
            ws.close(1000, "Unknown session type");
            return;
        }

        let session = appData.sessions[sessionId];
        if (!session) {
            session = appData.createSession(sessionId, isTeamMode ? "team" : "solo");
            console.log(`Created ${isTeamMode ? "team" : "solo"} session ${sessionId}`);
        }

        const isSpectator = parts.length === 3 && parts[2] === "spectator";
        const isColorCheck = parts.length === 3 && parts[2] === "check_color";

        // Color check logic
        if (isColorCheck) {
            ws.on("message", (msg) => {
                try {
                    const { color } = JSON.parse(msg);
                    const taken = Object.values(session.players).some((p) => p.color === color);
                    ws.send(JSON.stringify({ type: "colorResult", available: !taken }));
                } catch (error) {
                    console.error("Error in color check:", error);
                }
            });
            return;
        }

        // Spectator logic
        if (isSpectator) {
            const id = randomUUID();
            session.spectators[id] = ws;
            console.log(`Spectator connected to ${sessionId}`);

            ws.on("close", () => {
                delete session.spectators[id];
                console.log(`Spectator disconnected from ${sessionId}`);
            });
            return;
        }

        // PLAYER JOIN LOGIC
        let { username, color, team: teamId } = query;

        if (!username || !color || (isTeamMode && !teamId)) {
            ws.close(1000, "Missing player parameters");
            return;
        }

        // Ensure unique username
        let uniqueUsername = username;
        while (session.players[uniqueUsername]) {
            uniqueUsername += Math.floor(Math.random() * 10);
        }

        // Create player object
        session.players[uniqueUsername] = {
            connection: ws,
            username: uniqueUsername,
            color,
            teamId: isTeamMode ? teamId : null,
            hitsGiven: 0,
            hitsTaken: 0,
            points: 50,
            health: 100,
            activePowerups: {},
            position: {
                latitude: null,
                longitude: null,
                lastUpdated: null
            }
        };

        // Register player to team
        if (isTeamMode) {
            if (!session.teams) session.teams = {};
            if (!session.teams[teamId]) session.teams[teamId] = [];
            session.teams[teamId].push(uniqueUsername);
        }

        // Set admin if needed
        if (!session.admin) {
            session.admin = uniqueUsername;
            console.log(`Player ${uniqueUsername} made admin for session ${sessionId}`);
        }

        console.log(`Player ${uniqueUsername} joined ${isTeamMode ? 'team' : 'solo'} session ${sessionId}`);

        // Send sound preference
        const currentSoundPreference = getPlayerSoundPreference(uniqueUsername);
        ws.send(JSON.stringify({
            type: "soundPreference",
            soundEnabled: currentSoundPreference
        }));

        // Send initial updates
        sendToClients(
            session,
            JSON.stringify({
                type: "playerJoin",
                username: uniqueUsername,
            }),
            true,
            true
        );
        broadcastPlayerList(session);

        // Handle incoming messages
        ws.on("message", async (raw) => {
            let message;
            try {
                message = JSON.parse(raw);
            } catch (error) {
                console.error(`Error parsing message from ${uniqueUsername}:`, error);
                return;
            }

            const { type } = message;
            console.log(`Received ${type} from ${uniqueUsername}`);

            switch (type) {
                case "startGame":
                    if (uniqueUsername === session.admin) {
                        session.state = "game";
                        session.timeLeft = 180; // 3 minutes
                        sendToClients(
                            session,
                            JSON.stringify({
                                type: "startGame",
                                playerList: getPlayerList(session),
                                teams: isTeamMode ? getTeams(session) : undefined
                            }),
                            true,
                            true
                        );
                    }
                    break;

                case "hit":
                    const { color: hitColor, weapon } = message;
                    handleHit(session, session.players[uniqueUsername], hitColor, weapon);
                    break;

                case "cameraFrame":
                    const { frame, health } = message;
                    if (!session.latestFrames) session.latestFrames = {};
                    session.latestFrames[uniqueUsername] = frame;

                    // Update health from client
                    if (health !== undefined && session.players[uniqueUsername]) {
                        session.players[uniqueUsername].health = health;
                    }

                    // Send frames to spectators
                    const spectatorMessage = JSON.stringify({
                        type: "cameraFramesBatch",
                        frames: Object.entries(session.latestFrames).map(([user, frame]) => ({
                            username: user,
                            frame,
                            health: session.players[user]?.health || 100
                        })),
                    });
                    sendToClients(session, spectatorMessage, false, true);
                    break;

                case "forfeit":
                    console.log(`Player ${uniqueUsername} forfeited`);
                    if (session.players[uniqueUsername]) {
                        session.players[uniqueUsername].health = 0;
                        session.players[uniqueUsername].points = 0;
                    }
                    sendToClients(
                        session,
                        JSON.stringify({
                            type: "playerForfeited",
                            forfeitedPlayer: uniqueUsername,
                            message: `${uniqueUsername} has forfeited the game.`
                        }),
                        true,
                        true
                    );
                    broadcastPlayerList(session);
                    break;

                case "playerPosition":
                    const { latitude, longitude, timestamp } = message;
                    if (typeof latitude === 'number' && typeof longitude === 'number' &&
                        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
                        
                        if (session.players[uniqueUsername]) {
                            session.players[uniqueUsername].position = {
                                latitude: latitude,
                                longitude: longitude,
                                lastUpdated: timestamp || Date.now()
                            };
                            // Real-time position broadcast
                            broadcastPlayerPositions(session);
                        }
                    }
                    break;

                case "soundPreference":
                    const { soundEnabled } = message;
                    if (typeof soundEnabled === 'boolean') {
                        try {
                            await setPlayerSoundPreference(uniqueUsername, soundEnabled);
                            ws.send(JSON.stringify({
                                type: "soundPreferenceUpdated",
                                soundEnabled: soundEnabled,
                                success: true
                            }));
                        } catch (error) {
                            console.error(`Error saving sound preference for ${uniqueUsername}:`, error);
                            ws.send(JSON.stringify({
                                type: "soundPreferenceUpdated",
                                soundEnabled: soundEnabled,
                                success: false,
                                error: "Failed to save preference"
                            }));
                        }
                    }
                    break;

                case "getSoundPreference":
                    const currentPreference = getPlayerSoundPreference(uniqueUsername);
                    ws.send(JSON.stringify({
                        type: "soundPreference",
                        soundEnabled: currentPreference
                    }));
                    break;
            }
        });

        ws.on("close", () => {
            console.log(`Player ${uniqueUsername} disconnected from ${sessionId}`);
            
            // Remove from session
            delete session.players[uniqueUsername];

            // Remove from team
            if (isTeamMode && session.teams && session.teams[teamId]) {
                session.teams[teamId] = session.teams[teamId].filter(u => u !== uniqueUsername);
                if (session.teams[teamId].length === 0) {
                    delete session.teams[teamId];
                }
            }

            // Update admin
            if (session.admin === uniqueUsername) {
                session.admin = Object.keys(session.players)[0] || null;
            }

            // Notify others
            sendToClients(
                session,
                JSON.stringify({
                    type: "playerQuit",
                    username: uniqueUsername,
                }),
                true,
                true
            );
            broadcastPlayerList(session);
        });
    });
}

module.exports = { attach, loadSoundPreferences };