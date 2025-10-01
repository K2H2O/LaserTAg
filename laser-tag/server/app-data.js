SESSION_PERSIST_TIME = 10; // global constant : how long in secs an empty session stays alive before cleanup

const sessions = {}; // object that holds all game session
// sessions will be automatically removed when all player websocket connections have been closed

function getUniqueSessionId() {
  for (let i = 0; true; i++) {
    if (!sessions[i]) {
      return i;
    }
  }
}// generates sequentail numeric session IDs

const exampleSession = {
  id: 1,
  state: "lobby", // lobby, game, finished
  admin: "cable",
  timeLeft: 60, // seconds
  persistTime: 10, // seconds until session is closed
  players: {
    cable: {
      connection: null, // websocket connection
      username: "cable",
      color: "user color",
      points: 0,
      hitsGiven: 0,
      hitsReceived: 0,
      activePowerups: {
        'powerupId': 0 // duration in seconds
      } // template showing session structure
    },
  },
  spectators: {
    id: "websocket connection",
  },// spectator storage , people watching but not playing
};

function createSession(id, mode = "solo") {
  const session = {
    id,
    state: "lobby",
    admin: null,
    persistTime: SESSION_PERSIST_TIME,
    players: {},
    teams: mode === "teams" ? {} : undefined,
    spectators: {},
    latestFrames: {},
  };
  sessions[id] = session;
  return session;
} // creates a new empty session with default values

function isSessionValid(sessionId) {
  return sessions[sessionId] !== undefined;
} // checks if session exist , returns a boolean

module.exports = {
  SESSION_PERSIST_TIME,
  createSession,
  isSessionValid,
  sessions,
  getUniqueSessionId,
};