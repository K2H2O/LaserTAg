const { Server } = require("socket.io");
const appData = require("./app-data");

function attach(httpServer) {
  const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    const { gameCode, username, color, teamId } = socket.handshake.query;
    console.log("📱 New connection:", { gameCode, username, color, teamId });

    if (!gameCode || !username || !color || !teamId) {
      socket.emit("error", { message: "Missing required parameters" });
      socket.disconnect();
      return;
    }

    // Join game session room
    socket.join(gameCode);

    // Get or create session
    let session = appData.sessions[gameCode];
    if (!session) {
      session = {
        id: gameCode,
        teams: {},
        players: {},
        admin: null,
        mode: "team"
      };
      appData.sessions[gameCode] = session;
      console.log("🆕 Created new game session:", gameCode);
    }

    // Add player to session
    session.players[username] = {
      socketId: socket.id,
      username,
      color,
      teamId,
      hitsGiven: 0,
      hitsTaken: 0,
      points: 50
    };

    // Add player to team
    if (!session.teams[teamId]) {
      session.teams[teamId] = [];
    }
    if (!session.teams[teamId].includes(username)) {
      session.teams[teamId].push(username);
    }

    // Set admin if needed
    if (!session.admin) {
      session.admin = username;
    }

    console.log(`👤 Player ${username} joined team ${teamId} in game ${gameCode}`);

    // Broadcast updated player list and game state to all clients
    broadcastPlayerList(io, session);
    broadcastGameUpdate(io, session);

    // Handle game events
    socket.on("startGame", (data) => {
      if (session.admin === username) {
        // Initialize all player stats
        Object.values(session.players).forEach(player => {
          player.points = 50;
          player.hitsGiven = 0;
          player.hitsTaken = 0;
        });

        // Clear any existing timer
        if (session.timer) {
          clearInterval(session.timer);
        }

        // Initialize game timer first
        startGameTimer(io, session);
        
        // Then broadcast initial game state and start event
        broadcastGameUpdate(io, session);
        io.to(gameCode).emit("startGame");
        console.log(`🎮 Game started by admin ${username} with timer`);
      }
    });

    socket.on("hit", (data) => {
      const { weapon, shape, color, teamId: attackerTeamId } = data;
      console.log(`🎯 Hit detected by ${username} using ${weapon}`);

      // Find target player by color
      const targetPlayer = Object.values(session.players).find(p => p.color === color);
      if (!targetPlayer) {
        console.log("❌ No player found with color:", color);
        return;
      }

      // Don't allow friendly fire
      if (targetPlayer.teamId === attackerTeamId) {
        console.log("🛡️ Friendly fire blocked");
        return;
      }

      // Update stats
      session.players[username].hitsGiven++;
      targetPlayer.hitsTaken++;
      targetPlayer.points = Math.max(0, targetPlayer.points - 10);

      // Broadcast hit event
      io.to(gameCode).emit("hit", {
        player: username,
        target: targetPlayer.username,
        weapon
      });

      // Broadcast updated game state
      broadcastGameUpdate(io, session);
    });

    socket.on("cameraFrame", (data) => {
      const { frame } = data;
      // Forward frame to team members
      socket.to(gameCode).emit("cameraFrame", {
        frame,
        username,
        teamId
      });
    });

    socket.on("disconnect", () => {
      console.log(`👋 Player ${username} disconnected`);
      
      // Remove player from team
      if (session.teams[teamId]) {
        session.teams[teamId] = session.teams[teamId].filter(name => name !== username);
        if (session.teams[teamId].length === 0) {
          delete session.teams[teamId];
        }
      }

      // Remove player from session
      delete session.players[username];

      // If admin disconnected, assign new admin
      if (session.admin === username) {
        const remainingPlayers = Object.keys(session.players);
        session.admin = remainingPlayers.length > 0 ? remainingPlayers[0] : null;
      }

      // Clean up empty session or broadcast updates
      if (Object.keys(session.players).length === 0) {
        delete appData.sessions[gameCode];
        console.log(`🧹 Cleaned up empty session ${gameCode}`);
      } else {
        broadcastPlayerList(io, session);
        broadcastGameUpdate(io, session);
      }
    });
  });

  return io;
}

function broadcastPlayerList(io, session) {
  const teamsData = Object.entries(session.teams).map(([teamId, players]) => ({
    teamId: parseInt(teamId),
    players: players.map(username => ({
      username,
      color: session.players[username].color
    }))
  }));

  io.to(session.id).emit("playerListUpdate", {
    teams: teamsData,
    admin: session.admin
  });
}

function broadcastGameUpdate(io, session) {
  const teamsData = Object.entries(session.teams).map(([teamId, players]) => ({
    teamId: parseInt(teamId),
    players: players.map(username => {
      const player = session.players[username];
      return {
        username,
        color: player.color,
        points: player.points || 50, // Default points if not set
        hitsGiven: player.hitsGiven || 0, // Default if not set
        hitsTaken: player.hitsTaken || 0 // Default if not set
      };
    })
  }));

  io.to(session.id).emit("gameUpdate", {
    teams: teamsData,
    timeLeft: session.timeLeft || 300 // Default 5 minutes if not set
  });
}

// Initialize game timer when game starts
function startGameTimer(io, session) {
  // Set initial time (5 minutes)
  session.timeLeft = 300;
  
  // Create and store timer
  const timer = setInterval(() => {
    if (session.timeLeft > 0) {
      session.timeLeft--;
      broadcastGameUpdate(io, session);
      
      // Log timer updates for debugging
      if (session.timeLeft % 30 === 0) { // Log every 30 seconds
        console.log(`⏲️ Time remaining for game ${session.id}: ${session.timeLeft}s`);
      }
    }
    
    if (session.timeLeft <= 0) {
      console.log(`⏰ Game ${session.id} timer finished`);
      clearInterval(timer);
      delete session.timer;
      // Broadcast final game state
      broadcastGameUpdate(io, session);
    }
  }, 1000);

  // Store timer reference for cleanup
  session.timer = timer;
  console.log(`⏱️ Game timer started for session ${session.id}`);
}

module.exports = { attach };