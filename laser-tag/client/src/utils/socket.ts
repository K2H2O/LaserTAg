import { io, Socket } from 'socket.io-client';

/**
 * Singleton socket instance for managing Socket.IO connections
 */
let socket: Socket | null = null;

/**
 * Initialize a new Socket.IO connection with the specified parameters
 */
export const initializeSocket = (gameCode: string, username: string, color: string, teamId: string): Socket => {
  // Close existing socket if it exists
  if (socket) {
    socket.close();
    socket = null;
  }

  // Create new socket connection
  const newSocket = io('http://localhost:4000', {
    query: {
      gameCode,
      username,
      color,
      teamId
    },
    path: '/socket.io',
    transports: ['websocket'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  // Set up default event handlers
  newSocket.on('connect', () => {
    console.log('🔗 Connected to Socket.IO server');
  });

  newSocket.on('disconnect', () => {
    console.log('❌ Disconnected from Socket.IO server');
  });

  newSocket.on('connect_error', (error: Error) => {
    console.error('⚠️ Socket connection error:', error);
  });

  // Store socket reference
  socket = newSocket;

  return newSocket;
};

/**
 * Get the current socket instance
 * @throws Error if socket is not initialized
 */
export const getSocket = (): Socket => {
  if (!socket) {
    throw new Error('Socket not initialized. Call initializeSocket first.');
  }
  return socket;
};

/**
 * Close and cleanup the socket connection
 */
export const closeSocket = (): void => {
  if (socket) {
    socket.close();
    socket = null;
  }
};