const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const User = require("../models/User");

const router = express.Router();

// GET /api/users - list users (omit password)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, "username displayName avatar about createdAt");
    res.json(
      users.map((u) => ({
        id: u._id.toString(),
        username: u.username,
        displayName: u.displayName,
        avatar: u.avatar,
        about: u.about,
        createdAt: u.createdAt,
      })),
    );
  } catch (err) {
    console.error("List users error", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH /api/users/me - update current user's profile (displayName, about)
router.patch("/me", authenticateToken, async (req, res) => {
  try {
    const { displayName, about } = req.body || {};
    const updates = {};
    if (typeof displayName !== "undefined") updates.displayName = displayName;
    if (typeof about !== "undefined") updates.about = about;
    const updated = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      fields: "username displayName avatar about createdAt",
    });
    if (!updated) return res.status(404).json({ message: "User not found" });
    res.json({
      id: updated._id.toString(),
      username: updated.username,
      displayName: updated.displayName,
      avatar: updated.avatar,
      about: updated.about,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    console.error("Update profile error", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
