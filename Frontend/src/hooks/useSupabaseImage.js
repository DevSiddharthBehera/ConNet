import { useEffect, useState } from "react";
import API from "../api";

const cache = new Map();
const MIN_TTL_MS = 30 * 1000;
const DEFAULT_TTL_MS = 60 * 1000;

function isSupabaseRef(ref) {
  return typeof ref === "string" && ref.startsWith("supabase://");
}

export default function useSupabaseImage(ref, token, options = {}) {
  const { initialUrl, initialExpiresAt } = options;
  const [resolved, setResolved] = useState(() => {
    if (!ref) return undefined;
    if (initialUrl) return initialUrl;
    if (typeof ref === "string" && (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/uploads/"))) {
      return ref;
    }
    return undefined;
  });

  useEffect(() => {
    if (!ref) {
      setResolved(initialUrl || undefined);
      return;
    }

    if (typeof ref === "string" && (ref.startsWith("http://") || ref.startsWith("https://") || ref.startsWith("/uploads/"))) {
      setResolved(ref);
      return;
    }

    if (!isSupabaseRef(ref)) {
      setResolved(ref);
      return;
    }

    const cached = cache.get(ref);
    const now = Date.now();
    if (cached && cached.url && cached.expiresAt && cached.expiresAt > now + 5000) {
      setResolved(cached.url);
      return;
    }

    if (initialUrl && (!cached || !cached.url)) {
      let expiresAt = now + DEFAULT_TTL_MS;
      if (initialExpiresAt) {
        const ts = new Date(initialExpiresAt).getTime();
        if (!Number.isNaN(ts)) expiresAt = Math.max(ts - 5000, now + MIN_TTL_MS);
      }
      cache.set(ref, { url: initialUrl, expiresAt });
      setResolved(initialUrl);
      if (!token) return;
    }

    if (!token) {
      return;
    }

    let cancelled = false;
    async function fetchSigned() {
      try {
        const resp = await API.get("/files/signed-url", {
          params: { ref },
          headers: { Authorization: `Bearer ${token}` },
        });
        const signed = resp.data?.url;
        const expiresIn = Number(resp.data?.expiresIn || 0);
        const resolvedAt = Date.now();
        const expiresAt = expiresIn
          ? resolvedAt + Math.max(expiresIn * 1000, MIN_TTL_MS)
          : resolvedAt + DEFAULT_TTL_MS;
        if (signed) {
          cache.set(ref, { url: signed, expiresAt });
          if (!cancelled) setResolved(signed);
        }
      } catch (err) {
        console.error("Failed to resolve Supabase asset", err);
        if (!cancelled && cached?.url) {
          setResolved(cached.url);
        }
      }
    }

    fetchSigned();
    return () => {
      cancelled = true;
    };
  }, [ref, token, initialUrl, initialExpiresAt]);

  return resolved;
}
