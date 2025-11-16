const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { authenticateToken } = require("../middleware/auth");
const Message = require("../models/Message");
const User = require("../models/User");
const { supabase, ensureBucket } = require("../services/supabase");

const router = express.Router();

const uploadsDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Use memory storage so we can upload directly to Supabase (if configured)
const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const SUPABASE_DEFAULT_CHAT_BUCKET = process.env.SUPABASE_BUCKET || process.env.SUPABASE_DEFAULT_BUCKET || "chat-files";
const SUPABASE_DEFAULT_AVATAR_BUCKET =
  process.env.SUPABASE_AVATAR_BUCKET || process.env.SUPABASE_PROFILE_BUCKET || process.env.SUPABASE_BUCKET || "avatars";
const SUPABASE_FORCE = String(process.env.SUPABASE_FORCE || process.env.SUPABASE_UPLOADS_ONLY || "false").toLowerCase() === "true";
const SIGNED_URL_TTL_DEFAULT = Number(process.env.SUPABASE_SIGNED_URL_TTL || 60 * 60 * 24 * 7);

function normalizeStoragePath(p) {
  if (!p) return "";
  return String(p).replace(/^\/+/, "").replace(/\\+/g, "/");
}

function buildSupabaseRef(bucket, path) {
  if (!bucket || !path) return null;
  return `supabase://${bucket}/${normalizeStoragePath(path)}`;
}

function parseSupabaseRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  if (!ref.startsWith("supabase://")) return null;
  const remainder = ref.slice("supabase://".length);
  const slash = remainder.indexOf("/");
  if (slash === -1) return null;
  const bucket = remainder.slice(0, slash);
  const path = remainder.slice(slash + 1);
  if (!bucket || !path) return null;
  return { bucket, path: normalizeStoragePath(path) };
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
      let uploadedPath = null;
      let storageBucket = null;
      let storagePath = null;
      let storageRef = null;
      let canonicalUrl = null;
      let signedUrl = null;
      let signedExpiresAt = null;
      let publicUrl = null;
      // choose bucket and path based on purpose
      const purpose = req.body && req.body.purpose;
      const bucket =
        (purpose === "avatar"
          ? process.env.SUPABASE_AVATAR_BUCKET
          : process.env.SUPABASE_BUCKET) ||
        (purpose === "avatar" ? SUPABASE_DEFAULT_AVATAR_BUCKET : SUPABASE_DEFAULT_CHAT_BUCKET);
      const destPath = `${purpose === "avatar" ? "avatars" : "messages"}/${req.user.id}/${filename}`;
      const bucketPublicEnv = purpose === "avatar" ? process.env.SUPABASE_AVATAR_BUCKET_PUBLIC : process.env.SUPABASE_BUCKET_PUBLIC;
      const bucketPublic = String(bucketPublicEnv || "false").toLowerCase() === "true";
      const fallbackBucket =
        purpose === "avatar"
          ? process.env.SUPABASE_BUCKET || SUPABASE_DEFAULT_CHAT_BUCKET
          : process.env.SUPABASE_AVATAR_BUCKET || SUPABASE_DEFAULT_AVATAR_BUCKET;

      let bucketReady = false;
      let bucketMissing = false;
      let resolvedBucket = bucket;
      if (supabase) {
        const ensureResult = await ensureBucket(bucket, {
          publicBucket: bucketPublic,
          fallbackBucket: fallbackBucket && fallbackBucket !== bucket ? fallbackBucket : undefined,
        });
        bucketReady = Boolean(ensureResult && ensureResult.ok);
        resolvedBucket = ensureResult && ensureResult.bucket ? ensureResult.bucket : bucket;
        bucketMissing = Boolean(ensureResult && ensureResult.missing && !ensureResult.ok);
        if (bucketReady && ensureResult && ensureResult.fallback && resolvedBucket !== bucket) {
          console.warn(
            `Supabase upload will use fallback bucket "${resolvedBucket}" instead of requested "${bucket}".`,
          );
        } else if (!bucketReady) {
          console.error(`Supabase bucket "${resolvedBucket || bucket}" not ready. Falling back to local storage.`);
        }
      }

      if (supabase && bucketReady) {
        try {
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from(resolvedBucket)
            .upload(destPath, file.buffer, { contentType: file.mimetype });
          if (uploadError) {
            console.error("Supabase upload error:", uploadError);
          } else {
            uploadedPath = uploadData?.path || uploadData?.Key || destPath;
            storageBucket = resolvedBucket;
            storagePath = normalizeStoragePath(uploadedPath || destPath);
            storageRef = buildSupabaseRef(storageBucket, storagePath);
            canonicalUrl = storageRef;

            try {
              if (bucketPublic) {
                const getRes = await supabase.storage.from(resolvedBucket).getPublicUrl(storagePath);
                publicUrl = getRes?.data?.publicUrl || getRes?.publicURL || null;
              }
            } catch (e) {
              console.error("Supabase getPublicUrl error:", e);
            }

            try {
              const { data: signed, error: signErr } = await supabase.storage
                .from(resolvedBucket)
                .createSignedUrl(storagePath, SIGNED_URL_TTL_DEFAULT);
              if (signErr) {
                console.error("Supabase createSignedUrl error:", signErr);
              } else {
                signedUrl = signed?.signedUrl || null;
                signedExpiresAt = signed?.expiresAt || null;
              }
            } catch (err) {
              console.error("Supabase signed URL generation exception:", err);
            }

            if (!signedUrl && publicUrl) {
              signedUrl = publicUrl;
            }
          }
        } catch (err) {
          console.error("Supabase upload exception:", err);
        }
      }

      // If Supabase required but upload failed, return error instead of saving locally
      if (!canonicalUrl && SUPABASE_FORCE) {
        console.error("Supabase upload required but failed; SUPABASE_FORCE is enabled.");
        return res.status(500).json({ message: "Supabase upload required but failed" });
      }

      if (!canonicalUrl && supabase && bucketMissing) {
        const message = `Supabase bucket "${bucket}" not found. Create it (or configure SUPABASE_FALLBACK_BUCKET) and retry.`;
        console.error(message);
        return res.status(500).json({ message });
      }

      if (storageRef && !signedUrl) {
        console.error("Supabase signed URL generation failed; aborting upload to protect private assets.");
        return res.status(500).json({ message: "Failed to generate signed URL" });
      }

      // Fallback: write to local uploads dir only if supabase not used
      if (!canonicalUrl) {
        const diskPath = path.join(uploadsDir, filename);
        fs.writeFileSync(diskPath, file.buffer);
        canonicalUrl = `/uploads/${filename}`;
        signedUrl = canonicalUrl;
        uploadedPath = diskPath;
      }

      // save a message with file metadata if `to` provided in body
      const { to } = req.body;
      let msgDoc = null;
      if (to) {
        msgDoc = new Message({
          from: req.user.id,
          to,
          file: {
            url: canonicalUrl,
            fileName: file.originalname,
            mimeType: file.mimetype,
            size: file.size || (file.buffer ? file.buffer.length : 0),
            storageBucket,
            storagePath,
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
            `Avatar update requested: user=${req.user.id} previousAvatar=${current?.avatar} newAvatar=${canonicalUrl}`,
          );

          const updatedDoc = await User.findByIdAndUpdate(
            req.user.id,
            { avatar: canonicalUrl },
            { new: true },
          ).lean();
          if (updatedDoc && signedUrl) {
            updatedDoc.avatarSignedUrl = signedUrl;
          }
          const io = req.app.get("io");
          if (io) {
            // Broadcast to all clients so they can update their user lists
            io.emit("user-updated", {
              id: req.user.id,
              _id: req.user.id,
              avatar: canonicalUrl,
              avatarSignedUrl: signedUrl,
              avatarSignedExpiresAt: signedExpiresAt,
            });
          }
          return res.json({
            url: canonicalUrl,
            signedUrl,
            signedExpiresAt,
            bucket: storageBucket,
            path: storagePath,
            storageRef,
            publicUrl,
            user: updatedDoc,
          });
        } catch (err) {
          console.error("Avatar update error:", err);
          // fall through to normal response below
        }
      }

      // emit to recipient(s) if io available
      const io = req.app.get("io");
      if (io && to) {
        // emit the saved message doc (attach uploader info) so clients get _id and createdAt
        try {
          const payload = msgDoc ? msgDoc.toObject ? msgDoc.toObject() : msgDoc : {
            from: req.user,
            to,
            file: {
              url: canonicalUrl,
              fileName: file.originalname,
              mimeType: file.mimetype,
              size: file.size,
              storageBucket,
              storagePath,
            }
          };
          // attach basic user info for convenience
          payload.uploader = { id: req.user.id || req.user._id, name: req.user.name, avatar: req.user.avatar };
          if (signedUrl) {
            payload.file = payload.file || {};
            payload.file.signedUrl = signedUrl;
            payload.file.signedExpiresAt = signedExpiresAt;
          }
          io.to(to).emit("file", payload);
        } catch (e) {
          console.error("Error emitting file socket message", e);
        }
      }

      res.json({
        url: canonicalUrl,
        signedUrl,
        signedExpiresAt,
        bucket: storageBucket,
        path: storagePath,
        storageRef,
        publicUrl,
        id: msgDoc?._id?.toString(),
      });
    } catch (err) {
      console.error("File upload error:", err);
      res.status(500).json({ message: "Upload failed" });
    }
  },
);

// GET /api/files/signed-url?ref=supabase://bucket/path or bucket/path params
router.get("/signed-url", authenticateToken, async (req, res) => {
  try {
    if (!supabase) {
      return res.status(400).json({ message: "Supabase not configured" });
    }

    const { ref, bucket: queryBucket, path: queryPath, ttl: ttlQuery } = req.query || {};
    let bucket = queryBucket;
    let objectPath = queryPath;

    if (ref) {
      const parsed = parseSupabaseRef(decodeURIComponent(ref));
      if (!parsed) return res.status(400).json({ message: "Invalid ref parameter" });
      bucket = parsed.bucket;
      objectPath = parsed.path;
    }

    bucket = bucket && String(bucket).trim();
    objectPath = normalizeStoragePath(objectPath);

    if (!bucket || !objectPath) {
      return res.status(400).json({ message: "Missing bucket or path" });
    }

    const ttlSecondsRaw = Number(ttlQuery);
    let ttlSeconds = Number.isFinite(ttlSecondsRaw) && ttlSecondsRaw > 0 ? ttlSecondsRaw : SIGNED_URL_TTL_DEFAULT;
    ttlSeconds = Math.min(Math.max(ttlSeconds, 30), 60 * 60 * 24 * 7);

    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, ttlSeconds);
    if (error) {
      if (error.status === 404 || error.statusCode === "404") {
        return res.status(404).json({ message: "Object not found" });
      }
      console.error("Supabase signed-url error:", error);
      return res.status(500).json({ message: "Failed to create signed URL" });
    }

    return res.json({
      url: data?.signedUrl || null,
      expiresAt: data?.expiresAt || null,
      expiresIn: ttlSeconds,
    });
  } catch (err) {
    console.error("Supabase signed-url exception:", err);
    res.status(500).json({ message: "Failed to create signed URL" });
  }
});

module.exports = router;
