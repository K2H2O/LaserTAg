//2023721380 Ivy
//2021561648 Bophelo Pharasi
const express = require("express");
const http = require("http");
const socket = require("./socket");
const sessionRoutes = require("./routes/session"); // Solo sessions
const teamSessionRoutes = require("./routes/team-session"); // Team sessions

const app = express();
const server = http.createServer(app);  // Create HTTP server with Express app

// Mount REST routes
app.use("/routes/session", sessionRoutes);         // Solo sessions
app.use("/routes/team-session", teamSessionRoutes); // Team sessions

// Attach Socket.IO server
socket.attach(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});