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
const User = require("./models/User");

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const id = req.user && (req.user.id || req.user._id);
    if (!id) return res.status(400).json({ message: "Invalid token payload" });
    const user = await User.findById(id, "username displayName avatar about createdAt");
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.json({
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      about: user.about,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error("GET /api/me error", err);
    res.status(500).json({ message: "Server error" });
  }
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
