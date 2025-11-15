# ChatApp Frontend (React + Vite)

Minimal React frontend for the ChatApp backend.

Features

- Login / Register (calls `/api/auth` on backend)
- Simple chat UI that connects to Socket.IO server using JWT token
- Send messages, send small files (for demo, files are base64 forwarded via sockets)

Setup

```cmd
cd "c:\Users\siddharth behera\Desktop\ChatApp\Frontend"
npm install
npm run dev
```

Notes

- Ensure backend is running at `http://localhost:4000` (default from backend scaffold)
- This is a minimal demo to show interactions. For production:
  - Use a proper backend storage instead of base64 file forwarding
  - Add input validation, error handling, and styles
  - Implement WebRTC flow for calls (this scaffold only includes signaling events)
