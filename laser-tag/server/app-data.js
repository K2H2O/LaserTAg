SESSION_PERSIST_TIME = 10;

const sessions = {};
// sessions will be automatically removed when all player websocket connections have been closed

function getUniqueSessionId() {
  // Generate a random 4-letter code if a string ID is needed
  const characters = "abcdefghijklmnopqrstuvwxyz";
  let newId;
  do {
    newId = Array(4)
      .fill()
      .map(() => characters.charAt(Math.floor(Math.random() * characters.length)))
      .join("");
  } while (sessions[newId]); // Ensure uniqueness
  return newId;
}

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
      }
    },
  },
  spectators: {
    id: "websocket connection",
  },
};

function createSession(id, mode = "solo") {

  let sessionId = id;
  if (!sessionId || typeof sessionId !== "string" || sessionId.trim() === "") {
    sessionId = getUniqueSessionId(); // Generate a new ID if none provided or invalid
  }
  const session = {
    id: sessionId,
    state: "lobby",
    admin: null,
    persistTime: SESSION_PERSIST_TIME,
    players: {},
    teams: mode === "teams" ? {} : undefined,
    spectators: {},
    latestFrames: {},
  };
  sessions[sessionId] = session;
  return session;
}

function isSessionValid(sessionId) {
  return sessions[sessionId] !== undefined;
}

module.exports = {
  SESSION_PERSIST_TIME,
  createSession,
  isSessionValid,
  sessions,
  getUniqueSessionId,
};