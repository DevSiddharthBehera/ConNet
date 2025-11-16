import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  VStack,
  Text,
  Input,
  Divider,
  HStack,
  Button,
  Spinner,
  IconButton,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Checkbox,
  Stack,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";
import { AddIcon, EditIcon } from "@chakra-ui/icons";
import { io } from "socket.io-client";
import API from "../api";
import Cropper from "react-easy-crop";
import SecureAvatar from "./SecureAvatar";

// Resize an image File to fixed width/height (center-cover) and return a new File
async function resizeImageFile(file, width, height) {
  if (!file) return file;
  // Use createImageBitmap for better performance when available
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    // Fallback to Image element
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  // cover (center-crop)
  const iw = bitmap.width || bitmap.naturalWidth || 0;
  const ih = bitmap.height || bitmap.naturalHeight || 0;
  if (!iw || !ih) return file;
  const scale = Math.max(width / iw, height / ih);
  const sw = iw * scale;
  const sh = ih * scale;
  const dx = (width - sw) / 2;
  const dy = (height - sh) / 2;

  // fill white background for non-transparent images
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, dx, dy, sw, sh);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, file.type || "image/jpeg", 0.9),
  );
  if (!blob) return file;
  const newFile = new File([blob], file.name, { type: blob.type });
  return newFile;
}

// Produce a cropped Blob from an image source and crop rectangle (pixels)
async function getCroppedImg(imageSrc, cropPixels, outputSize = 256, mime = 'image/jpeg') {
  if (!imageSrc || !cropPixels) return null;
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.setAttribute('crossOrigin', 'anonymous');
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = imageSrc;
  });

  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, outputSize, outputSize);

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  const blob = await new Promise((res) => canvas.toBlob(res, mime, 0.9));
  return blob;
}

export default function Sidebar({ token, user, selected, onSelect, isMobile }) {
  // onUserChange is optional callback passed from App to update logged-in user
  // signature: onUserChange(updatedUser)
  const onUserChange = arguments[0].onUserChange;
  const [users, setUsers] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState({}); // { userId/roomId: timestamp }
  const [lastMessageContent, setLastMessageContent] = useState({}); // { userId/roomId: message text }
  const [onlineIds, setOnlineIds] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({}); // { userId/roomId: count }
  const [socket, setSocket] = useState(null);
  const selectedRef = React.useRef(selected);
  const {
    isOpen: isCreateOpen,
    onOpen: openCreate,
    onClose: closeCreate,
  } = useDisclosure();
  const {
    isOpen: isProfileOpen,
    onOpen: openProfile,
    onClose: closeProfile,
  } = useDisclosure();
  const [profileDisplayName, setProfileDisplayName] = useState(
    user?.displayName || "",
  );
  const [profileAbout, setProfileAbout] = useState(user?.about || "");
  const toast = useToast();
  const avatarInputRef = React.useRef();
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState(null);
  const cropImgRef = useRef(null);
  const cropCanvasRef = useRef(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  // pan-based crop: position of image inside the fixed viewport
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const imgNaturalRef = useRef({ w: 0, h: 0 });
  const imgDisplayRef = useRef({ w: 0, h: 0, scale: 1 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState([]);

  useEffect(() => {
    if (token) fetchLists();
  }, [token]);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!token) return;
    const s = io("http://localhost:4000", { auth: { token } });
    setSocket(s);

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
          if (!id || prev.includes(id)) return prev;
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

    s.on("user-updated", (payload) => {
      try {
        const updatedId = String(payload?.id || payload?._id || "");
        if (!updatedId) return;
        setUsers((prev) =>
          (prev || []).map((u) => {
            const userId = String(u.id || u._id || "");
            return userId === updatedId
              ? {
                  ...u,
                  avatar: payload.avatar,
                  avatarSignedUrl: payload.avatarSignedUrl || u.avatarSignedUrl,
                  avatarSignedExpiresAt:
                    payload.avatarSignedExpiresAt || u.avatarSignedExpiresAt,
                }
              : u;
          }),
        );
      } catch (err) {
        console.error("user-updated handler error:", err);
      }
    });

    s.on("message", (msg) => {
      const fromId = String(msg.from?.id || msg.from?._id || msg.from);
      const toId = String(msg.to);
      const myId = String(user?.id || user?._id);

      let conversationId;
      if (msg.isGroup) {
        conversationId = toId;
      } else {
        conversationId = fromId === myId ? toId : fromId;
      }

      if (!conversationId) return;

      const content = msg.content || msg.text || "";
      const preview = fromId === myId ? `You: ${content}` : content;
      const ts = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
      setLastMessageTime((prev) => ({ ...prev, [conversationId]: ts }));
      setLastMessageContent((prev) => ({ ...prev, [conversationId]: preview }));

      const isActive =
        selectedRef.current && selectedRef.current.id === conversationId;
      if (fromId !== myId && !isActive) {
        setUnreadCounts((prev) => ({
          ...prev,
          [conversationId]: (prev[conversationId] || 0) + 1,
        }));
      }
    });

    return () => {
      s.disconnect();
    };
  }, [token, user]);

  // Fetch unread counts on mount
  useEffect(() => {
    if (token) fetchUnreadCounts();
  }, [token]);

  async function fetchUnreadCounts() {
    try {
      const resp = await API.get("/messages/unread/counts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUnreadCounts(resp.data || {});
    } catch (err) {
      console.error("Error fetching unread counts", err);
    }
  }

  async function fetchLists() {
    setLoading(true);
    try {
      const [uRes, rRes] = await Promise.all([
        API.get("/users", { headers: { Authorization: `Bearer ${token}` } }),
        API.get("/rooms", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const fetchedUsers = (uRes.data || []).map((u) => ({
        ...u,
        id: u.id || u._id,
      }));
      const fetchedRooms = (rRes.data || []).map((r) => ({
        ...r,
        id: r.id || r._id,
      }));
      setUsers(fetchedUsers);
      setRooms(fetchedRooms);

      // Sync the logged-in user's richer payload (avatar, signed URLs) if available
      if (typeof onUserChange === "function") {
        const myId = String(user?.id || user?._id || "");
        if (myId) {
          const selfEntry = fetchedUsers.find((u) => String(u.id) === myId);
          if (selfEntry) {
            const merged = {
              ...(user || {}),
              ...selfEntry,
            };
            // Update only if avatar metadata actually changed to avoid redundant renders
            const avatarChanged =
              merged.avatar !== user?.avatar ||
              merged.avatarSignedUrl !== user?.avatarSignedUrl ||
              merged.avatarSignedExpiresAt !== user?.avatarSignedExpiresAt;
            const profileChanged =
              merged.displayName !== user?.displayName || merged.about !== user?.about;
            if (avatarChanged || profileChanged) {
              onUserChange(merged);
              try {
                localStorage.setItem("user", JSON.stringify(merged));
              } catch (err) {
                /* ignore */
              }
            }
          }
        }
      }
      // fetch latest message timestamp for each user/room
      const { timestamps, contents } = await fetchLatestMessages(
        fetchedUsers,
        fetchedRooms,
      );
      // if nothing is selected, default-select the top conversation (skip auto-open on mobile)
      if ((!selected || !selected.id) && onSelect && !isMobile) {
        // build conversations locally and sort by timestamps
        const convs = [
          ...fetchedUsers.map((u) => ({
            ...u,
            type: "user",
            displayName: u.displayName || u.username,
          })),
          ...fetchedRooms.map((r) => ({
            ...r,
            type: "room",
            displayName: r.name || "Group",
          })),
        ];

        // Sort by timestamp (newest first). If timestamps tie or missing, prefer a non-self user, then a room, then any.
        convs.sort((a, b) => {
          const ta = timestamps[a.id] || 0;
          const tb = timestamps[b.id] || 0;
          if (ta !== tb) return tb - ta;
          // tie-breaker: prefer non-self users
          const myId = String(user?.id || user?._id);
          const aIsSelf = a.type === "user" && String(a.id) === myId;
          const bIsSelf = b.type === "user" && String(b.id) === myId;
          if (aIsSelf !== bIsSelf) return aIsSelf ? 1 : -1;
          // prefer users over rooms
          if (a.type !== b.type) return a.type === "user" ? -1 : 1;
          // finally sort alphabetically
          const an = (a.displayName || "").toLowerCase();
          const bn = (b.displayName || "").toLowerCase();
          return an < bn ? -1 : an > bn ? 1 : 0;
        });
        if (convs.length > 0) {
          // If all timestamps are zero (no messages), try to pick the first non-self user
          const allZero = Object.values(timestamps).every((v) => !v);
          let first = convs[0];
          if (allZero) {
            const myId = String(user?.id || user?._id);
            const nonSelf = convs.find(
              (c) => c.type === "user" && String(c.id) !== myId,
            );
            if (nonSelf) first = nonSelf;
            else {
              const firstRoom = convs.find((c) => c.type === "room");
              if (firstRoom) first = firstRoom;
            }
          }

          onSelect({
            id: first.id,
            displayName: first.displayName,
            isGroup: first.type === "room",
            avatar: first.avatar,
            avatarSignedUrl: first.avatarSignedUrl,
            avatarSignedExpiresAt: first.avatarSignedExpiresAt,
            username: first.username || first.name,
          });
        }
      }
    } catch (err) {
      console.error("Fetch lists error", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAvatarUpload(file) {
    if (!file) return;
    if (!token) return toast({ status: "error", title: "Not authenticated" });
    try {
      // open crop modal first: convert file to dataURL and let user crop
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      setCropImageSrc(dataUrl);
      // store file temporarily on ref for later use
      cropImgRef.current = { originalFile: file };
      setCropModalOpen(true);
      // return here; actual upload will happen after user confirms crop
      return;
    } catch (err) {
      console.error("Avatar select failed", err);
      toast({ status: "error", title: "Failed to prepare image" });
      return;
    }
  }

  // Called when user confirms crop in modal. Uses react-easy-crop's cropped pixels.
  async function confirmCropAndUpload() {
    const fileEntry = cropImgRef.current && cropImgRef.current.originalFile;
    if (!fileEntry || !cropImageSrc) {
      setCropModalOpen(false);
      return;
    }
    try {
      setUploadingAvatar(true);
      const OUTPUT_SIZE = 256;

      let blob;
      if (croppedAreaPixels) {
        blob = await getCroppedImg(cropImageSrc, croppedAreaPixels, OUTPUT_SIZE, fileEntry.type || 'image/jpeg');
      }

      if (!blob) {
        // fallback: just resize original file
        const resized = await resizeImageFile(fileEntry, OUTPUT_SIZE, OUTPUT_SIZE);
        const fd2 = new FormData();
        fd2.append('file', resized, resized.name || fileEntry.name);
        fd2.append('purpose', 'avatar');
        const resp2 = await API.post('/files/upload', fd2, {
          headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
        });
        const url2 = resp2.data?.url;
        const signed2 = resp2.data?.signedUrl;
        const signedExpiresAt2 = resp2.data?.signedExpiresAt;
        const updatedUser2 = resp2.data?.user
          ? { ...resp2.data.user, avatar: url2 || resp2.data.user.avatar }
          : { ...user, avatar: url2 };
        if (signed2) updatedUser2.avatarSignedUrl = signed2;
        if (signedExpiresAt2) updatedUser2.avatarSignedExpiresAt = signedExpiresAt2;
        setUsers((prev) => (prev || []).map((u) => {
          const userId = String(u.id || u._id || '');
          const updatedId = String(updatedUser2._id || updatedUser2.id || '');
          return userId === updatedId
            ? {
                ...u,
                avatar: url2,
                avatarSignedUrl: signed2 || u.avatarSignedUrl,
                avatarSignedExpiresAt: signedExpiresAt2 || u.avatarSignedExpiresAt,
              }
            : u;
        }));
        if (typeof onUserChange === 'function') onUserChange(updatedUser2);
        try { localStorage.setItem('user', JSON.stringify(updatedUser2)); } catch (e) {}
        toast({ status: 'success', title: 'Avatar updated' });
        return;
      }

      const outFile = new File([blob], fileEntry.name, { type: blob.type || 'image/jpeg' });
      const resizedFinal = await resizeImageFile(outFile, OUTPUT_SIZE, OUTPUT_SIZE);
      const fd = new FormData();
      fd.append('file', resizedFinal, resizedFinal.name || outFile.name);
      fd.append('purpose', 'avatar');
      const resp = await API.post('/files/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data', Authorization: `Bearer ${token}` },
      });
      const url = resp.data?.url;
      const signed = resp.data?.signedUrl;
      const signedExpiresAt = resp.data?.signedExpiresAt;
      const updatedUser = resp.data?.user
        ? { ...resp.data.user, avatar: url || resp.data.user.avatar }
        : { ...user, avatar: url };
      if (signed) updatedUser.avatarSignedUrl = signed;
      if (signedExpiresAt) updatedUser.avatarSignedExpiresAt = signedExpiresAt;
      setUsers((prev) => (prev || []).map((u) => {
        const userId = String(u.id || u._id || '');
        const updatedId = String(updatedUser._id || updatedUser.id || '');
        return userId === updatedId
          ? {
              ...u,
              avatar: url,
              avatarSignedUrl: signed || u.avatarSignedUrl,
              avatarSignedExpiresAt: signedExpiresAt || u.avatarSignedExpiresAt,
            }
          : u;
      }));
      if (typeof onUserChange === 'function') onUserChange(updatedUser);
      try { localStorage.setItem('user', JSON.stringify(updatedUser)); } catch (e) {}
      toast({ status: 'success', title: 'Avatar updated' });
    } catch (err) {
      console.error('Avatar upload failed', err);
      toast({ status: 'error', title: 'Upload failed' });
    } finally {
      setUploadingAvatar(false);
      setCropModalOpen(false);
    }
  }

  async function handleProfileSave() {
    if (!token) return toast({ status: "error", title: "Not authenticated" });
    try {
      const resp = await API.patch(
        "/users/me",
        { displayName: profileDisplayName, about: profileAbout },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const updated = resp.data;
      setUsers((prev) =>
        (prev || []).map((u) =>
          String(u.id) === String(updated.id)
            ? { ...u, displayName: updated.displayName, about: updated.about, avatar: updated.avatar }
            : u,
        ),
      );
      if (typeof onUserChange === "function") onUserChange(updated);
      try {
        localStorage.setItem("user", JSON.stringify(updated));
      } catch (err) {
        /* ignore */
      }
      toast({ status: "success", title: "Profile updated" });
      closeProfile();
    } catch (err) {
      console.error("Profile save failed", err);
      toast({ status: "error", title: "Save failed" });
    }
  }

  async function fetchLatestMessages(userList, roomList) {
    try {
      const timestamps = {};
      const contents = {};
      const myId = String(user?.id || user?._id);

      // fetch messages for each user and room, get the latest timestamp and content
      for (const u of userList) {
        try {
          const resp = await API.get(`/messages/${u.id}?limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.data && resp.data.length > 0) {
            const msg = resp.data[0];
            timestamps[u.id] = new Date(
              msg.createdAt || msg.created_at,
            ).getTime();
            const fromId = String(msg.from?.id || msg.from?._id || msg.from);
            const content = msg.content || msg.text || "";
            contents[u.id] = fromId === myId ? `You: ${content}` : content;
          }
        } catch (err) {
          /* ignore individual fetch errors */
        }
      }
      for (const r of roomList) {
        try {
          const resp = await API.get(`/messages/${r.id}?limit=1`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.data && resp.data.length > 0) {
            const msg = resp.data[0];
            timestamps[r.id] = new Date(
              msg.createdAt || msg.created_at,
            ).getTime();
            const fromId = String(msg.from?.id || msg.from?._id || msg.from);
            const content = msg.content || msg.text || "";
            contents[r.id] = fromId === myId ? `You: ${content}` : content;
          }
        } catch (err) {
          /* ignore individual fetch errors */
        }
      }
      setLastMessageTime(timestamps);
      setLastMessageContent(contents);
      return { timestamps, contents };
    } catch (err) {
      console.error("Fetch latest messages error", err);
      return { timestamps: {}, contents: {} };
    }
  }

  // Create unified conversation list like WhatsApp
  const conversations = [
    ...users.map((u) => ({
      ...u,
      type: "user",
      displayName: u.displayName || u.username,
    })),
    ...rooms.map((r) => ({
      ...r,
      type: "room",
      displayName: r.name || "Group",
    })),
  ];

  const filteredConversations = conversations
    .filter((c) => {
      const name = c.displayName || c.username || c.name || "";
      return name.toLowerCase().includes(query.toLowerCase());
    })
    .sort((a, b) => {
      const timeA = lastMessageTime[a.id] || 0;
      const timeB = lastMessageTime[b.id] || 0;
      return timeB - timeA; // newest first
    });

  return (
    <>
      <Box bg="white" p={4} borderRadius="md" boxShadow="sm">
        <VStack align="stretch" spacing={4}>
          <HStack spacing={3} align="center">
            <Box position="relative">
              <SecureAvatar
                token={token}
                src={user?.avatar}
                initialUrl={user?.avatarSignedUrl}
                initialExpiresAt={user?.avatarSignedExpiresAt}
                name={user?.displayName || user?.username}
              />
              <IconButton
                size="xs"
                aria-label="Change avatar"
                icon={<EditIcon />}
                position="absolute"
                bottom={-1}
                right={-1}
                borderRadius="full"
                onClick={() => {
                  setProfileDisplayName(user?.displayName || "");
                  setProfileAbout(user?.about || "");
                  openProfile();
                }}
              />
            </Box>
            <Box>
              <Text fontWeight="bold">{user.displayName || user.username}</Text>
              <Text fontSize="sm" color="gray.500">
                {user.username}
              </Text>
            </Box>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) handleAvatarUpload(f);
              }}
            />
          </HStack>

          <Input
            placeholder="Search conversations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <Divider />

          <Box>
            <HStack justify="space-between" mb={2}>
              <Text fontSize="sm" fontWeight="semibold">
                Conversations
              </Text>
              <IconButton
                size="sm"
                aria-label="Create group"
                icon={<AddIcon />}
                onClick={openCreate}
              />
            </HStack>
            {loading ? (
              <Spinner />
            ) : (
              <VStack align="stretch" spacing={2} maxH="480px" overflowY="auto">
                {filteredConversations.map((c) => {
                  const isOnline =
                    c.type === "user" && onlineIds.includes(String(c.id));
                  const unreadCount = unreadCounts[c.id] || 0;
                  const isSelf =
                    c.type === "user" && String(c.id) === String(user.id);
                  return (
                    <Box
                      key={c.id}
                      p={2}
                      borderWidth={selected?.id === c.id ? 2 : 1}
                      borderRadius="md"
                      borderColor={
                        selected?.id === c.id ? "blue.400" : "gray.100"
                      }
                      _hover={{ bg: "gray.50", cursor: "pointer" }}
                      onClick={() => {
                        onSelect({
                          id: c.id,
                          displayName: c.displayName,
                          isGroup: c.type === "room",
                          avatar: c.avatar,
                          avatarSignedUrl: c.avatarSignedUrl,
                          avatarSignedExpiresAt: c.avatarSignedExpiresAt,
                          username: c.username || c.name,
                        });
                        // Mark as read
                        if (!isSelf && socket && unreadCount > 0) {
                          socket.emit("mark-read", { conversationId: c.id });
                          setUnreadCounts((prev) => ({ ...prev, [c.id]: 0 }));
                        }
                      }}
                    >
                      <HStack spacing={2} align="start">
                        <Box position="relative">
                          <SecureAvatar
                            token={token}
                            size="sm"
                            src={c.avatar}
                            initialUrl={c.avatarSignedUrl}
                            initialExpiresAt={c.avatarSignedExpiresAt}
                            name={c.displayName}
                          />
                          {isOnline && !isSelf && (
                            <Box
                              position="absolute"
                              bottom={0}
                              right={0}
                              w={2.5}
                              h={2.5}
                              bg="green.400"
                              borderRadius="full"
                              border="2px solid white"
                            />
                          )}
                        </Box>
                        <Box flex={1} minW={0}>
                          <HStack justify="space-between">
                            <Text fontWeight="medium" fontSize="sm">
                              {c.displayName}
                            </Text>
                            {!isSelf && unreadCount > 0 && (
                              <Box
                                bg="blue.500"
                                color="white"
                                borderRadius="full"
                                minW={5}
                                h={5}
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                fontSize="xs"
                                px={1.5}
                              >
                                {unreadCount > 99 ? "99+" : unreadCount}
                              </Box>
                            )}
                          </HStack>
                          <Text
                            fontSize="xs"
                            color="gray.500"
                            noOfLines={1}
                            isTruncated
                          >
                            {isSelf
                              ? "Self (notepad)"
                              : lastMessageContent[c.id] ||
                                (c.type === "room"
                                  ? `${c.members?.length || 0} members`
                                  : "No messages yet")}
                          </Text>
                        </Box>
                      </HStack>
                    </Box>
                  );
                })}
              </VStack>
            )}
          </Box>

          <Divider />
          <HStack>
            <Button size="sm" onClick={fetchLists}>
              Refresh
            </Button>
          </HStack>
        </VStack>
      </Box>

      <Modal isOpen={isCreateOpen} onClose={closeCreate} size="md">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Create Group</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <FormControl mb={3}>
              <FormLabel>Group name</FormLabel>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Friends"
              />
            </FormControl>

            <FormControl>
              <FormLabel>Select members</FormLabel>
              <Stack spacing={2} maxH="200px" overflowY="auto">
                {users.map((u) => (
                  <Checkbox
                    key={u.id}
                    isChecked={groupMembers.includes(u.id)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setGroupMembers((prev) =>
                        checked
                          ? [...prev, u.id]
                          : prev.filter((id) => id !== u.id),
                      );
                    }}
                  >
                    {u.displayName || u.username}
                  </Checkbox>
                ))}
              </Stack>
            </FormControl>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={closeCreate}>
              Cancel
            </Button>
            <Button
              colorScheme="blue"
              onClick={async () => {
                try {
                  setLoading(true);
                  const resp = await API.post(
                    "/rooms",
                    { name: groupName, members: groupMembers },
                    { headers: { Authorization: `Bearer ${token}` } },
                  );
                  // refresh lists and select new
                  await fetchLists();
                  onSelect({ id: resp.data.id, displayName: resp.data.name });
                  setGroupName("");
                  setGroupMembers([]);
                  closeCreate();
                } catch (err) {
                  console.error("Create room error", err);
                } finally {
                  setLoading(false);
                }
              }}
            >
              Create
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      {/* Crop modal for avatar selection */}
      <Modal isOpen={cropModalOpen} onClose={() => setCropModalOpen(false)} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Crop avatar</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Box>
              {cropImageSrc ? (
                <Box>
                  {/* fixed square viewport where user pans image to choose center */}
                  <Box style={{ width: 256, height: 256, position: 'relative', background: '#f7fafc' }}>
                    <Cropper
                      image={cropImageSrc}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={(area, areaPixels) => setCroppedAreaPixels(areaPixels)}
                      showGrid={false}
                      cropShape="rect"
                    />
                  </Box>
                  <Box mt={3} display="flex" alignItems="center" gap={3}>
                    <Text fontSize="sm">Zoom</Text>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                  </Box>
                  <canvas ref={cropCanvasRef} style={{ display: 'none' }} />
                </Box>
              ) : (
                <Text>No image selected</Text>
              )}
            </Box>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={() => setCropModalOpen(false)}>
              Cancel
            </Button>
            <Button colorScheme="blue" onClick={confirmCropAndUpload} isLoading={uploadingAvatar}>
              Upload
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={isProfileOpen} onClose={closeProfile} size="md">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Edit Profile</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Box display="flex" alignItems="center" flexDirection="column" mb={4}>
              <Box position="relative">
                <SecureAvatar
                  token={token}
                  size="xl"
                  src={user?.avatar}
                  initialUrl={user?.avatarSignedUrl}
                  initialExpiresAt={user?.avatarSignedExpiresAt}
                  name={user?.displayName || user?.username}
                />
                <IconButton
                  aria-label="Change avatar"
                  icon={<EditIcon />}
                  size="sm"
                  position="absolute"
                  bottom={0}
                  right={0}
                  onClick={() => avatarInputRef.current && avatarInputRef.current.click()}
                />
              </Box>
              <Text fontSize="sm" color="gray.500" mt={2} textAlign="center">
                {user?.username}
              </Text>
            </Box>

            <FormControl mb={3}>
              <FormLabel>Display name</FormLabel>
              <Input value={profileDisplayName} onChange={(e) => setProfileDisplayName(e.target.value)} />
            </FormControl>

            <FormControl>
              <FormLabel>About</FormLabel>
              <Input value={profileAbout} onChange={(e) => setProfileAbout(e.target.value)} />
            </FormControl>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (f) handleAvatarUpload(f);
              }}
            />
          </ModalBody>
          <ModalFooter>
            <Button mr={3} variant="ghost" onClick={closeProfile}>
              Cancel
            </Button>
            <Button colorScheme="blue" onClick={handleProfileSave} isLoading={uploadingAvatar}>
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
