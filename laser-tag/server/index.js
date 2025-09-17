import websocket from "./websocket.js";

const PORT = process.env.PORT || 3000;

websocket.start(PORT);