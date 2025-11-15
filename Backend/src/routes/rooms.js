const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const Room = require("../models/Room");
const User = require("../models/User");

const router = express.Router();

// Create a room
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { name, members = [], isGroup = true } = req.body;
    const room = new Room({ name, members, isGroup });
    await room.save();
    res.json({
      id: room._id.toString(),
      name: room.name,
      members: room.members,
      isGroup: room.isGroup,
    });
  } catch (err) {
    console.error("Create room error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// List rooms
router.get("/", authenticateToken, async (req, res) => {
  try {
    const rooms = await Room.find({}).populate(
      "members",
      "username displayName",
    );
    res.json(
      rooms.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        members: r.members.map((m) => ({
          id: m._id.toString(),
          username: m.username,
          displayName: m.displayName,
        })),
        isGroup: r.isGroup,
      })),
    );
  } catch (err) {
    console.error("List rooms error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Join a room (add member)
router.post("/:id/join", authenticateToken, async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = req.user.id;
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (!room.members.find((m) => m.toString() === userId)) {
      room.members.push(userId);
      await room.save();
    }
    res.json({ id: room._id.toString(), members: room.members });
  } catch (err) {
    console.error("Join room error", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
