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
            icon={<Avatar name={user.displayName || user.username} size="sm" />}
            variant="ghost"
          />
          <MenuList>
            <MenuItem
              onClick={() => window.alert("Edit profile - not implemented")}
            >
              Edit Profile
            </MenuItem>
            <MenuItem onClick={onSignOut}>Logout</MenuItem>
          </MenuList>
        </Menu>
      </Box>
    </Flex>
  );
}
