const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// GET /api/users - list users (omit password)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const users = await User.find({}, 'username displayName createdAt');
    res.json(users.map(u => ({ id: u._id.toString(), username: u.username, displayName: u.displayName, createdAt: u.createdAt })));
  } catch (err) {
    console.error('List users error', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
