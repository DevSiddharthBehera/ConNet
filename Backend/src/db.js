const mongoose = require("mongoose");
const dns = require("dns");
require("dotenv").config();

// Prefer IPv4 first to avoid IPv6-only resolution issues in some networks
try {
  dns.setDefaultResultOrder(process.env.DNS_RESULT_ORDER || "ipv4first");
} catch (_) {
  // ignore if not supported
}

const PRIMARY_URI = process.env.MONGODB_URI;
const LOCAL_URI = process.env.MONGODB_LOCAL_URI || "mongodb://localhost:27017/chatapp";

let lastError = null;
let attempts = 0;
let currentTarget = PRIMARY_URI ? "primary" : "local";

function redactUri(uri) {
  try {
    const u = new URL(uri);
    if (u.password) u.password = "***";
    return u.toString();
  } catch (e) {
    // Fallback regex redaction for URIs that URL() cannot parse
    return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
  }
}

async function connect() {
  const maxRetries = parseInt(process.env.MONGODB_MAX_RETRIES || "10", 10);
  const fallbackToLocal = (process.env.MONGODB_FALLBACK_TO_LOCAL || "true") === "true";
  const serverSelectionTimeoutMS = parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || "5000", 10);
  let triedLocal = false;

  const uriForAttempt = () => {
    if (!PRIMARY_URI) return LOCAL_URI;
    if (triedLocal) return LOCAL_URI;
    return PRIMARY_URI;
  };

  const tryConnect = async () => {
    const uri = uriForAttempt();
    currentTarget = uri.startsWith('mongodb://localhost') ? 'local' : 'primary';
    attempts += 1;
    try {
      await mongoose.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS,
      });
      console.log(`Connected to MongoDB (${uri.startsWith('mongodb://localhost') ? 'local' : 'primary'})`);
      // reset error/attempts on success
      lastError = null;
      attempts = 0;
    } catch (err) {
      lastError = err.message || String(err);
      console.error(`MongoDB connection error (${redactUri(uri)}):`, lastError);

      // Immediately try local fallback after first primary failure, if enabled
      if (PRIMARY_URI && !triedLocal && fallbackToLocal && currentTarget === 'primary') {
        console.warn("Primary DB unreachable — attempting local MongoDB fallback.");
        triedLocal = true;
        attempts = 0;
        // try local immediately
        setTimeout(tryConnect, 1000);
        return;
      }

      const delay = Math.min(1000 * 2 ** Math.min(attempts, 6), 60 * 1000);
      console.log(`Retrying MongoDB connection in ${delay / 1000}s... (attempt ${attempts}/${maxRetries})`);
      setTimeout(tryConnect, delay);
    }
  };

  // start attempts but do not exit the process if DB is unreachable
  tryConnect();
}

function status() {
  return {
    readyState: mongoose && mongoose.connection ? mongoose.connection.readyState : 0,
    lastError,
    attempts,
    target: currentTarget,
  };
}

module.exports = { connect, mongoose, status };
