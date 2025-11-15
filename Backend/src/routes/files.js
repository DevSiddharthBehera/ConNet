const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authenticateToken } = require("../middleware/auth");
const Message = require("../models/Message");
const User = require("../models/User");

const router = express.Router();

const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/files/upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      const url = `/uploads/${path.basename(file.path)}`;

      // save a message with file metadata if `to` provided in body
      const { to } = req.body;
      let msgDoc = null;
      if (to) {
        msgDoc = new Message({
          from: req.user.id,
          to,
          file: {
            url,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
          },
        });
        await msgDoc.save();
      }

      // handle avatar uploads specially: update user's avatar and broadcast
      if (req.body && req.body.purpose === "avatar") {
        try {
          const updated = await User.findByIdAndUpdate(
            req.user.id,
            { avatar: url },
            { new: true },
          );
          const io = req.app.get("io");
          if (io) {
            io.emit("user-updated", { id: req.user.id, avatar: url });
          }
          return res.json({ url, user: updated });
        } catch (err) {
          console.error("Avatar update error:", err);
          // fall through to normal response below
        }
      }

      // emit to recipient(s) if io available
      const io = req.app.get("io");
      if (io && to) {
        io.to(to).emit("file", {
          from: req.user,
          fileName: file.originalname,
          mimeType: file.mimetype,
          url,
          id: msgDoc?._id?.toString(),
          createdAt: msgDoc?.createdAt,
        });
      }

      res.json({ url, id: msgDoc?._id?.toString() });
    } catch (err) {
      console.error("File upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  },
);

module.exports = router;
