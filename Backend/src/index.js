const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const authRoutes = require("./routes/auth");
const { initSocket } = require("./socket/socket");
const { authenticateToken } = require("./middleware/auth");
const path = require("path");
require("dotenv").config();
const { connect } = require("./db");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
const filesRoutes = require("./routes/files");
app.use("/api/files", filesRoutes);
const messagesRoutes = require("./routes/messages");
app.use("/api/messages", messagesRoutes);
const usersRoutes = require("./routes/users");
app.use("/api/users", usersRoutes);
const roomsRoutes = require("./routes/rooms");
app.use("/api/rooms", roomsRoutes);

// Example protected route
app.get("/api/me", authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// Serve uploads
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// make io available to routes
app.set("io", io);

initSocket(io);

const PORT = process.env.PORT || 4000;

(async () => {
  await connect();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();
