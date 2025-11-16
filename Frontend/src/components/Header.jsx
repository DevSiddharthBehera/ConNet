import React from "react";
import {
  Flex,
  Box,
  Heading,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  IconButton,
  HStack,
  Text,
} from "@chakra-ui/react";
import SecureAvatar from "./SecureAvatar";

export default function Header({ user, onSignOut, token }) {
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
            icon={(
              <SecureAvatar
                token={token}
                src={user?.avatar}
                initialUrl={user?.avatarSignedUrl}
                initialExpiresAt={user?.avatarSignedExpiresAt}
                name={user?.displayName || user?.username}
                size="sm"
              />
            )}
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
