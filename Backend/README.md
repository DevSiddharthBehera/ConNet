# ChatApp Backend (Express + Socket.IO)

This is a minimal backend scaffold for a chat application supporting:

- JWT authentication (register/login)
- One-to-one and group chat via Socket.IO
- WebRTC signaling events for video/audio/screen-sharing calls
- Simple file transfer via socket events

This is a demo scaffold intended to be replaced with a proper DB and production hardening.

Getting started

1. Install dependencies

```bash
cd Backend
npm install
```

2. Add an `.env` file (required for MongoDB)

```
PORT=4000
JWT_SECRET=your_secret_here
MONGODB_URI=your_mongodb_connection_string_here
```

MongoDB Atlas quick setup

1. Go to https://www.mongodb.com/cloud/atlas and sign up / log in.
2. Create a new free cluster (e.g., AWS, default settings).
3. In "Database Access" create a database user (username/password) and grant `readWrite` on the cluster.
4. In "Network Access" add an IP whitelist entry. For local development you can add `0.0.0.0/0` (less secure) or add your public IP.
5. Click "Connect" → "Connect your application" and copy the connection string. It looks like:

```
mongodb+srv://<username>:<password>@cluster0.abcd.mongodb.net/<dbname>?retryWrites=true&w=majority
```

Replace `<username>`, `<password>`, and `<dbname>` (for example `chatapp`) and paste it into `MONGODB_URI` in your `Backend/.env`.

Testing the connection and seeding test users

1. Ensure you added `MONGODB_URI` to `Backend/.env`.
2. Install backend deps and run the seed script:

```cmd
cd "c:\Users\siddharth behera\Desktop\ChatApp\Backend"
npm install
node scripts/seed.js
```

You should see created user ids for `alice`, `bob`, and `carol` (or a message that they already exist).

After seeding, start the backend:

```cmd
npm run dev
```


3. Run in development

```bash
npm run dev
```

Key files

- `src/index.js` — Express app + HTTP server + Socket.IO setup
- `src/routes/auth.js` — register/login using MongoDB via Mongoose
- `src/middleware/auth.js` — JWT verification for HTTP and socket handshakes
- `src/socket/socket.js` — main socket handlers (messages, files, signaling)

Notes & next steps

- Current user store is `data/users.json` (for demo). Replace with a real DB (Postgres, Mongo, Firebase).
- File transfer is demo-level and forwards file blobs via sockets; for large files use chunking, resumable uploads, or direct S3/GCS uploads.
- Add rate limits, input validation, HTTPS, CORS restrictions, and production-ready logging.

Client hints (Socket.IO)

Connect with token in `auth`:

```js
const socket = io('http://localhost:4000', { auth: { token } });
```

Basic events

- `message` — send to room or user id
- `typing` — typing indicator
- `file` — transfer file blob
- `call-user`, `answer-call`, `ice-candidate` — WebRTC signalling

