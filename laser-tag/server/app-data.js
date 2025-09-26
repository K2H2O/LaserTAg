SESSION_PERSIST_TIME = 300; // 5 minutes (increased from 10 seconds)

const sessions = {};
// sessions will be automatically removed when all player websocket connections have been closed

function getUniqueSessionId() {
  for (let i = 0; true; i++) {
    if (!sessions[i]) {
      return i;
    }
  }
}

// Example session structure for reference
const exampleSession = {
  id: 1,
  mode: "solo", // "solo" or "team"
  state: "lobby", // lobby, game, finished
  admin: "cable",
  timeLeft: 180, // seconds (3 minutes default game time)
  persistTime: SESSION_PERSIST_TIME, // seconds until session is closed
  players: {
    cable: {
      connection: null, // websocket connection
      username: "cable",
      color: "red",
      teamId: null, // only used in team mode
      points: 50,
      health: 100,
      hitsGiven: 0,
      hitsTaken: 0,
      activePowerups: {
        'invincibility': 0, // duration in seconds
        'instakill': 0,
        'healthBoost': 0
      },
      position: {
        latitude: null,
        longitude: null,
        lastUpdated: null
      }
    },
  },
  teams: {
    // Only exists in team mode
    "team1": ["cable", "player2"],
    "team2": ["player3", "player4"]
  },
  spectators: {
    "uuid": null, // websocket connection
  },
  latestFrames: {
    "cable": "base64_frame_data"
  }
};

function createSession(id, mode = "solo") {
  // Validate mode parameter
  if (mode !== "solo" && mode !== "team") {
    console.warn(`Invalid mode '${mode}', defaulting to 'solo'`);
    mode = "solo";
  }

  const session = {
    id,
    mode, // "solo" or "team"
    state: "lobby",
    admin: null,
    timeLeft: 0, // Will be set when game starts
    persistTime: SESSION_PERSIST_TIME,
    players: {},
    spectators: {},
    latestFrames: {}
  };

  // Only add teams object for team mode
  if (mode === "team") {
    session.teams = {};
  }

  sessions[id] = session;
  console.log(`Created ${mode} session with ID: ${id}`);
  return session;
}

function isSessionValid(sessionId) {
  return sessions[sessionId] !== undefined;
}

function getSession(sessionId) {
  return sessions[sessionId];
}

function deleteSession(sessionId) {
  if (sessions[sessionId]) {
    delete sessions[sessionId];
    console.log(`Deleted session: ${sessionId}`);
    return true;
  }
  return false;
}

function getAllSessions() {
  return Object.keys(sessions).map(id => ({
    id,
    mode: sessions[id].mode,
    state: sessions[id].state,
    playerCount: Object.keys(sessions[id].players).length,
    spectatorCount: Object.keys(sessions[id].spectators).length
  }));
}

// Helper function to create a new player object with all required fields
function createPlayerObject(username, color, teamId = null) {
  return {
    connection: null, // Will be set by WebSocket handler
    username,
    color,
    teamId,
    points: 50,
    health: 100,
    hitsGiven: 0,
    hitsTaken: 0,
    activePowerups: {
      'invincibility': 0,
      'instakill': 0,
      'healthBoost': 0
    },
    position: {
      latitude: null,
      longitude: null,
      lastUpdated: null
    }
  };
}

module.exports = {
  SESSION_PERSIST_TIME,
  createSession,
  createPlayerObject,
  isSessionValid,
  getSession,
  deleteSession,
  getAllSessions,
  sessions,
  getUniqueSessionId,
};