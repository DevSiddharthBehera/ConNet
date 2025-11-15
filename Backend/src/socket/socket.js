const { verifySocketToken } = require("../middleware/auth");
const Message = require("../models/Message");
const Room = require("../models/Room");

// In-memory maps for demo; swap with persistent store in production
// track multiple sockets per user: userId -> Set(socketId)
const onlineUsers = new Map();

function initSocket(io) {
  io.use((socket, next) => {
    const token =
      (socket.handshake.auth && socket.handshake.auth.token) ||
      (socket.handshake.query && socket.handshake.query.token);
    const user = verifySocketToken(token);
    if (!user) return next(new Error("Authentication error"));
    socket.user = user;
    next();
  });

  io.on("connection", async (socket) => {
    const user = socket.user;
    // ensure a socket set exists for this user
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id).add(socket.id);
    socket.join(user.id); // join personal room for broadcast to all user's sockets

    socket.emit("connected", { user });
    // Auto-join all rooms user is a member of so they receive group messages in real-time
    try {
      const memberRooms = await Room.find({ members: user.id }).select("_id");
      memberRooms.forEach((r) => socket.join(r._id.toString()));
    } catch (err) {
      console.error("Room auto-join error", err);
    }
    // send current online list to this socket so it can initialise presence state
    try {
      const list = Array.from(onlineUsers.keys()).map(String);
      socket.emit("online-list", list);
    } catch (err) {
      /* ignore */
    }
    // notify others that this user is online
    io.emit("user-online", {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
    });

    socket.on("join-room", (roomId) => {
      socket.join(roomId);
    });

    socket.on("leave-room", (roomId) => {
      socket.leave(roomId);
    });

    // Chat message: { to: roomId or userId, content, meta }
    socket.on("message", async (payload) => {
      const { to, content, meta, file } = payload;
      if (!to) return;
      try {
        // detect if target is a room (group)
        let isGroup = false;
        try {
          if (await Room.findById(to).select("_id")) isGroup = true;
        } catch (e) {
          /* ignore */
        }
        const msgDoc = new Message({ from: user.id, to, content, meta, file });
        await msgDoc.save();
        const out = {
          id: msgDoc._id.toString(),
          from: user,
          to,
          content,
          meta,
          file,
          createdAt: msgDoc.createdAt,
          isGroup,
        };

        // Emit to the target room/user
        io.to(to).emit("message", out);

        // Also emit back to sender's personal room
        io.to(user.id).emit("message", out);

        if (isGroup) {
          // Additionally emit to each member's personal room (except duplicates) for non-joined tabs
          try {
            const roomMembers = await Room.findById(to).select("members");
            if (roomMembers && roomMembers.members) {
              roomMembers.members.forEach((memberId) => {
                const memberStr = memberId.toString();
                if (memberStr !== user.id)
                  io.to(memberStr).emit("message", out);
              });
            }
          } catch (err) {
            console.error("Group member emit error", err);
          }
        }
      } catch (err) {
        console.error("Error saving message:", err);
      }
    });

    // Typing indicator
    socket.on("typing", ({ to, isTyping }) => {
      if (!to) return;
      io.to(to).emit("typing", { from: user, isTyping });
    });

    // File transfer by sending metadata and binary chunks. For small demo, we'll forward file blobs directly.
    socket.on("file", async (payload) => {
      const { to, fileName, mimeType, buffer, size } = payload; // buffer can be base64 string
      if (!to) return;
      try {
        const fileMeta = { url: null, fileName, mimeType, size };
        // For direct socket-forwarded files we include base64 buffer in the event but don't store binary on server in this demo
        const msgDoc = new Message({ from: user.id, to, file: fileMeta });
        await msgDoc.save();
        const fileOut = {
          from: user,
          fileName,
          mimeType,
          buffer,
          id: msgDoc._id.toString(),
          createdAt: msgDoc.createdAt,
        };

        // Emit to the target room/user
        io.to(to).emit("file", fileOut);

        // Also emit back to sender's personal room
        io.to(user.id).emit("file", fileOut);
      } catch (err) {
        console.error("Error saving file message:", err);
      }
    });

    // WebRTC signalling for calls: call-user, call-made, answer-call, ice-candidate, end-call
    socket.on("call-user", ({ to, offer }) => {
      const targetSet = onlineUsers.get(to);
      if (targetSet) {
        targetSet.forEach((targetSocketId) =>
          io.to(targetSocketId).emit("incoming-call", { from: user, offer }),
        );
      }
    });

    socket.on("answer-call", ({ to, answer }) => {
      const targetSet = onlineUsers.get(to);
      if (targetSet) {
        targetSet.forEach((targetSocketId) =>
          io.to(targetSocketId).emit("call-answered", { from: user, answer }),
        );
      }
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
      const targetSet = onlineUsers.get(to);
      if (targetSet) {
        targetSet.forEach((targetSocketId) =>
          io
            .to(targetSocketId)
            .emit("ice-candidate", { from: user, candidate }),
        );
      }
    });

    socket.on("end-call", ({ to }) => {
      // Notify target user's sockets
      const targetSet = onlineUsers.get(to);
      if (targetSet) {
        targetSet.forEach((targetSocketId) =>
          io.to(targetSocketId).emit("call-ended", { from: user }),
        );
      }
      // Notify all of caller's other sockets (multi-tab) so they clean up too
      const callerSet = onlineUsers.get(user.id);
      if (callerSet) {
        callerSet.forEach((sid) => {
          if (sid !== socket.id) io.to(sid).emit("call-ended", { from: user });
        });
      }
    });

    socket.on("mark-read", async ({ conversationId }) => {
      try {
        // Mark all messages in this conversation as read for this user
        await Message.updateMany(
          {
            to: conversationId,
            from: { $ne: user.id },
            "meta.readBy": { $ne: user.id },
          },
          { $addToSet: { "meta.readBy": user.id } },
        );
      } catch (err) {
        console.error("Mark read error:", err);
      }
    });

    socket.on("disconnect", () => {
      try {
        const set = onlineUsers.get(user.id);
        if (set) {
          set.delete(socket.id);
          if (set.size === 0) {
            onlineUsers.delete(user.id);
            io.emit("user-offline", { id: user.id });
          }
        }
      } catch (err) {
        console.error("Disconnect error", err);
      }
    });
  });
}

module.exports = { initSocket };
