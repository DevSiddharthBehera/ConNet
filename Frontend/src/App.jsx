import React, { useEffect, useState } from "react";
import { Box, Grid, useBreakpointValue } from "@chakra-ui/react";
import Login from "./components/Login";
import Chat from "./components/Chat";
import Header from "./components/Header";
import Sidebar from "./components/Sidebar";

function App() {
  const [token, setToken] = useState(localStorage.getItem("token"));
  const [user, setUser] = useState(
    JSON.parse(localStorage.getItem("user") || "null"),
  );
  const [selected, setSelected] = useState(null); // { id, displayName }

  // All hooks MUST be called before any conditional returns
  const bpIsMobile = useBreakpointValue({ base: true, md: false });
  const [isMobile, setIsMobile] = useState(() => {
    try {
      return window.innerWidth < 768;
    } catch (err) {
      return Boolean(bpIsMobile);
    }
  });
  const [mobileView, setMobileView] = useState("list"); // 'list' or 'chat'

  useEffect(() => {
    if (token) localStorage.setItem("token", token);
    else localStorage.removeItem("token");
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem("user", JSON.stringify(user));
    else localStorage.removeItem("user");
  }, [user]);

  useEffect(() => {
    // keep breakpoint value in sync when Chakra provides it
    if (typeof bpIsMobile !== "undefined") setIsMobile(Boolean(bpIsMobile));
  }, [bpIsMobile]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {}, [selected]);

  // Conditional return AFTER all hooks
  if (!token)
    return (
      <Login
        onAuth={(t, u) => {
          setToken(t);
          setUser(u);
        }}
      />
    );

  return (
    <Box minH="100vh" bg="gray.50">
      <Header
        user={user}
        onSignOut={() => {
          setToken(null);
          setUser(null);
        }}
      />
      <Grid
        templateColumns={{ base: "1fr", md: "320px 1fr" }}
        gap={4}
        maxW="1200px"
        mx="auto"
        p={4}
      >
        {/* On mobile show either Sidebar or Chat depending on selection */}
        {isMobile ? (
          mobileView === "chat" && selected ? (
            <Chat
              token={token}
              user={user}
              to={selected?.id}
              recipient={selected}
              isMobile
              onBack={() => {
                setSelected(null);
                setMobileView("list");
              }}
            />
          ) : (
              <Sidebar
                token={token}
                user={user}
                selected={selected}
                onSelect={(sel) => {
                  setSelected(sel);
                  setMobileView("chat");
                }}
                isMobile={isMobile}
                onUserChange={(u) => setUser(u)}
              />
          )
        ) : (
          <>
            <Sidebar
              token={token}
              user={user}
              selected={selected}
              onSelect={(sel) => {
                setSelected(sel);
              }}
              isMobile={isMobile}
              onUserChange={(u) => setUser(u)}
            />
            <Chat
              token={token}
              user={user}
              to={selected?.id}
              recipient={selected}
            />
          </>
        )}
      </Grid>
    </Box>
  );
}

export default App;
