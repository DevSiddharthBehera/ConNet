const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
const fallbackOverrideRaw = typeof process.env.SUPABASE_FALLBACK_BUCKET === "string"
  ? process.env.SUPABASE_FALLBACK_BUCKET.trim()
  : "";
const disableFallback = ["none", "false", "off", "disable", "disabled"].includes(
  fallbackOverrideRaw.toLowerCase ? fallbackOverrideRaw.toLowerCase() : fallbackOverrideRaw,
);
const SUPABASE_FALLBACK_BUCKET = disableFallback
  ? null
  : fallbackOverrideRaw !== ""
    ? fallbackOverrideRaw
    : process.env.SUPABASE_DEFAULT_BUCKET || "public";
const USING_SERVICE_ROLE = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

let supabase = null;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("Supabase: SUPABASE_URL or SUPABASE_KEY not set. Supabase client will be disabled.");
} else {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false },
  });
  if (!USING_SERVICE_ROLE) {
    console.warn(
      "Supabase: using non-service (likely anon) key. Private bucket operations such as auto-creation may fail.",
    );
  }
}

const bucketReadyCache = new Map();
const bucketMissingWarned = new Set();
const bucketFallbackWarned = new Set();

function isNotFoundError(error) {
  if (!error) return false;
  const status = error.status ?? error.statusCode ?? error?.originalError?.status;
  if (typeof status === "number" && status === 404) return true;
  if (typeof status === "string" && status.includes("404")) return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("not found");
}

async function getBucketIfExists(name) {
  if (bucketReadyCache.get(name)) return { ok: true, bucket: name };
  const { data, error } = await supabase.storage.getBucket(name);
  if (!error && data) {
    bucketReadyCache.set(name, true);
    return { ok: true, bucket: name };
  }
  if (isNotFoundError(error)) {
    return { ok: false, missing: true };
  }
  if (error) {
    console.error(`Supabase getBucket error for "${name}":`, error);
    return { ok: false };
  }
  return { ok: false };
}

async function ensureBucket(bucketName, { publicBucket = false, fallbackBucket = SUPABASE_FALLBACK_BUCKET } = {}) {
  if (!supabase || !bucketName) return { ok: false, bucket: bucketName };

  try {
    const primary = await getBucketIfExists(bucketName);
    if (primary.ok) return primary;

    if (primary.missing && USING_SERVICE_ROLE) {
      const { error: createErr } = await supabase.storage.createBucket(bucketName, {
        public: publicBucket,
      });
      if (createErr) {
        console.error(`Supabase failed to create bucket "${bucketName}":`, createErr);
        return { ok: false, bucket: bucketName, missing: true };
      }
      bucketReadyCache.set(bucketName, true);
      console.log(`Supabase bucket "${bucketName}" created automatically.`);
      return { ok: true, bucket: bucketName, created: true };
    }

    if (primary.missing && !USING_SERVICE_ROLE) {
      if (!bucketMissingWarned.has(bucketName)) {
        bucketMissingWarned.add(bucketName);
        console.error(
          `Supabase bucket "${bucketName}" missing and cannot be created without SUPABASE_SERVICE_ROLE_KEY. ` +
            `Create it manually in the dashboard or provide the service role key.`,
        );
      }
    }

    const candidate = fallbackBucket && fallbackBucket !== bucketName ? fallbackBucket : null;
    if (primary.missing && candidate) {
      const fallback = await getBucketIfExists(candidate);
      if (fallback.ok) {
        if (!bucketFallbackWarned.has(candidate)) {
          bucketFallbackWarned.add(candidate);
          console.warn(
            `Supabase: using fallback bucket "${candidate}" because "${bucketName}" does not exist. ` +
              `Set SUPABASE_FALLBACK_BUCKET or create the preferred bucket to silence this warning.`,
          );
        }
        return { ok: true, bucket: candidate, fallback: true };
      }
      if (fallback.missing && !bucketMissingWarned.has(candidate)) {
        bucketMissingWarned.add(candidate);
        console.error(
          `Supabase fallback bucket "${candidate}" also missing. Create the bucket manually or provide a service role key.`,
        );
      }
      return { ok: false, bucket: bucketName, missing: true };
    }

    return { ok: primary.ok, bucket: bucketName, missing: primary.missing };
  } catch (err) {
    console.error(`Supabase ensureBucket exception for "${bucketName}":`, err);
    return { ok: false, bucket: bucketName };
  }
}

module.exports = {
  supabase,
  ensureBucket,
  USING_SERVICE_ROLE,
};
