import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import ApiClient from "../api";
import {
  Button,
  Box,
  Heading,
  HStack,
  Text,
  IconButton,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  Flex,
  InputGroup,
  InputRightElement,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  List,
  ListItem,
  Badge,
  Stack,
  useToast,
  Spinner,
} from "@chakra-ui/react";
import {
  ArrowForwardIcon,
  AttachmentIcon,
  ArrowBackIcon,
  RepeatIcon,
} from "@chakra-ui/icons";
import { PhoneIcon } from "@chakra-ui/icons";
import VideoModal from "./VideoModal";
import SecureAvatar from "./SecureAvatar";
import useSupabaseImage from "../hooks/useSupabaseImage";

const P2P_CHUNK_SIZE = 64 * 1024; // 64KB per chunk

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function AttachmentPreview({ file, token, isOwn }) {
  if (!file) return null;
  const ref = file.url || file.storageRef || null;
  const initialUrl = file.signedUrl;
  const initialExpiresAt = file.signedExpiresAt;
  const resolvedUrl = useSupabaseImage(ref, token, {
    initialUrl,
    initialExpiresAt,
  });
  let displayUrl = resolvedUrl || initialUrl || null;
  if (!displayUrl && typeof ref === "string" && !ref.startsWith("supabase://")) {
    displayUrl = ref;
  }

  const mime = file.mimeType || file.mime || "";
  const fileName =
    file.fileName || file.file_name || file.name ||
    (typeof file.url === "string" ? file.url.split("/").pop() : undefined);

  if (!displayUrl) {
    return null;
  }

  if (mime && mime.startsWith && mime.startsWith("image/")) {
    return (
      <img
        src={displayUrl}
        alt={fileName || "image"}
        style={{ maxWidth: "100%", borderRadius: 6 }}
      />
    );
  }

  if (mime && mime.startsWith && mime.startsWith("video/")) {
    return (
      <video controls src={displayUrl} style={{ maxWidth: "100%", borderRadius: 6 }} />
    );
  }

  return (
    <a href={displayUrl} target="_blank" rel="noreferrer" style={{ color: isOwn ? "#e6f0ff" : "#3182ce" }}>
      {fileName || displayUrl}
    </a>
  );
}

export default function Chat({ token, user, to, recipient, isMobile, onBack }) {
  const [socket, setSocket] = useState(null);
  const socketRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [pc, setPc] = useState(null); // retained for UI state if needed
  const pcRef = useRef(null); // use ref to avoid stale closures in socket handlers
  const callPeerIdRef = useRef(null); // track the other participant's user id for reliable end-call signaling
  const [onlineIds, setOnlineIds] = useState([]);
  const [videoPlaying, setVideoPlaying] = useState({
    local: false,
    remote: false,
  });
  const [callActive, setCallActive] = useState(false);
  const [roomInfo, setRoomInfo] = useState(null);
  const [conversationCache, setConversationCache] = useState({}); // { id: { messages, lastFetched, scrollY } }

  const messagesRef = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const activeIdRef = useRef("");
  const isGroupRef = useRef(false);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const docInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const zipInputRef = useRef(null);
  const p2pFileInputRef = useRef(null);
  const [selectedFileName, setSelectedFileName] = useState("");
  const toast = useToast();

  const {
    isOpen: isP2POpen,
    onOpen: openP2PModal,
    onClose: closeP2PModal,
  } = useDisclosure();
  const [p2pFiles, setP2pFiles] = useState([]);
  const [p2pSending, setP2pSending] = useState(false);
  const [incomingP2P, setIncomingP2P] = useState(null);
  const pendingP2PTransfersRef = useRef(new Map());
  const incomingP2PChunksRef = useRef(new Map());
  const objectUrlsRef = useRef([]);

  useEffect(() => {
    return () => {
      try {
        objectUrlsRef.current.forEach((url) => {
          try {
            URL.revokeObjectURL(url);
          } catch (err) {
            /* ignore */
          }
        });
      } catch (err) {
        /* ignore */
      }
      objectUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (socket) {
      socketRef.current = socket;
    }
  }, [socket]);

  // Handle conversation changes: always reload from server on click
  useEffect(() => {
    const activeSocket = socketRef.current;
    if (!activeSocket || !to) return;
    activeIdRef.current = to;
    isGroupRef.current = !!recipient?.isGroup;
    activeSocket.emit("join-room", to);
    activeSocket.emit("mark-read", { conversationId: to });
    if (recipient && recipient.isGroup) fetchRoomInfo(to);
    else setRoomInfo(null);
    // Force fresh history fetch every time user/group is selected
    loadHistory(to);
  }, [to, socket, recipient]);

  useEffect(() => {}, [to, recipient]);

  async function fetchRoomInfo(roomId) {
    try {
      const resp = await ApiClient.get(`/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRoomInfo(resp.data);
    } catch (err) {
      console.error("Error fetching room info", err);
    }
  }

  const {
    isOpen: isCallOpen,
    onOpen: openCallModal,
    onClose: closeCallModal,
  } = useDisclosure();

  useEffect(() => {
    const s = io("http://localhost:4000", { auth: { token } });
    socketRef.current = s;
    setSocket(s);

    s.on("connect", () => {
      socketRef.current = s;
    });
    s.on("connected", (payload) => {});

    s.on("message", (msg) => {
      const fromId = String(msg?.from?._id || msg?.from?.id || msg?.from);
      const toId = String(msg?.to);
      const myId = String(user?.id || user?._id);
      const activeId = String(activeIdRef.current || "");
      const isGroupActive = isGroupRef.current && activeId;
      const isSelfActive = activeId === myId;

      let conversationId = null;
      if (msg.isGroup) {
        // Always route group messages by room id
        conversationId = toId;
        // If room not active, still cache it (handled below)
      } else if (isSelfActive) {
        // Only treat as self note if truly self->self
        if (fromId === myId && toId === myId) {
          conversationId = myId;
        } else {
          // Assign to the other user's conversation instead
          conversationId = fromId === myId ? toId : fromId;
        }
      } else if (fromId === myId) {
        conversationId = toId;
      } else if (toId === myId) {
        conversationId = fromId;
      }
      if (!conversationId) return;

      // update cache always
      setConversationCache((c) => {
        const existing = c[conversationId]?.messages || [];
        const msgId = (msg._id || msg.id || "").toString();
        if (
          existing.some(
            (m) => (m._id || m.id) && (m._id || m.id).toString() === msgId,
          )
        )
          return c;
        const updated = [...existing, msg];
        return {
          ...c,
          [conversationId]: {
            messages: updated,
            lastFetched: Date.now(),
            scrollY: c[conversationId]?.scrollY || 0,
          },
        };
      });

      if (conversationId === activeId) {
        setMessages((prev) => {
          const msgId = (msg._id || msg.id || "").toString();
          if (
            prev.some(
              (m) => (m._id || m.id) && (m._id || m.id).toString() === msgId,
            )
          )
            return prev;
          return [...prev, msg];
        });
      }
    });

    // maintain online user ids for header indicator instead of adding system messages
    s.on("online-list", (list) => {
      try {
        const normalized = (list || []).map((id) => String(id));
        setOnlineIds(normalized);
      } catch (err) {
        /* ignore */
      }
    });

    s.on("user-online", (u) => {
      setOnlineIds((prev) => {
        try {
          const id = String((u && u.id) || u);
          if (!id) return prev;
          if (prev.includes(id)) return prev;
          return [...prev, id];
        } catch (err) {
          return prev;
        }
      });
    });

    s.on("user-offline", (u) => {
      try {
        const idToRemove = String((u && u.id) || u);
        setOnlineIds((prev) => prev.filter((id) => String(id) !== idToRemove));
      } catch (err) {
        /* ignore */
      }
    });

    s.on("file", (payload) => {
      try {
        const fileId = (payload && (payload.id || payload._id)) || null;
        const fromId = String(
          payload?.from?._id || payload?.from?.id || payload?.from,
        );
        const myId = String(user?.id || user?._id);
        const activeId = String(activeIdRef.current || "");
        const isGroupActive = isGroupRef.current && activeId;
        const isSelfActive = activeId === myId;
        let conversationId = null;
        if (payload.isGroup) {
          conversationId = String(payload.to);
        } else if (isSelfActive) {
          if (fromId === myId && String(payload?.to) === myId) {
            conversationId = myId;
          } else {
            conversationId = fromId === myId ? String(payload?.to) : fromId;
          }
        } else if (fromId === myId) {
          conversationId = activeId; // file I sent belongs to currently open chat id
        } else {
          conversationId = fromId;
        }
        if (!conversationId) return;

        // Normalize a message object so history and socket payloads match
        const fileData = payload.file || payload;
        const msgObj = {
          _id: fileId,
          from: payload.from,
          to: payload.to,
          file: fileData ? { ...fileData } : undefined,
          createdAt: payload.createdAt || payload.created_at || new Date().toISOString(),
        };

        setConversationCache((c) => {
          const existing = c[conversationId]?.messages || [];
          // dedupe by id if available, otherwise by URL
          if (
            fileId
              ? existing.some((m) => String(m._id || m.id) === String(fileId))
              : fileData && fileData.url && existing.some((m) => m.file && m.file.url === fileData.url)
          )
            return c;
          const updated = [...existing, msgObj];
          return {
            ...c,
            [conversationId]: {
              messages: updated,
              lastFetched: Date.now(),
              scrollY: c[conversationId]?.scrollY || 0,
            },
          };
        });

        if (conversationId === activeId) {
          setMessages((prev) => {
            if (
              fileId
                ? prev.some((m) => String(m._id || m.id) === String(fileId))
                : fileData && fileData.url && prev.some((m) => m.file && m.file.url === fileData.url)
            )
              return prev;
            return [...prev, msgObj];
          });
        }
      } catch (err) {
        console.error("Error handling file socket event", err);
      }
    });

    s.on("p2p-request", (payload) => {
      if (!payload || !payload.requestId) return;
      setIncomingP2P(payload);
      const senderName =
        payload.from?.displayName || payload.from?.username || "Someone";
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          text: `${senderName} wants to start a P2P transfer (${payload.files?.length || 0} file${
            payload.files && payload.files.length === 1 ? "" : "s"
          }).`,
        },
      ]);
    });

    s.on("p2p-response", (payload) => {
      if (!payload || !payload.requestId) return;
      const { requestId, accepted, from, reason } = payload;
      const pending = pendingP2PTransfersRef.current.get(requestId);
      if (!pending) return;
      const responderName = from?.displayName || from?.username || "Recipient";
      if (!accepted) {
        resetP2PRequest(requestId);
        const description =
          reason === "offline"
            ? "Recipient is offline"
            : `${responderName} declined the transfer`;
        toast({ status: "warning", title: "P2P transfer declined", description });
        setMessages((prev) => [
          ...prev,
          {
            system: true,
            text: `${responderName} declined the P2P transfer request.`,
          },
        ]);
        return;
      }
      toast({ status: "info", title: "P2P request accepted", description: "Sending files" });
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          text: `${responderName} accepted the P2P transfer request. Uploading files...`,
        },
      ]);
      processAcceptedP2P(requestId, pending.to);
    });

    s.on("p2p-response-local", (payload) => {
      if (!payload || !payload.requestId) return;
      if (!payload.accepted) {
        setIncomingP2P(null);
      }
    });

    s.on("p2p-file-chunk", (payload) => {
      if (!payload) return;
      const {
        requestId,
        fileId,
        index,
        totalChunks,
        chunk,
        meta,
        from,
      } = payload;
      if (!requestId || typeof fileId === "undefined") return;
      if (typeof index !== "number" || typeof totalChunks !== "number") return;
      if (!chunk) return;
      const key = `${requestId}:${fileId}`;
      let entry = incomingP2PChunksRef.current.get(key);
      if (!entry) {
        entry = {
          buffers: new Array(totalChunks).fill(null),
          received: 0,
          totalChunks,
          meta: meta || {},
          from,
        };
        incomingP2PChunksRef.current.set(key, entry);
      }
      if (!entry.buffers[index]) {
        try {
          entry.buffers[index] = base64ToUint8Array(chunk);
          entry.received += 1;
        } catch (err) {
          console.error("Failed to decode P2P chunk", err);
          return;
        }
      }
      if (entry.received >= entry.totalChunks) {
        incomingP2PChunksRef.current.delete(key);
        const validBuffers = entry.buffers.filter(Boolean);
        if (!validBuffers.length) return;
        const totalLength = validBuffers.reduce(
          (sum, arr) => sum + arr.length,
          0,
        );
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        validBuffers.forEach((arr) => {
          merged.set(arr, offset);
          offset += arr.length;
        });
        const mimeType = entry.meta.type || "application/octet-stream";
        const blob = new Blob([merged], { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.push(objectUrl);
        const timestamp = new Date().toISOString();
        const senderInfo = entry.from || {};
        const conversationIdRaw =
          senderInfo.id || senderInfo._id || senderInfo.userId || senderInfo;
        const conversationId = conversationIdRaw
          ? String(conversationIdRaw)
          : null;
        const message = {
          _id: `${requestId}-${fileId}`,
          from: senderInfo,
          to: user?.id || user?._id,
          file: {
            url: objectUrl,
            fileName: entry.meta.name || `file-${fileId + 1}`,
            mimeType,
            size: entry.meta.size || merged.length,
          },
          createdAt: timestamp,
        };
        if (conversationId) {
          setConversationCache((cache) => {
            const existing = cache[conversationId]?.messages || [];
            if (
              existing.some(
                (m) => String(m._id || m.id) === String(message._id || message.id),
              )
            )
              return cache;
            return {
              ...cache,
              [conversationId]: {
                messages: [...existing, message],
                lastFetched: Date.now(),
                scrollY: cache[conversationId]?.scrollY || 0,
              },
            };
          });
          const activeId = String(activeIdRef.current || "");
          if (activeId === conversationId) {
            setMessages((prev) => {
              if (
                prev.some(
                  (m) =>
                    String(m._id || m.id) === String(message._id || message.id),
                )
              )
                return prev;
              return [...prev, message];
            });
          }
        }
        const senderName =
          senderInfo.displayName || senderInfo.username || "Sender";
        toast({
          status: "success",
          title: `Received ${entry.meta.name || "file"}`,
          description: `from ${senderName}`,
        });
        try {
          const downloadLink = document.createElement("a");
          downloadLink.href = objectUrl;
          downloadLink.download = entry.meta.name || `download-${Date.now()}`;
          downloadLink.style.display = "none";
          document.body.appendChild(downloadLink);
          downloadLink.click();
          document.body.removeChild(downloadLink);
        } catch (err) {
          console.error("Auto download failed", err);
        }
        setTimeout(() => {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch (err) {
            /* ignore */
          }
          objectUrlsRef.current = objectUrlsRef.current.filter(
            (url) => url !== objectUrl,
          );
        }, 600_000);
      }
    });

    // WebRTC signalling
    s.on("incoming-call", ({ from, offer }) => {
      setIncomingCall({ from, offer });
      setMessages((prev) => [
        ...prev,
        { system: true, text: `Incoming call from ${from.username}` },
      ]);
    });

    s.on("call-answered", async ({ from, answer }) => {
      const peer = pcRef.current;
      if (peer) {
        try {
          await peer.setRemoteDescription(answer);
        } catch (err) {
          console.error("call-answered remote desc error", err);
        }
      } else {
        console.warn("call-answered: pcRef.current missing");
      }
      setInCall(true);
    });

    s.on("ice-candidate", async ({ from, candidate }) => {
      const peer = pcRef.current;
      if (peer && candidate) {
        try {
          await peer.addIceCandidate(candidate);
        } catch (err) {
          console.error("Add ICE error", err);
        }
      } else if (!peer) {
        console.warn("ice-candidate received but pcRef.current is null");
      }
    });

    s.on("call-ended", ({ from }) => {
      endCall(false);
      setMessages((prev) => [
        ...prev,
        { system: true, text: `Call ended by ${from.username}` },
      ]);
    });

    return () => {
      if (socketRef.current === s) {
        socketRef.current = null;
      }
      s.disconnect();
    };
  }, [token, toast]);

  useEffect(() => {
    if (messagesRef.current)
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  async function loadHistory(target) {
    const dest = target || to;
    if (!dest) return;
    try {
      const resp = await ApiClient.get(`/messages/${dest}?limit=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const all = resp.data || [];
      // filter to last 1 month
      const since = new Date();
      since.setMonth(since.getMonth() - 1);
      const filtered = (all || []).filter((m) => {
        const t = new Date(m.createdAt || m.created_at || m.created);
        return !isNaN(t.getTime()) ? t >= since : false;
      });
      filtered.sort(
        (a, b) =>
          new Date(a.createdAt || a.created_at || a.created) -
          new Date(b.createdAt || b.created_at || b.created),
      );
      const destKey = String(dest);
      const cached = conversationCache[destKey]?.messages || [];
      const ephemeral = cached.filter((msg) => {
        const id = String(msg?._id || msg?.id || "");
        return id.startsWith("p2p_");
      });
      const combined = [...filtered, ...ephemeral];
      setMessages(combined);
      setConversationCache((c) => ({
        ...c,
        [destKey]: {
          messages: combined,
          lastFetched: Date.now(),
          scrollY: c[destKey]?.scrollY || 0,
        },
      }));
    } catch (err) {
      console.error("Error loading history", err);
    }
  }

  async function sendMessage() {
    const dest = to;
    if (!dest || !text) return;
    const activeSocket = socketRef.current;
    if (!activeSocket) {
      toast({ status: "error", title: "Socket not connected" });
      return;
    }
    const payload = { to: dest, content: text, meta: {} };
    activeSocket.emit("message", payload);
    setText("");
  }

  async function sendFile(e) {
    const file = e.target.files[0];
    if (!file || !to) return;
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("to", to);
      const resp = await ApiClient.post("/files/upload", fd, {
        headers: {
          "Content-Type": "multipart/form-data",
          Authorization: `Bearer ${token}`,
        },
      });
      // server will emit the file event to recipient and back to sender; don't duplicate here
      // clear selected filename after successful upload
      setSelectedFileName("");
    } catch (err) {
      console.error("Upload failed", err);
    }
  }

  function handleP2PFileSelect(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setP2pFiles((prev) => [...prev, ...files]);
  }

  function removeP2PFile(index) {
    setP2pFiles((prev) => prev.filter((_, idx) => idx !== index));
  }

  async function streamFileOverSocket(file, destId, requestId, fileId) {
    const activeSocket = socketRef.current;
    if (!activeSocket) throw new Error("Socket not connected");
    const totalChunks = Math.max(1, Math.ceil(file.size / P2P_CHUNK_SIZE));
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * P2P_CHUNK_SIZE;
      const end = Math.min(start + P2P_CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      const arrayBuffer = await slice.arrayBuffer();
      const chunkBase64 = arrayBufferToBase64(arrayBuffer);
      activeSocket.emit("p2p-file-chunk", {
        to: destId,
        requestId,
        fileId,
        index,
        totalChunks,
        chunk: chunkBase64,
        meta: { name: file.name, size: file.size, type: file.type },
      });
      // Yield to event loop to keep UI responsive
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function appendLocalP2PMessage(file, destId, requestId, fileId) {
    const objectUrl = URL.createObjectURL(file);
    objectUrlsRef.current.push(objectUrl);
    const now = new Date().toISOString();
    const message = {
      _id: `${requestId}-${fileId}-local`,
      from: {
        id: user?.id || user?._id,
        username: user?.username,
        displayName: user?.displayName || user?.username,
      },
      to: destId,
      file: {
        url: objectUrl,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      },
      createdAt: now,
    };
    const destKey = String(destId);
    setConversationCache((cache) => {
      const existing = cache[destKey]?.messages || [];
      if (
        existing.some(
          (m) => String(m._id || m.id) === String(message._id || message.id),
        )
      )
        return cache;
      return {
        ...cache,
        [destKey]: {
          messages: [...existing, message],
          lastFetched: Date.now(),
          scrollY: cache[destKey]?.scrollY || 0,
        },
      };
    });
    const activeId = String(activeIdRef.current || "");
    if (activeId === destKey) {
      setMessages((prev) => {
        if (
          prev.some(
            (m) => String(m._id || m.id) === String(message._id || message.id),
          )
        )
          return prev;
        return [...prev, message];
      });
    }
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        /* ignore */
      }
      objectUrlsRef.current = objectUrlsRef.current.filter((url) => url !== objectUrl);
    }, 600_000);
  }

  async function processAcceptedP2P(requestId, destId) {
    const pending = pendingP2PTransfersRef.current.get(requestId);
    if (!pending) return;
    const targetId = String(destId);
    try {
      const files = pending.files || [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        // eslint-disable-next-line no-await-in-loop
        await streamFileOverSocket(file, targetId, requestId, i);
        appendLocalP2PMessage(file, targetId, requestId, i);
      }
      if (files.length) {
        toast({
          status: "success",
          title: `Sent ${files.length} file${files.length === 1 ? "" : "s"} via P2P`,
        });
        setMessages((prev) => [
          ...prev,
          {
            system: true,
            text: `P2P transfer completed (${files.length} file${files.length === 1 ? "" : "s"}).`,
          },
        ]);
      }
    } catch (err) {
      console.error("P2P upload failed", err);
      toast({
        status: "error",
        title: "P2P transfer failed",
        description: err?.response?.data?.message || err.message || "Transfer failed",
      });
      setMessages((prev) => [
        ...prev,
        { system: true, text: "P2P transfer failed." },
      ]);
    } finally {
      pendingP2PTransfersRef.current.delete(requestId);
      setP2pSending(false);
    }
  }

  function resetP2PRequest(requestId) {
    pendingP2PTransfersRef.current.delete(requestId);
    setP2pSending(false);
  }

  function respondToIncomingP2P(accepted) {
    const activeSocket = socketRef.current;
    if (!incomingP2P || !activeSocket) return;
    const rawId =
      incomingP2P.from?.id || incomingP2P.from?._id || incomingP2P.from?.userId;
    const targetId = rawId ? String(rawId) : null;
    if (!targetId) {
      setIncomingP2P(null);
      return;
    }
    activeSocket.emit("p2p-response", {
      to: targetId,
      requestId: incomingP2P.requestId,
      accepted,
    });
    const senderName =
      incomingP2P.from?.displayName ||
      incomingP2P.from?.username ||
      "Sender";
    if (accepted) {
      toast({ status: "success", title: "P2P transfer accepted" });
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          text: `Accepted P2P transfer from ${senderName}.`,
        },
      ]);
    } else {
      toast({ status: "info", title: "P2P transfer declined" });
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          text: `Declined P2P transfer from ${senderName}.`,
        },
      ]);
    }
    setIncomingP2P(null);
  }

  const acceptP2PRequest = () => respondToIncomingP2P(true);
  const declineP2PRequest = () => respondToIncomingP2P(false);

  function sendP2PRequest() {
    const activeSocket = socketRef.current;
    if (!activeSocket || !to) {
      toast({ status: "error", title: "No recipient selected" });
      return;
    }
    if (!p2pFiles.length) {
      toast({ status: "warning", title: "Select at least one file" });
      return;
    }
    const targetId = String(to);
    const requestId = `p2p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const filesMeta = p2pFiles.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
    }));
    const filesCopy = p2pFiles.slice();
    pendingP2PTransfersRef.current.set(requestId, { to: targetId, files: filesCopy });
    activeSocket.emit("p2p-request", { to: targetId, requestId, files: filesMeta });
    setP2pSending(true);
    setMessages((prev) => [
      ...prev,
      {
        system: true,
        text: `P2P transfer request sent (${filesMeta.length} file${filesMeta.length === 1 ? "" : "s"}).`,
      },
    ]);
    toast({
      status: "info",
      title: "P2P request sent",
      description: "Waiting for recipient to accept",
    });
    setP2pFiles([]);
    closeP2PModal();
  }

  function handleOpenP2PModal() {
    if (p2pSending) {
      toast({ status: "info", title: "P2P transfer in progress" });
      return;
    }
    if (!recipient?.id) {
      toast({ status: "warning", title: "Select a user first" });
      return;
    }
    if (recipient?.isGroup) {
      toast({ status: "warning", title: "P2P transfer supports one-to-one chats" });
      return;
    }
    setP2pFiles([]);
    openP2PModal();
  }

  async function startCall() {
    if (!to) return alert("Set recipient userId or roomId");
    const activeSocket = socketRef.current;
    if (!activeSocket) {
      toast({ status: "error", title: "Socket not connected" });
      return;
    }
    try {
      const local = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setLocalStream(local);
      setCallActive(true);
      // Delay modal opening to ensure state updates first
      setTimeout(() => openCallModal(), 100);

      const configuration = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
      const newPc = new RTCPeerConnection(configuration);
      pcRef.current = newPc;
      setPc(newPc);
      callPeerIdRef.current = to;

      // add local tracks
      local.getTracks().forEach((track) => newPc.addTrack(track, local));

      newPc.ontrack = (ev) => {
        setRemoteStream(ev.streams[0]);
      };

      newPc.onicecandidate = (event) => {
        if (event.candidate)
          activeSocket.emit("ice-candidate", { to, candidate: event.candidate });
      };

      const offer = await newPc.createOffer();
      await newPc.setLocalDescription(offer);
      activeSocket.emit("call-user", { to, offer });
      setInCall(true);
    } catch (err) {
      console.error("Start call error", err);
    }
  }

  async function acceptCall() {
    if (!incomingCall) return;
    const { from, offer } = incomingCall;
    const activeSocket = socketRef.current;
    if (!activeSocket) {
      toast({ status: "error", title: "Socket not connected" });
      return;
    }
    try {
      const local = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      setLocalStream(local);
      // Ensure callActive is true so modal renders
      setCallActive(true);
      openCallModal();

      const configuration = {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      };
      const newPc = new RTCPeerConnection(configuration);
      pcRef.current = newPc;
      setPc(newPc);
      callPeerIdRef.current = from.id;

      local.getTracks().forEach((track) => newPc.addTrack(track, local));

      newPc.ontrack = (ev) => {
        setRemoteStream(ev.streams[0]);
      };

      newPc.onicecandidate = (event) => {
        if (event.candidate)
          activeSocket.emit("ice-candidate", {
            to: from.id,
            candidate: event.candidate,
          });
      };

      await newPc.setRemoteDescription(offer);
      const answer = await newPc.createAnswer();
      await newPc.setLocalDescription(answer);
      activeSocket.emit("answer-call", { to: from.id, answer });
      setInCall(true);
      setIncomingCall(null);
    } catch (err) {
      console.error("Accept call error", err);
    }
  }

  function declineCall() {
    setIncomingCall(null);
  }

  function endCall(emit = true) {
    try {
      const peer = pcRef.current;
      if (peer) {
        peer.getSenders().forEach((s) => s.track && s.track.stop());
        peer.close();
      }
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        setLocalStream(null);
      }
      setPc(null);
      pcRef.current = null;
      setRemoteStream(null);
      setInCall(false);
      setCallActive(false);
      setVideoPlaying({ local: false, remote: false });
      // Emit end-call to the other user's id (not the room/self id)
      const activeSocket = socketRef.current;
      if (emit && activeSocket && callPeerIdRef.current) {
        activeSocket.emit("end-call", { to: callPeerIdRef.current });
      }
    } catch (err) {
      console.error(err);
    }
  }

  // sign out is handled in Header; Chat doesn't manage auth here

  return (
    <div>
      <Box mb={4} p={3} bg="white" borderRadius="md" boxShadow="sm">
        <HStack justify="space-between">
          <Box>
            <HStack spacing={3} align="center">
              <Box position="relative">
                <SecureAvatar
                  token={token}
                  size="md"
                  src={recipient?.avatar}
                  initialUrl={recipient?.avatarSignedUrl}
                  initialExpiresAt={recipient?.avatarSignedExpiresAt}
                  name={recipient?.displayName || recipient?.username}
                />
                {recipient?.id &&
                  !recipient?.isGroup &&
                  onlineIds.includes(String(recipient.id)) && (
                    <Box
                      position="absolute"
                      bottom={0}
                      right={0}
                      w={3}
                      h={3}
                      bg="green.400"
                      borderRadius="full"
                      border="2px solid white"
                    />
                  )}
              </Box>
              <Box>
                <Heading size="sm">
                  {recipient?.displayName || "No recipient selected"}
                </Heading>
                <Text fontSize="sm" color="gray.500">
                  {!recipient?.id
                    ? "Select a person or group on the left"
                    : recipient?.isGroup
                      ? `${roomInfo?.members?.length || 0} members`
                      : onlineIds.includes(String(recipient.id))
                        ? "Online"
                        : "Offline"}
                </Text>
              </Box>
            </HStack>
          </Box>
          <HStack>
            {isMobile && recipient?.id && (
              <IconButton
                aria-label="Back"
                icon={<ArrowBackIcon />}
                onClick={() => onBack && onBack()}
              />
            )}
            {recipient?.id &&
              // Show for group chats OR other user (not self). Hide only for self-notepad or when no recipient.
              (recipient?.isGroup ||
                String(recipient.id) !== String(user?.id || user?._id)) && (
                <>
                  <IconButton
                    aria-label="Start call"
                    icon={<PhoneIcon />}
                    onClick={startCall}
                  />
                  <IconButton
                    aria-label="Peer to peer transfer"
                    icon={<RepeatIcon />}
                    onClick={handleOpenP2PModal}
                  />
                </>
              )}
          </HStack>
        </HStack>
      </Box>

      <VideoModal
        isOpen={isCallOpen && callActive}
        onClose={() => {
          setCallActive(false);
          closeCallModal();
          endCall(true);
        }}
        localStream={localStream}
        remoteStream={remoteStream}
        recipient={recipient}
        onEndCall={() => {
          setCallActive(false);
          closeCallModal();
          endCall(true);
        }}
      />

      <Modal
        isOpen={isP2POpen}
        onClose={() => {
          if (p2pSending) return;
          setP2pFiles([]);
          closeP2PModal();
        }}
        isCentered
        size="md"
      >
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Peer to Peer Transfer</ModalHeader>
          <ModalBody>
            <Stack spacing={4}>
              <Button
                onClick={() => p2pFileInputRef.current && p2pFileInputRef.current.click()}
                variant="outline"
                disabled={p2pSending}
              >
                Select files
              </Button>
              <input
                ref={p2pFileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  handleP2PFileSelect(e);
                  if (p2pFileInputRef.current) p2pFileInputRef.current.value = "";
                }}
              />
              {p2pFiles.length === 0 ? (
                <Text fontSize="sm" color="gray.500">
                  No files selected yet.
                </Text>
              ) : (
                <List spacing={2} maxH="200px" overflowY="auto">
                  {p2pFiles.map((file, idx) => (
                    <ListItem
                      key={`${file.name}-${idx}`}
                      display="flex"
                      alignItems="center"
                      justifyContent="space-between"
                      borderWidth="1px"
                      borderRadius="md"
                      px={3}
                      py={2}
                    >
                      <Box>
                        <Text fontWeight="semibold" fontSize="sm">
                          {file.name}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {(file.size / 1024).toFixed(1)} KB • {file.type || "unknown"}
                        </Text>
                      </Box>
                      <Button
                        size="xs"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => removeP2PFile(idx)}
                        disabled={p2pSending}
                      >
                        Remove
                      </Button>
                    </ListItem>
                  ))}
                </List>
              )}
            </Stack>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="ghost"
              mr={3}
              onClick={() => {
                if (p2pSending) return;
                setP2pFiles([]);
                closeP2PModal();
              }}
              disabled={p2pSending}
            >
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={sendP2PRequest}
              isDisabled={p2pFiles.length === 0 || p2pSending}
            >
              {p2pSending ? (
                <HStack spacing={2}>
                  <Spinner size="sm" />
                  <Text>Sending…</Text>
                </HStack>
              ) : (
                "Send Request"
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="messages" ref={messagesRef}>
              {messages.map((m, i) => {
              if (m.system)
                return (
                  <div
                    key={i}
                    className="meta"
                    style={{ textAlign: "center", color: "#666", margin: 8 }}
                  >
                    {m.text}
                  </div>
                );
              const fromId =
                (m.from && (m.from._id || m.from.id || m.from)) || m.from;
              const myId = user?.id || user?._id;
              const isMe = String(fromId) === String(myId);
              const content = m.content || m.text || "";
              const file = m.file || null;

              return (
                <div
                  key={m._id || m.id || i}
                  style={{
                    display: "flex",
                    justifyContent: isMe ? "flex-end" : "flex-start",
                    padding: "6px 0",
                  }}
                >
                  <div
                    style={{
                      background: isMe ? "#3182ce" : "#edf2f7",
                      color: isMe ? "white" : "black",
                      padding: "8px 12px",
                      borderRadius: 8,
                      maxWidth: "70%",
                    }}
                  >
                    <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>
                      {content}
                      {file ? (
                        <div style={{ marginTop: 8 }}>
                          <AttachmentPreview file={file} token={token} isOwn={isMe} />
                        </div>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: isMe ? "#e6f0ff" : "#666",
                        marginTop: 6,
                        textAlign: "right",
                      }}
                    >
                      {new Date(
                        m.createdAt || m.created_at || m.created,
                      ).toLocaleString()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Box mt={3}>
            <Flex align="center" gap={3}>
              <InputGroup>
                <Input
                  placeholder="Message"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendMessage();
                  }}
                />
                <InputRightElement>
                  <IconButton
                    aria-label="Send message"
                    icon={<ArrowForwardIcon />}
                    size="sm"
                    colorScheme="blue"
                    onClick={sendMessage}
                  />
                </InputRightElement>
              </InputGroup>

              <Menu placement={isMobile ? "top" : "bottom"}>
                <MenuButton
                  as={IconButton}
                  aria-label="Attach file"
                  icon={<AttachmentIcon />}
                  variant="outline"
                />
                <MenuList>
                  <MenuItem onClick={() => imageInputRef.current && imageInputRef.current.click()}>Image</MenuItem>
                  <MenuItem onClick={() => docInputRef.current && docInputRef.current.click()}>Document (PDF)</MenuItem>
                  <MenuItem onClick={() => videoInputRef.current && videoInputRef.current.click()}>Video</MenuItem>
                  <MenuItem onClick={() => zipInputRef.current && zipInputRef.current.click()}>Archive (ZIP)</MenuItem>
                </MenuList>
              </Menu>
              {selectedFileName ? (
                <Text
                  fontSize="sm"
                  color="gray.600"
                  noOfLines={1}
                  isTruncated
                  maxW="200px"
                >
                  {selectedFileName}
                </Text>
              ) : null}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  setSelectedFileName(f ? f.name : "");
                  sendFile(e);
                }}
              />
              <input
                ref={docInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  setSelectedFileName(f ? f.name : "");
                  sendFile(e);
                }}
              />
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  setSelectedFileName(f ? f.name : "");
                  sendFile(e);
                }}
              />
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip,application/x-zip-compressed"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  setSelectedFileName(f ? f.name : "");
                  sendFile(e);
                }}
              />
            </Flex>
          </Box>
        </div>
      </div>

      <Modal
        isOpen={!!incomingP2P}
        onClose={declineP2PRequest}
        isCentered
        size="sm"
        closeOnOverlayClick={false}
      >
        <ModalOverlay backdropFilter="blur(2px)" />
        <ModalContent>
          <ModalHeader px={4} py={3}>Incoming P2P Transfer</ModalHeader>
          <ModalBody pt={0} pb={3}>
            {incomingP2P && (
              <Stack spacing={3}>
                <HStack spacing={3} align="center">
                  <SecureAvatar
                    token={token}
                    size="md"
                    src={incomingP2P.from?.avatar}
                    initialUrl={incomingP2P.from?.avatarSignedUrl}
                    initialExpiresAt={incomingP2P.from?.avatarSignedExpiresAt}
                    name={
                      incomingP2P.from?.displayName ||
                      incomingP2P.from?.username
                    }
                  />
                  <Box>
                    <Text fontWeight="semibold" fontSize="sm">
                      {incomingP2P.from?.displayName ||
                        incomingP2P.from?.username}
                    </Text>
                    <Text fontSize="xs" color="gray.500">
                      wants to send {incomingP2P.files?.length || 0} file
                      {incomingP2P.files && incomingP2P.files.length === 1 ? "" : "s"}
                    </Text>
                  </Box>
                </HStack>
                <List spacing={2} maxH="200px" overflowY="auto">
                  {(incomingP2P.files || []).map((file, idx) => (
                    <ListItem
                      key={`${incomingP2P.requestId}-${file.name}-${idx}`}
                      borderWidth="1px"
                      borderRadius="md"
                      px={3}
                      py={2}
                    >
                      <HStack justify="space-between">
                        <Text fontSize="sm" fontWeight="medium">
                          {file.name}
                        </Text>
                        <Badge colorScheme="blue">
                          {(Number(file.size || 0) / 1024).toFixed(1)} KB
                        </Badge>
                      </HStack>
                      <Text fontSize="xs" color="gray.500">
                        {file.type || "unknown"}
                      </Text>
                    </ListItem>
                  ))}
                </List>
              </Stack>
            )}
          </ModalBody>
          <ModalFooter display="flex" justifyContent="space-between">
            <Button
              onClick={declineP2PRequest}
              variant="outline"
              colorScheme="red"
            >
              Decline
            </Button>
            <Button onClick={acceptP2PRequest} colorScheme="green">
              Accept & Download
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={!!incomingCall}
        onClose={declineCall}
        isCentered
        size="sm"
        closeOnOverlayClick={false}
      >
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent>
          <ModalHeader px={4} py={3}>
            Incoming Call
          </ModalHeader>
          <ModalBody pt={0} pb={2}>
            {incomingCall && (
              <HStack spacing={4} align="center">
                <SecureAvatar
                  token={token}
                  size="md"
                  src={incomingCall.from?.avatar}
                  initialUrl={incomingCall.from?.avatarSignedUrl}
                  initialExpiresAt={incomingCall.from?.avatarSignedExpiresAt}
                  name={
                    incomingCall?.from?.displayName || incomingCall?.from?.username
                  }
                />
                <Box>
                  <Text fontWeight="semibold" fontSize="sm">
                    {incomingCall?.from?.displayName ||
                      incomingCall?.from?.username}
                  </Text>
                  <Text fontSize="xs" color="gray.500">
                    is calling you...
                  </Text>
                </Box>
              </HStack>
            )}
          </ModalBody>
          <ModalFooter
            pt={0}
            pb={4}
            display="flex"
            justifyContent="space-between"
          >
            <Button onClick={declineCall} variant="outline" colorScheme="red">
              Decline
            </Button>
            <Button onClick={acceptCall} colorScheme="green">
              Accept
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
