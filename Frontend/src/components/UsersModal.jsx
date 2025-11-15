import React, { useEffect, useState } from "react";
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  Box,
  VStack,
  Text,
  Input,
} from "@chakra-ui/react";
import API from "../api";

export default function UsersModal({ isOpen, onClose, onSelect, token }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (isOpen) fetchUsers();
  }, [isOpen]);

  async function fetchUsers() {
    try {
      const resp = await API.get("/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(resp.data || []);
    } catch (err) {
      console.error("Fetch users error", err);
    }
  }

  const filtered = users.filter(
    (u) =>
      (u.username || "").toLowerCase().includes(query.toLowerCase()) ||
      (u.displayName || "").toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Select recipient</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <Input
            placeholder="Search users"
            mb={3}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <VStack align="stretch" spacing={2}>
            {filtered.map((u) => (
              <Box
                key={u.id}
                p={2}
                borderWidth={1}
                borderRadius="md"
                _hover={{ bg: "gray.50", cursor: "pointer" }}
                onClick={() => {
                  onSelect(u);
                  onClose();
                }}
              >
                <Text fontWeight="bold">{u.displayName || u.username}</Text>
                <Text fontSize="sm" color="gray.500">
                  {u.username} — {u.id}
                </Text>
              </Box>
            ))}
          </VStack>
        </ModalBody>

        <ModalFooter>
          <Button colorScheme="blue" mr={3} onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
