import React from "react";
import {
  Flex,
  Box,
  Heading,
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  IconButton,
  HStack,
  Text,
} from "@chakra-ui/react";
import API from "../api";

// Helper to resolve avatar URLs to absolute URLs
function resolveAvatarUrl(avatar) {
  if (!avatar) return undefined;
  if (avatar.startsWith("http://") || avatar.startsWith("https://")) {
    return avatar; // Already absolute
  }
  // Convert relative path to absolute backend URL
  try {
    const backendOrigin = API.defaults.baseURL.replace(/\/api\/?$/, "");
    return `${backendOrigin}${avatar}`;
  } catch (e) {
    console.warn("Failed to resolve avatar URL:", avatar, e);
    return avatar;
  }
}

export default function Header({ user, onSignOut }) {
  return (
    <Flex
      as="header"
      bg="white"
      align="center"
      justify="space-between"
      p={4}
      boxShadow="sm"
    >
      <HStack spacing={4}>
        <Box>
          <Heading size="md">ConNet</Heading>
          <Text fontSize="sm" color="gray.500">
            Connect. Chat. Share.
          </Text>
        </Box>
      </HStack>

      <Box>
        <Menu>
          <MenuButton
            as={IconButton}
            icon={<Avatar src={resolveAvatarUrl(user?.avatar)} name={user?.displayName || user?.username} size="sm" />}
            variant="ghost"
          />
          <MenuList>
            <MenuItem onClick={() => window.alert("Edit profile - open sidebar profile modal")}>Edit Profile</MenuItem>
            <MenuItem onClick={onSignOut}>Logout</MenuItem>
          </MenuList>
        </Menu>
      </Box>
    </Flex>
  );
}
