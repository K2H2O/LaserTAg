import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const initializeSocket = (gameCode: string, username: string, color: string, teamId: string) => {
  if (!socket) {
    socket = io('http://localhost:4000', {
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

    socket.on('connect', () => {
      console.log('🔗 Connected to Socket.IO server');
    });

    socket.on('disconnect', () => {
      console.log('❌ Disconnected from Socket.IO server');
    });

    socket.on('connect_error', (error) => {
      console.error('⚠️ Socket connection error:', error);
    });
  }

  return socket;
};

export const getSocket = () => {
  if (!socket) {
    throw new Error('Socket not initialized. Call initializeSocket first.');
  }
  return socket;
};

export const closeSocket = () => {
  if (socket) {
    socket.close();
    socket = null;
  }
};