const WebSocket = require("ws");
const { parse } = require("url");
const { randomUUID } = require("crypto");
const appData = require("./app-data");
const fs = require("fs").promises;
const path = require("path");


const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Sound preferences storage
let soundPreferences = new Map();
const SOUND_PREFERENCES_FILE = path.join(__dirname, "sound_preferences.json");

// Load sound preferences from file on server start
async function loadSoundPreferences() {
  try {
    const data = await fs.readFile(SOUND_PREFERENCES_FILE, "utf8");
    const preferences = JSON.parse(data);
    soundPreferences = new Map(Object.entries(preferences));
    console.log("Sound preferences loaded from file");
  } catch (error) {
    console.log("No existing sound preferences file found, starting fresh");
  }
}

// Save sound preferences to file
async function saveSoundPreferences() {
  try {
    const preferences = Object.fromEntries(soundPreferences);
    await fs.writeFile(SOUND_PREFERENCES_FILE, JSON.stringify(preferences, null, 2));
    console.log("Sound preferences saved to file");
  } catch (error) {
    console.error("Error saving sound preferences:", error);
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
    username: username,
  });
  await saveSoundPreferences();
  console.log(`Sound preference updated for ${username}: ${soundEnabled}`);
}

function attach(server) {
  const wss = new WebSocket.Server({ server });

  // Load sound preferences when the server starts
  loadSoundPreferences();

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
      console.log(`🆕 Created ${isTeamMode ? "team" : "solo"} session ${sessionId}`);
    }

    const isSpectator = parts.length === 3 && parts[2] === "spectator";
    const isColorCheck = parts.length === 3 && parts[2] === "check_color";

    if (isColorCheck) {
      ws.on("message", (msg) => {
        try {
          const { color } = JSON.parse(msg);
          const taken = Object.values(session.players).some((p) => p.color === color);
          ws.send(JSON.stringify({ type: "colorResult", available: !taken }));
          console.info(`Checking color availability for ${color}: ${!taken ? "available" : "unavailable"}`);
        } catch (error) {
          console.error("Error processing color check message:", error);
        }
      });
      return;
    }

    if (isSpectator) {
      const id = randomUUID();
      session.spectators[id] = ws;
      console.log(`👁️ Spectator connected to ${sessionId}`);

      ws.on("close", () => {
        delete session.spectators[id];
        console.log(`👁️ Spectator disconnected from ${sessionId}`);
      });
      return;
    }

    // PLAYER JOIN LOGIC
    const { username, color, team: teamId } = query;

    if (!username || !color || (isTeamMode && !teamId)) {
      ws.close(1000, "Missing player parameters");
      return;
    }

    let uniqueUsername = username;
    while (session.players[uniqueUsername]) {
      uniqueUsername += Math.floor(Math.random() * 10);
    }

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
        lastUpdated: null,
      },
    };

    if (isTeamMode) {
      if (!session.teams[teamId]) session.teams[teamId] = [];
      session.teams[teamId].push(uniqueUsername);
    }

    if (!session.admin) session.admin = uniqueUsername;

    console.log(`🎮 Player ${uniqueUsername} joined session ${sessionId}`);

    // Send the player their current sound preference
    const currentSoundPreference = getPlayerSoundPreference(uniqueUsername);
    ws.send(
      JSON.stringify({
        type: "soundPreference",
        soundEnabled: currentSoundPreference,
      })
    );

    // Send player join message
    sendToAll(
      session,
      JSON.stringify({
        type: "playerJoin",
        username: uniqueUsername,
      })
    );
    broadcastPlayerList(session);

    ws.on("message", async (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        console.error(`Error processing message from client ${uniqueUsername}:`, error);
        return;
      }

      const { type } = message;

      if (type === "startGame") {
        session.state = "game";
        session.timeLeft = 180;
        sendToAll(
          session,
          JSON.stringify({
            type: "startGame",
            playerList: getPlayerList(session),
          })
        );
      } else if (type === "hit") {
        const { color, weapon } = message;
        handleHit(session, session.players[uniqueUsername], color, weapon);
      } else if (type === "cameraFrame") {
        const { frame, health } = message;
        session.latestFrames[uniqueUsername] = frame;

        if (health !== undefined && session.players[uniqueUsername]) {
          session.players[uniqueUsername].health = health;
        }

        const spectatorMessage = JSON.stringify({
          type: "cameraFramesBatch",
          frames: Object.entries(session.latestFrames).map(([user, frame]) => ({
            username: user,
            frame,
            health: session.players[user]?.health || 100,
          })),
        });
        sendToClients(session, spectatorMessage, false, true);
      } else if (type === "forfeit") {
        console.info(`Player ${uniqueUsername} has forfeited the game.`);
        if (session.players[uniqueUsername]) {
          session.players[uniqueUsername].health = 0;
          session.players[uniqueUsername].points = 0;
        }
        sendToClients(
          session,
          JSON.stringify({
            type: "playerForfeited",
            forfeitedPlayer: uniqueUsername,
            message: `${uniqueUsername} has forfeited the game.`,
          }),
          true,
          true
        );
        broadcastPlayerList(session);
      } else if (type === "playerPosition") {
        const { latitude, longitude, timestamp } = message;
        if (
          typeof latitude === "number" &&
          typeof longitude === "number" &&
          latitude >= -90 &&
          latitude <= 90 &&
          longitude >= -180 &&
          longitude <= 180
        ) {
          if (session.players[uniqueUsername]) {
            session.players[uniqueUsername].position = {
              latitude: latitude,
              longitude: longitude,
              lastUpdated: timestamp || Date.now(),
            };
            console.info(`Updated position for ${uniqueUsername}: ${latitude}, ${longitude}`);
            broadcastPlayerPositions(session);
          }
        } else {
          console.warn(`Invalid coordinates from ${uniqueUsername}: ${latitude}, ${longitude}`);
        }
      } else if (type === "soundPreference") {
        const { soundEnabled } = message;
        if (typeof soundEnabled === "boolean") {
          try {
            await setPlayerSoundPreference(uniqueUsername, soundEnabled);
            ws.send(
              JSON.stringify({
                type: "soundPreferenceUpdated",
                soundEnabled: soundEnabled,
                success: true,
              })
            );
            sendToClients(
              session,
              JSON.stringify({
                type: "playerSoundPreferenceChanged",
                username: uniqueUsername,
                soundEnabled: soundEnabled,
              }),
              true,
              false
            );
          } catch (error) {
            console.error(`Error saving sound preference for ${uniqueUsername}:`, error);
            ws.send(
              JSON.stringify({
                type: "soundPreferenceUpdated",
                soundEnabled: soundEnabled,
                success: false,
                error: "Failed to save preference",
              })
            );
          }
        } else {
          console.warn(`Invalid sound preference from ${uniqueUsername}: ${soundEnabled}`);
          ws.send(
            JSON.stringify({
              type: "soundPreferenceUpdated",
              soundEnabled: soundEnabled,
              success: false,
              error: "Invalid sound preference value",
            })
          );
        }
      } else if (type === "getSoundPreference") {
        const currentPreference = getPlayerSoundPreference(uniqueUsername);
        ws.send(
          JSON.stringify({
            type: "soundPreference",
            soundEnabled: currentPreference,
          })
        );
      }
    });

    ws.on("close", () => {
      console.log(`❌ Player ${uniqueUsername} disconnected`);
      delete session.players[uniqueUsername];

      if (isTeamMode && session.teams[teamId]) {
        session.teams[teamId] = session.teams[teamId].filter((u) => u !== uniqueUsername);
        if (session.teams[teamId].length === 0) delete session.teams[teamId];
      }

      if (session.admin === uniqueUsername) {
        session.admin = Object.keys(session.players)[0] || null;
      }

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

  // Game timer and session management
  setInterval(() => {
    for (let session of Object.values(appData.sessions)) {
      // Check if session should be closed
      if (Object.keys(session.players).length === 0 && Object.keys(session.spectators).length === 0) {
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
          continue;
        }
      } else {
        session.persistTime = appData.SESSION_PERSIST_TIME;
      }

      if (session.state === "game") {
        session.timeLeft -= 1;
        const now = Date.now();
        const staleThreshold = 2 * 60 * 1000;

        for (let player of Object.values(session.players)) {
          if (player.health <= 10 && player.points > 0) {
            player.points = 0;
          }
          if (player.position.lastUpdated && now - player.position.lastUpdated > staleThreshold) {
            console.info(`Cleaning stale position for ${player.username}`);
            player.position.latitude = null;
            player.position.longitude = null;
            player.position.lastUpdated = null;
          }
        }

        if (session.timeLeft % 5 === 0) {
          broadcastPlayerPositions(session);
        }

        const powerups = ["invincibility", "instakill", "healthBoost"];
        for (let player of Object.values(session.players)) {
          for (let powerupId in player.activePowerups) {
            let v = player.activePowerups[powerupId];
            if (v > 0) player.activePowerups[powerupId]--;
            console.log(`powerup ${powerupId}: ${player.activePowerups[powerupId]}`);
          }

          if (Math.random() < 0.06) {
            const selectedPowerup = powerups[Math.floor(Math.random() * powerups.length)];
            const powerupDuration = 10;

            if (selectedPowerup === "healthBoost") {
              player.health = Math.min(100, player.health + 30);
            } else {
              player.activePowerups[selectedPowerup] = powerupDuration;
            }

            player.connection.send(
              JSON.stringify({
                type: "powerup",
                powerup: selectedPowerup,
                duration: powerupDuration,
              })
            );
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
        }
      }
    }
  }, 1000);
}

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

function getPlayerList(session) {
  return Object.keys(session.players).map((username) => {
    const { color, hitsGiven, hitsTaken, points, health } = session.players[username];
    return {
      username,
      color,
      hitsGiven,
      hitsTaken,
      points,
      health,
    };
  });
}

function getTeams(session) {
  return Object.entries(session.teams || {}).map(([teamId, usernames]) => ({
    teamId,
    players: usernames.map((u) => {
      const p = session.players[u];
      return { username: p.username, color: p.color };
    }),
  }));
}

function sendToAll(session, messageObj) {
  const msg = JSON.stringify(messageObj);
  for (const p of Object.values(session.players)) {
    p.connection.send(msg);
  }
  for (const s of Object.values(session.spectators)) {
    s.send(msg);
  }
}

function broadcastPlayerList(session) {
  const isTeamMode = session.mode === "team";
  sendToAll(session, {
    type: "playerListUpdate",
    admin: session.admin,
    ...(isTeamMode ? { teams: getTeams(session) } : { playerList: getPlayerList(session) }),
  });
}

function broadcastPlayerPositions(session) {
  const positions = Object.values(session.players)
    .filter((player) => player.position.latitude !== null && player.position.longitude !== null)
    .map((player) => ({
      username: player.username,
      color: player.color,
      latitude: player.position.latitude,
      longitude: player.position.longitude,
      lastUpdated: player.position.lastUpdated,
    }));

  const message = JSON.stringify({
    type: "playerPositions",
    positions: positions,
  });

  sendToClients(session, message, true, true);
}

function handleHit(session, player, color, weapon) {
  if (color === "cyan") return; // Invalid color
  if (player.points <= 0 || player.health <= 10) return; // Already eliminated

  let target;
  for (let playerUsername in session.players) {
    if (session.players[playerUsername].color === color) {
      target = session.players[playerUsername];
      break;
    }
  }

  if (!target || target.points <= 0 || target.health <= 10 || target.activePowerups.invincibility > 0) return;

  target.health = Math.max(0, target.health - 10);
  player.health = Math.min(100, player.health + 10);

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
    const damage = weaponDamages[weapon] ?? 0;
    target.points = Math.max(0, target.points - damage);
    player.points += Math.floor(damage / 2);
  }

  player.hitsGiven++;
  target.hitsTaken++;

  sendToClients(
    session,
    JSON.stringify({
      type: "hit",
      player: player.username,
      target: target.username,
      weapon,
      targetHealth: target.health,
      shooterHealth: player.health,
    }),
    true,
    true
  );

  if (target.health <= 10) {
    sendToClients(
      session,
      JSON.stringify({
        type: "elimination",
        player: target.username,
        weapon,
        cause: "health_depleted",
      }),
      true,
      true
    );
  }

  if (target.points <= 0) {
    sendToClients(
      session,
      JSON.stringify({
        type: "elimination",
        player: target.username,
        weapon,
        cause: "points_depleted",
      }),
      true,
      true
    );
  }
}

module.exports = { attach };