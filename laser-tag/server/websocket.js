const WebSocket = require("ws"); // imports the ws library, this handles Websockets connections(real-time bidirectional communication)
const { parse } = require("url");// imports a URL parsing utility to extract information from connection URLs
const { randomUUID } = require("crypto"); // generates unique random IDs for spectators
const appData = require("./app-data"); // imports app's data management module

function attach(server) { // attaches websockets functionality to your existing HTTP server
  const wss = new WebSocket.Server({ server }); // creates a websocket server instance

  wss.on("connection", (ws, req) => { // event listener that fires everytimr a client connects (ws - the websocket connection object for this specific client , req- the http request that initiated the connection)
    const { pathname, query } = parse(req.url, true);
    const parts = pathname.split("/").filter(Boolean); // split pathname by / and remove empty string

    // validation, ensures that the url has at least 2 parts
    if (parts.length < 2) {
      ws.close(1000, "Invalid WebSocket path");
      return;
    }

    const [mode, sessionId] = parts;
    // boolean flags to identify game mode
    const isTeamMode = mode === "team-session";
    const isSoloMode = mode === "session";

    //rejects invalid session
    if (!isTeamMode && !isSoloMode) {
      ws.close(1000, "Unknown session type");
      return;
    }

    let session = appData.sessions[sessionId]; // looks up existing game session by ID. 
    if (!session) { // Lazy creation : if session doesnt exist, create it
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
        ws.send(JSON.stringify({ type: "colorResult", available: !taken })); // sending response to client if the color is taken
      });
      return;
    }

    // Spectator logic
    if (isSpectator) {
      const id = randomUUID();
      session.spectators[id] = ws;  // generates unique ID for this spectator
      console.log(`👁️ Spectator connected to ${sessionId}`);

      ws.on("close", () => {
        delete session.spectators[id];
        console.log(`👁️ Spectator disconnected from ${sessionId}`);
      }); // when spectator disconnects ,remove from session

      return;
    }

    // PLAYER JOIN LOGIC
    const { username, color, team: teamId } = query;

    if (!username || !color || (isTeamMode && !teamId)) {
      ws.close(1000, "Missing player parameters");
      return;
    } // validation to ensure required data is present

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
    };// create player object with initail game state

    // Register player to team
    if (isTeamMode) {
      if (!session.teams[teamId]) session.teams[teamId] = [];
      session.teams[teamId].push(uniqueUsername);
    }

    // Set admin if needed
    if (!session.admin) session.admin = uniqueUsername; //first player to join becomes the admin

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
      }//event listener for incoming message from this player

      const { type } = message;

      if (type === "startGame") {
        session.state = "game";
        session.timeLeft = 180;
        sendToAll(session, {
          type: "startGame",
          playerList: getPlayerList(session)
        });
      }
      // when the admin send "start game" , change session state to "game", set 3min time 180s and broadcast to all players that game started

      // Extend with hits, powerups etc...
    });

    ws.on("close", () => {
      console.log(`❌ Player ${uniqueUsername} disconnected`);
      delete session.players[uniqueUsername]; // cleanup when players leaves

      if (isTeamMode && session.teams[teamId]) {
        session.teams[teamId] = session.teams[teamId].filter(u => u !== uniqueUsername); // removes the username from team array
        if (session.teams[teamId].length === 0) delete session.teams[teamId];
      }

      if (session.admin === uniqueUsername) {
        session.admin = Object.keys(session.players)[0] || null;
      }

      broadcastPlayerList(session);// notify everyone that player left (updates their UI)
    });
  });
}

function getPlayerList(session) {
  return Object.keys(session.players).map((username) => {
    const { color, hitsGiven, hitsTaken, points } = session.players[username];
    return { username, color, hitsGiven, hitsTaken, points };
  });
} // creates an array of player data (without websocket connection)

function getTeams(session) {
  return Object.entries(session.teams || {}).map(([teamId, usernames]) => ({
    teamId,
    players: usernames.map((u) => {
      const p = session.players[u];
      return { username: p.username, color: p.color };
    }),
  }));
} // formats team data for client

function sendToAll(session, messageObj) {
  const msg = JSON.stringify(messageObj);
  for (const p of Object.values(session.players)) {
    p.connection.send(msg);
  }
  for (const s of Object.values(session.spectators)) {
    s.send(msg);
  }
} // sends same message to everyoe in the session

function broadcastPlayerList(session) {
  const isTeamMode = session.mode === "team";
  sendToAll(session, {
    type: "playerListUpdate",
    admin: session.admin,
    ...(isTeamMode
      ? { teams: getTeams(session) }
      : { playerList: getPlayerList(session) })
  });
} // smart update : sends different data based on mode

module.exports = { attach };
