const WebSocket = require("ws");
const { parse } = require("url");
const { randomUUID } = require("crypto");
const appData = require("./app-data");

function attach(server) {
  const wss = new WebSocket.Server({ server });

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

    // Color check logic (optional for your UI)
    if (isColorCheck) {
      ws.on("message", (msg) => {
        const { color } = JSON.parse(msg);
        const taken = Object.values(session.players).some((p) => p.color === color);
        ws.send(JSON.stringify({ type: "colorResult", available: !taken }));
      });
      return;
    }

    // Spectator logic
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
      activePowerups: {}
    };

    // Register player to team
    if (isTeamMode) {
      if (!session.teams[teamId]) session.teams[teamId] = [];
      session.teams[teamId].push(uniqueUsername);
    }

    // Set admin if needed
    if (!session.admin) session.admin = uniqueUsername;

    console.log(`🎮 Player ${uniqueUsername} joined session ${sessionId}`);

    // Send updates to all players/spectators
    broadcastPlayerList(session);

    // Handle incoming messages
    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }

      const { type } = message;

      if (type === "startGame") {
        session.state = "game";
        session.timeLeft = 180;
        sendToAll(session, {
          type: "startGame",
          playerList: getPlayerList(session)
        });
      }

      // Extend with hits, powerups etc...
    });

    ws.on("close", () => {
      console.log(`❌ Player ${uniqueUsername} disconnected`);
      delete session.players[uniqueUsername];

      if (isTeamMode && session.teams[teamId]) {
        session.teams[teamId] = session.teams[teamId].filter(u => u !== uniqueUsername);
        if (session.teams[teamId].length === 0) delete session.teams[teamId];
      }

      if (session.admin === uniqueUsername) {
        session.admin = Object.keys(session.players)[0] || null;
      }

      broadcastPlayerList(session);
    });
  });
}

function getPlayerList(session) {
  return Object.keys(session.players).map((username) => {
    const { color, hitsGiven, hitsTaken, points } = session.players[username];
    return { username, color, hitsGiven, hitsTaken, points };
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
    ...(isTeamMode
      ? { teams: getTeams(session) }
      : { playerList: getPlayerList(session) })
  });
}

module.exports = { attach };
