const express = require("express"); // web framework for Node.js , handles routing , middleware, request/response
const http = require("http"); // creates an actual http server
const websocket = require("./websocket"); //importing  WebSocket logic , contains all real-time game communication logic
const sessionRoutes = require("./routes/session"); // Solo sessions
const teamSessionRoutes = require("./routes/team-session"); // Team sessions

const app = express(); // creates express application instance
const server = http.createServer(app);  // Create HTTP server with Express app

// Mount REST routes
app.use("/api/session", sessionRoutes);         // Solo sessions
app.use("/api/team-session", teamSessionRoutes); // Team sessions
// mounts middleware/router at specific paths

// Attach WebSocket server to the same HTTP server
websocket.attach(server);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
