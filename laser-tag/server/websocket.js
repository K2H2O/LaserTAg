const WebSocket = require('ws');
const express = require('express');
const http = require('http');
const url = require('url');

const app = express();
const server = http.createServer(app);

// Game sessions storage
const gameSessions = new Map();

class GameSession {
  constructor(gameCode) {
    this.gameCode = gameCode;
    this.players = new Map(); // username -> playerData
    this.teams = new Map();   // teamId -> team data
    this.admin = null;
    this.state = 'lobby'; // 'lobby', 'game', 'finished'
    this.timeLeft = 180; // 3 minutes
    this.gameTimer = null;
    this.createdAt = Date.now();
  }

  addPlayer(ws, playerData) {
    const { username, color, teamId } = playerData;
    
    // Set first player as admin
    if (!this.admin && this.players.size === 0) {
      this.admin = username;
      console.log(`👑 ${username} is now admin of ${this.gameCode}`);
    }

    // Add player to players map
    this.players.set(username, {
      ...playerData,
      ws: ws,
      points: 100,
      hitsGiven: 0,
      hitsTaken: 0,
      health: 100,
      connected: true,
      joinedAt: Date.now()
    });

    // Add player to team
    if (!this.teams.has(teamId)) {
      this.teams.set(teamId, {
        teamId: teamId,
        players: [],
        score: 0
      });
    }

    const team = this.teams.get(teamId);
    const existingPlayer = team.players.find(p => p.username === username);
    
    if (!existingPlayer) {
      team.players.push({
        username: username,
        color: color,
        points: 100,
        hitsGiven: 0,
        hitsTaken: 0,
        health: 100
      });
    }

    // Update team score
    team.score = team.players.reduce((sum, p) => sum + p.points, 0);

    console.log(`✅ ${username} joined ${this.gameCode} as Team ${teamId} (${color})`);
    this.broadcastTeamUpdate();
    return true;
  }

  removePlayer(username) {
    const player = this.players.get(username);
    if (!player) return;

    // Remove from team
    const team = this.teams.get(player.teamId);
    if (team) {
      team.players = team.players.filter(p => p.username !== username);
      if (team.players.length === 0) {
        this.teams.delete(player.teamId);
      } else {
        team.score = team.players.reduce((sum, p) => sum + p.points, 0);
      }
    }

    // Remove from players
    this.players.delete(username);

    // Transfer admin if needed
    if (this.admin === username && this.players.size > 0) {
      this.admin = Array.from(this.players.keys())[0];
      console.log(`👑 Admin transferred to ${this.admin} in ${this.gameCode}`);
    }

    console.log(`❌ ${username} left ${this.gameCode}`);
    this.broadcastTeamUpdate();
  }

  broadcastTeamUpdate() {
    const teamsArray = Array.from(this.teams.values());
    const playersArray = Array.from(this.players.values()).map(p => ({
      username: p.username,
      color: p.color,
      points: p.points,
      hitsGiven: p.hitsGiven,
      hitsTaken: p.hitsTaken,
      health: p.health
    }));

    const updateMessage = {
      type: 'gameUpdate',
      teams: teamsArray,
      players: playersArray,
      admin: this.admin,
      state: this.state,
      timeLeft: this.timeLeft,
      gameStarted: this.state === 'game'
    };

    this.broadcast(updateMessage);
    console.log(`📡 Broadcasting to ${this.players.size} players in ${this.gameCode}:`, {
      teams: teamsArray.length,
      admin: this.admin,
      state: this.state
    });
  }

  broadcast(message, excludeUsername = null) {
    const messageStr = JSON.stringify(message);
    
    for (const [username, player] of this.players) {
      if (excludeUsername && username === excludeUsername) continue;
      
      if (player.ws && player.ws.readyState === WebSocket.OPEN) {
        try {
          player.ws.send(messageStr);
        } catch (error) {
          console.error(`Failed to send to ${username}:`, error.message);
          this.removePlayer(username);
        }
      }
    }
  }

  startGame() {
    if (this.state !== 'lobby') {
      console.log(`⚠️ Cannot start game ${this.gameCode} - already in state: ${this.state}`);
      return false;
    }

    if (this.teams.size === 0) {
      console.log(`⚠️ Cannot start game ${this.gameCode} - no teams`);
      return false;
    }

    this.state = 'game';
    this.timeLeft = 180;
    
    console.log(`🎮 Starting game ${this.gameCode} with ${this.teams.size} teams`);
    
    // Start game timer
    this.gameTimer = setInterval(() => {
      this.timeLeft--;
      
      if (this.timeLeft <= 0) {
        this.endGame();
      } else {
        this.broadcastTeamUpdate();
      }
    }, 1000);

    this.broadcastTeamUpdate();
    return true;
  }

  endGame() {
    this.state = 'finished';
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }

    console.log(`🏁 Game ${this.gameCode} ended`);
    this.broadcastTeamUpdate();
  }

  handleHit(fromUsername, hitData) {
    const { weapon, color: targetColor, teamId: attackerTeamId } = hitData;
    
    // Find target player by color
    let targetPlayer = null;
    let targetTeam = null;
    
    for (const [teamId, team] of this.teams) {
      const player = team.players.find(p => p.color === targetColor);
      if (player) {
        targetPlayer = player;
        targetTeam = team;
        break;
      }
    }

    if (!targetPlayer || targetPlayer.username === fromUsername) {
      return; // Invalid target or self-hit
    }

    // Prevent team-on-team hits (friendly fire)
    const attackerPlayer = this.players.get(fromUsername);
    if (attackerPlayer && attackerPlayer.teamId === targetTeam.teamId) {
      console.log(`🚫 Friendly fire prevented: ${fromUsername} -> ${targetPlayer.username}`);
      return;
    }

    // Apply hit effects
    const damage = weapon === 'sniper' ? 20 : weapon === 'shotgun' ? 15 : 10;
    
    targetPlayer.health = Math.max(10, targetPlayer.health - damage);
    targetPlayer.hitsTaken++;
    targetPlayer.points = Math.max(0, targetPlayer.points - 10);

    if (attackerPlayer) {
      const attackerTeamData = this.teams.get(attackerPlayer.teamId);
      const attackerInTeam = attackerTeamData?.players.find(p => p.username === fromUsername);
      
      if (attackerInTeam) {
        attackerInTeam.hitsGiven++;
        attackerInTeam.points += 20;
        attackerInTeam.health = Math.min(100, attackerInTeam.health + 5);
      }
    }

    // Update team scores
    for (const team of this.teams.values()) {
      team.score = team.players.reduce((sum, p) => sum + p.points, 0);
    }

    // Broadcast hit event
    this.broadcast({
      type: 'hit',
      player: fromUsername,
      target: targetPlayer.username,
      weapon: weapon,
      damage: damage
    });

    console.log(`🎯 ${fromUsername} hit ${targetPlayer.username} with ${weapon} (-${damage} health)`);
    
    // Broadcast updated game state
    this.broadcastTeamUpdate();
  }
}

// WebSocket Server
const wss = new WebSocket.Server({
  server,
  path: '/session',
  verifyClient: (info) => {
    const query = url.parse(info.req.url, true).query;
    return query.username && query.color && query.teamId;
  }
});

wss.on('connection', (ws, req) => {
  const query = url.parse(req.url, true).query;
  const pathSegments = req.url.split('/');
  const gameCode = pathSegments[2]?.split('?')[0]; // Extract gameCode from path

  if (!gameCode || !query.username || !query.color || !query.teamId) {
    console.log('❌ Invalid connection attempt');
    ws.close(1008, 'Missing required parameters');
    return;
  }

  const playerData = {
    username: query.username,
    color: query.color,
    teamId: parseInt(query.teamId),
    gameCode: gameCode
  };

  console.log(`🔗 New connection: ${playerData.username} -> ${gameCode}`);

  // Get or create game session
  let session = gameSessions.get(gameCode);
  if (!session) {
    session = new GameSession(gameCode);
    gameSessions.set(gameCode, session);
    console.log(`🆕 Created new session: ${gameCode}`);
  }

  // Add player to session
  const added = session.addPlayer(ws, playerData);
  if (!added) {
    ws.close(1008, 'Failed to join session');
    return;
  }

  // Handle WebSocket messages
  ws.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage);
      console.log(`📨 ${playerData.username} sent:`, message.type);

      switch (message.type) {
        case 'startGame':
          if (session.admin === playerData.username) {
            const started = session.startGame();
            if (started) {
              console.log(`🎮 ${playerData.username} started game ${gameCode}`);
            }
          } else {
            console.log(`⚠️ ${playerData.username} tried to start game but is not admin`);
          }
          break;

        case 'hit':
          session.handleHit(playerData.username, message);
          break;

        case 'forfeit':
          session.removePlayer(playerData.username);
          ws.close(1000, 'Player forfeited');
          break;

        case 'requestTeamList':
          session.broadcastTeamUpdate();
          break;

        case 'joinTeam':
          // Re-add player (handle reconnection)
          session.addPlayer(ws, playerData);
          break;

        case 'playerPosition':
          // Broadcast position to other players
          session.broadcast({
            type: 'playerPositions',
            positions: [{
              username: playerData.username,
              latitude: message.latitude,
              longitude: message.longitude,
              color: playerData.color,
              timestamp: message.timestamp
            }]
          }, playerData.username);
          break;

        case 'cameraFrame':
          // Handle camera frame if needed
          break;

        default:
          console.log(`❓ Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`❌ Error processing message from ${playerData.username}:`, error.message);
    }
  });

  // Handle disconnection
  ws.on('close', (code, reason) => {
    console.log(`🔌 ${playerData.username} disconnected from ${gameCode}: ${code} - ${reason}`);
    session.removePlayer(playerData.username);
    
    // Clean up empty sessions
    if (session.players.size === 0) {
      if (session.gameTimer) {
        clearInterval(session.gameTimer);
      }
      gameSessions.delete(gameCode);
      console.log(`🗑️ Removed empty session: ${gameCode}`);
    }
  });

  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${playerData.username}:`, error.message);
  });
});

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 4 * 60 * 60 * 1000; // 4 hours
  
  for (const [gameCode, session] of gameSessions) {
    if (now - session.createdAt > maxAge && session.players.size === 0) {
      if (session.gameTimer) {
        clearInterval(session.gameTimer);
      }
      gameSessions.delete(gameCode);
      console.log(`🧹 Cleaned up old session: ${gameCode}`);
    }
  }
}, 30 * 60 * 1000); // Every 30 minutes

// Basic HTTP endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    sessions: gameSessions.size,
    totalPlayers: Array.from(gameSessions.values()).reduce((sum, s) => sum + s.players.size, 0)
  });
});

app.get('/sessions', (req, res) => {
  const sessions = Array.from(gameSessions.entries()).map(([code, session]) => ({
    gameCode: code,
    players: session.players.size,
    teams: session.teams.size,
    state: session.state,
    admin: session.admin
  }));
  res.json(sessions);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Laser Tag WebSocket Server running on port ${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/session/{gameCode}?username=X&color=Y&teamId=Z`);
});