const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const Message = require("../models/Message");
const Room = require("../models/Room");

const router = express.Router();

// GET /api/messages/unread/counts - get unread counts for all conversations
router.get("/unread/counts", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    // Find all messages where I'm the recipient and haven't marked as read
    const unreadMessages = await Message.find({
      to: userId,
      "meta.readBy": { $ne: userId },
    }).select("from");

    // Count by sender
    const counts = {};
    unreadMessages.forEach((msg) => {
      const fromId = msg.from.toString();
      counts[fromId] = (counts[fromId] || 0) + 1;
    });

    res.json(counts);
  } catch (err) {
    console.error("Error fetching unread counts:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// GET /api/messages/:to?limit=50
// Returns messages for a room or a user id (to)
router.get("/:to", authenticateToken, async (req, res) => {
  try {
    const to = req.params.to;
    const currentUserId = req.user.id;
    const limit = parseInt(req.query.limit || "100", 10);

    const isSelf = to === currentUserId;
    let msgs;

    // If the client requested only 1 message, return the latest (sort desc).
    const sortOrder = limit === 1 ? -1 : 1;

    if (isSelf) {
      // Self notepad: only messages explicitly from me to me
      msgs = await Message.find({ from: currentUserId, to: currentUserId })
        .sort({ createdAt: sortOrder })
        .limit(limit)
        .populate("from", "username displayName");
    } else {
      // Determine if this is a group room
      const room = await Room.findById(to).select("_id");
      if (room) {
        // Group: all messages where to is the room id
        msgs = await Message.find({ to })
          .sort({ createdAt: sortOrder })
          .limit(limit)
          .populate("from", "username displayName");
      } else {
        // 1-1 chat
        msgs = await Message.find({
          $or: [
            { from: currentUserId, to },
            { from: to, to: currentUserId },
          ],
        })
          .sort({ createdAt: sortOrder })
          .limit(limit)
          .populate("from", "username displayName");
      }
    }

    res.json(
      msgs.map((m) => ({
        id: m._id.toString(),
        from: {
          id: m.from._id?.toString(),
          username: m.from.username,
          displayName: m.from.displayName,
        },
        to: m.to,
        content: m.content,
        file: m.file,
        meta: m.meta,
        createdAt: m.createdAt,
      })),
    );
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
