import React, { useEffect, useState } from "react";
import {
  Box,
  VStack,
  Avatar,
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
} from "@chakra-ui/react";
import { AddIcon } from "@chakra-ui/icons";
import { io } from "socket.io-client";
import API from "../api";

export default function Sidebar({ token, user, selected, onSelect, isMobile }) {
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
          });
        }
      }
    } catch (err) {
      console.error("Fetch lists error", err);
    } finally {
      setLoading(false);
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
            <Avatar name={user.displayName || user.username} />
            <Box>
              <Text fontWeight="bold">{user.displayName || user.username}</Text>
              <Text fontSize="sm" color="gray.500">
                {user.username}
              </Text>
            </Box>
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
                          <Avatar size="sm" name={c.displayName} />
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
    </>
  );
}
