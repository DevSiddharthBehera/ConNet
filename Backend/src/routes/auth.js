const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";

const User = require("../models/User");

router.post("/register", async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password)
      return res
        .status(400)
        .json({ message: "username and password required" });

    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ message: "User exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      username,
      password: hashed,
      displayName: displayName || username,
    });
    await user.save();

    const token = jwt.sign(
      {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.json({
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        about: user.about,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res
        .status(400)
        .json({ message: "username and password required" });

    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );
    res.json({
      token,
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
        avatar: user.avatar,
        about: user.about,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// OAuth routes: Google (simple demo flow)
// Requirements: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FRONTEND_URL in .env

async function findOrCreateOAuthUser({ provider, id, name, email }) {
  // create a username from provider+id if no email
  const username = email ? email.split("@")[0] : `${provider}_${id}`;
  let user = await User.findOne({
    $or: [{ username }, { "oauth.provider": provider, "oauth.providerId": id }],
  });
  if (!user) {
    user = new User({
      username,
      password: await bcrypt.hash(Math.random().toString(36), 8),
      displayName: name || username,
      oauth: { provider, providerId: id, email },
    });
    await user.save();
  }
  return user;
}

// redirect to provider
router.get("/google", (req, res) => {
  const popup = req.query.popup;
  const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
  // Don't include query params in redirect_uri - use state parameter instead
  const redirectUri = `${backendUrl}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    prompt: "select_account",
    state: popup ? 'popup' : 'redirect', // Pass popup state to callback
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  if (popup) return res.redirect(url);
  res.json({ url });
});

router.get("/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const state = req.query.state;
    const popup = state === 'popup';
    const backendUrl = process.env.BACKEND_URL || "http://localhost:4000";
    // Must match exactly what's registered in Google Console
    const redirectUri = `${backendUrl}/api/auth/google/callback`;
    const tokenResp = await axios.post(
      "https://oauth2.googleapis.com/token",
      new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const userInfoResp = await axios.get(
      `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenResp.data.access_token}`,
      { headers: { Authorization: `Bearer ${tokenResp.data.access_token}` } },
    );
    const info = userInfoResp.data; // { id, email, name, picture }

    const user = await findOrCreateOAuthUser({
      provider: "google",
      id: info.id,
      name: info.name,
      email: info.email,
    });
    const token = jwt.sign(
      {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName,
      },
      JWT_SECRET,
      { expiresIn: "7d" },
    );

    const userPayload = {
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      about: user.about,
    };

    // If opened as popup, postMessage back to opener and close
    if (popup) {
      const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
      return res.send(
        `<!doctype html><html><body><script>
        (function() {
          try {
            if (!window.opener) {
              document.body.innerHTML = '<h3>Error: Popup opened incorrectly. Please try again.</h3>';
              return;
            }
            var data = ${JSON.stringify({ token, user: userPayload })};
            console.log('Posting message to opener:', data);
            window.opener.postMessage(data, '${frontend}');
            document.body.innerHTML = '<h3>Success! Closing window...</h3>';
            setTimeout(function() { window.close(); }, 500);
          } catch(e) {
            console.error('postMessage error:', e);
            document.body.innerHTML = '<h3>Success! You can close this window.</h3>';
          }
        })();
        </script></body></html>`,
      );
    }

    // otherwise redirect to frontend with token
    const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
    res.redirect(`${frontend}/?token=${token}`);
  } catch (err) {
    console.error(
      "Google callback error",
      err?.response?.data || err.message || err,
    );
    res.status(500).send("OAuth error");
  }
});

module.exports = router;

