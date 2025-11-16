const mongoose = require('mongoose');

function dbReady(req, res, next) {
  // Skip DB check for OAuth routes (they handle their own errors)
  if (req.path.startsWith('/api/auth/google')) {
    return next();
  }
  
  // Only guard API routes. Allow static files and other non-API requests to continue.
  if (req.path.startsWith('/api')) {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: 'Service unavailable: database not connected' });
    }
  }
  return next();
}

module.exports = dbReady;
