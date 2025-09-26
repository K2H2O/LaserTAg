// Mock appData module
const mockAppData = {
  sessions: {},
  createSession: (sessionId, type) => {
    const session = {
      id: sessionId,
      type,
      players: {},
      spectators: {},
      teams: type === 'team' ? {} : undefined
    };
    mockAppData.sessions[sessionId] = session;
    return session;
  }
};

jest.mock('../app-data', () => mockAppData);

const { createServer } = require('http');
const { Server } = require('socket.io');
const { io: Client } = require('socket.io-client');
const { attach } = require('../socket');

describe('Socket.IO Server Tests', () => {
  let io, serverSocket, clientSocket, httpServer;

  beforeAll((done) => {
    const TEST_PORT = 4001;
    httpServer = createServer();
    io = attach(httpServer);
    httpServer.listen(TEST_PORT, () => {
      clientSocket = new Client(`http://localhost:${TEST_PORT}`, {
        path: '/socket.io',
        query: {
          username: 'testPlayer',
          color: 'red'
        }
      });
      done();
    });
  });

  afterAll((done) => {
    io.close();
    clientSocket.close();
    httpServer.close(done);
  });

  beforeEach(() => {
    // Clear sessions before each test
    mockAppData.sessions = {};
  });

  test('should connect to solo session', (done) => {
    const sessionId = 'test-session';
    const client = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'testPlayer',
        color: 'red'
      }
    });

    client.on('connect', () => {
      // Join the session
      client.emit('join', { sessionId, type: 'solo' });

      // Listen for join confirmation
      client.on('joined', (data) => {
        expect(data.status).toBe('success');
        expect(data.username).toBeDefined();
        expect(data.sessionId).toBe(sessionId);
        expect(mockAppData.sessions[sessionId]).toBeDefined();
        expect(mockAppData.sessions[sessionId].players[data.username]).toBeDefined();
        expect(mockAppData.sessions[sessionId].players[data.username].color).toBe('red');
        client.disconnect();
        done();
      });
    });

    client.on('connect_error', (error) => {
      done(error);
    });
  });

  test('should connect to team session', (done) => {
    const sessionId = 'test-team-session';
    const client = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'testPlayer',
        color: 'red',
        team: 'team1'
      }
    });

    client.on('connect', () => {
      // Join the team session
      client.emit('join', { sessionId, type: 'team' });

      // Listen for join confirmation
      client.on('joined', (data) => {
        expect(data.status).toBe('success');
        expect(data.username).toBeDefined();
        expect(data.sessionId).toBe(sessionId);
        expect(mockAppData.sessions[sessionId]).toBeDefined();
        expect(mockAppData.sessions[sessionId].players[data.username]).toBeDefined();
        expect(mockAppData.sessions[sessionId].players[data.username].color).toBe('red');
        expect(mockAppData.sessions[sessionId].players[data.username].team).toBe('team1');
        client.disconnect();
        done();
      });
    });
  });

  test('should handle color check', (done) => {
    const sessionId = 'test-session';
    const client = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'testPlayer',
        color: 'blue'
      }
    });

    mockAppData.sessions[sessionId] = {
      players: {},
      spectators: {}
    };

    client.on('connect', () => {
      client.emit('checkColor', { sessionId, color: 'blue' });
      client.on('colorResult', (data) => {
        expect(data.available).toBe(true);
        client.disconnect();
        done();
      });
    });
  });

  test('should handle spectator connections', (done) => {
    const sessionId = 'test-session';
    const player = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'testPlayer',
        color: 'red'
      }
    });

    player.on('connect', () => {
      // Create session by joining as player first
      player.emit('join', { sessionId, type: 'solo' });

      player.on('joined', () => {
        const spectator = new Client(`http://localhost:4001`, {
          path: '/socket.io'
        });

        spectator.on('connect', () => {
          spectator.emit('spectate', { sessionId });

          spectator.on('spectating', (data) => {
            expect(data.status).toBe('success');
            expect(Object.keys(mockAppData.sessions[sessionId].spectators).length).toBe(1);
            player.disconnect();
            spectator.disconnect();
            done();
          });
        });
      });
    });
  });

  test('should handle player hits and score updates', (done) => {
    const sessionId = 'test-session';
    const player1 = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'player1',
        color: 'red'
      }
    });

    const player2 = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'player2',
        color: 'blue'
      }
    });

    player1.on('connect', () => {
      player1.emit('join', { sessionId, type: 'solo' });

      player1.on('joined', (data1) => {
        const player1Name = data1.username;

        player2.on('connect', () => {
          player2.emit('join', { sessionId, type: 'solo' });

          player2.on('joined', (data2) => {
            const player2Name = data2.username;

            // Register for score updates
            player2.on('scoreUpdate', (data) => {
              expect(data.shooter).toBe(player1Name);
              expect(data.target).toBe(player2Name);
              expect(data.newScore).toBe(1);
              player1.disconnect();
              player2.disconnect();
              done();
            });

            // Emit hit event
            player1.emit('hit', { target: player2Name });
          });
        });
      });
    });
  });

  test('should handle player disconnection and cleanup', (done) => {
    const sessionId = 'test-session';
    const client = new Client(`http://localhost:4001`, {
      path: '/socket.io',
      query: {
        username: 'testPlayer',
        color: 'red'
      }
    });

    client.on('connect', () => {
      client.emit('join', { sessionId, type: 'solo' });

      client.on('joined', (data) => {
        expect(mockAppData.sessions[sessionId]).toBeDefined();
        expect(mockAppData.sessions[sessionId].players[data.username]).toBeDefined();

        client.disconnect();

        // Give time for cleanup
        setTimeout(() => {
          expect(mockAppData.sessions[sessionId]).toBeUndefined();
          done();
        }, 100);
      });
    });
  });
});