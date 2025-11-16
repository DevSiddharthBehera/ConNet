import React from "react";
import { Avatar } from "@chakra-ui/react";
import useSupabaseImage from "../hooks/useSupabaseImage";

export default function SecureAvatar({ src, token, initialUrl, initialExpiresAt, ...props }) {
  const resolved = useSupabaseImage(src, token, { initialUrl, initialExpiresAt });
  return <Avatar src={resolved || undefined} {...props} />;
}
