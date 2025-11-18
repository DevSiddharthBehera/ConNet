const getWindowOrigin = () => {
  if (typeof window === "undefined" || !window.location) return "";
  return window.location.origin;
};

const origin = getWindowOrigin();
const isLocalVite = origin.includes("localhost:5173");

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  (isLocalVite ? "http://localhost:4000/api" : origin ? `${origin}/api` : "http://localhost:4000/api");

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (isLocalVite ? "http://localhost:4000" : origin || "http://localhost:4000");
