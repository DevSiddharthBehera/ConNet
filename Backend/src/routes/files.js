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

// Use memory storage so we can upload directly to Supabase (if configured)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Optional Supabase client (requires setting SUPABASE_URL and SUPABASE_KEY env vars)
let supabase = null;
let SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "avatars";
try {
  const { createClient } = require("@supabase/supabase-js");
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;
  if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch (e) {
  // If package not installed or env not set, supabase remains null and we'll fallback to disk
  supabase = null;
}

// POST /api/files/upload
router.post(
  "/upload",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ message: "No file uploaded" });

      // Determine filename and try Supabase upload if configured
      const filename = `${Date.now()}-${file.originalname}`;
      let url = null;
      if (supabase) {
        try {
          const bucket = SUPABASE_BUCKET;
          const destPath = `avatars/${filename}`;
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(bucket)
            .upload(destPath, file.buffer, { contentType: file.mimetype });
          if (uploadError) {
            console.error("Supabase upload error:", uploadError);
          } else {
            // get public URL (support both v1 and v2 return shapes)
            try {
              const getRes = await supabase.storage.from(bucket).getPublicUrl(destPath);
              url = (getRes && (getRes.data?.publicUrl || getRes.publicURL)) || null;
            } catch (e) {
              // fallback to construct URL
              url = null;
            }
          }
        } catch (err) {
          console.error("Supabase upload exception:", err);
          url = null;
        }
      }

      // Fallback: write to local uploads dir
      if (!url) {
        const diskPath = path.join(uploadsDir, filename);
        fs.writeFileSync(diskPath, file.buffer);
        url = `/uploads/${filename}`;
      }

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
            size: file.size || (file.buffer ? file.buffer.length : 0),
          },
        });
        await msgDoc.save();
      }

      // handle avatar uploads specially: update user's avatar and broadcast
      if (req.body && req.body.purpose === "avatar") {
        try {
          // log current avatar for debugging duplicate-avatar issues
          const current = await User.findById(req.user.id).lean();
          console.log(
            `Avatar update requested: user=${req.user.id} previousAvatar=${current?.avatar} newAvatar=${url}`,
          );

          const updated = await User.findByIdAndUpdate(
            req.user.id,
            { avatar: url },
            { new: true },
          );
          const io = req.app.get("io");
          if (io) {
            // Broadcast to all clients so they can update their user lists
            io.emit("user-updated", { id: req.user.id, _id: req.user.id, avatar: url });
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
