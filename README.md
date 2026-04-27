# VolleyOps — Volleyball Club Management System

A full-stack web application for managing volleyball clubs: players, teams, schedules, payments, analytics, and real-time communication.

---

## Architecture

```
volleyops/
├── backend/                  # Node.js + Express REST API
│   ├── routes/               # One file per feature (auth, teams, players, matches, …)
│   ├── middleware/           # JWT authentication + role guard
│   ├── scripts/              # Utility scripts (safe DB seed)
│   ├── db.js                 # SQLite schema, migrations, WAL setup
│   ├── server.js             # Express + Socket.IO entry point
│   ├── volleyops.db          # SQLite database (data lives here)
│   ├── .env                  # Local secrets (never committed)
│   └── .env.example          # Template for .env
│
├── frontend/                 # React 18 + Vite SPA
│   ├── src/
│   │   ├── api/              # Axios client — auto-detects backend URL
│   │   ├── components/       # Navbar, Sidebar, shared UI
│   │   ├── context/          # AuthContext, SocketContext, ToastContext
│   │   └── pages/            # Dashboard, Players, Teams, Schedule, …
│   └── .env.production       # Production API URL (Railway)
│
├── design/                   # UI mockups / Figma exports
└── start.bat                 # One-click launcher for Windows
```

### How the layers connect

| Concern | Technology |
|---------|------------|
| Frontend | React 18, Vite, React Router v6, Axios |
| Backend API | Node.js 20, Express, `better-sqlite3` |
| Real-time | Socket.IO (messages, notifications, standings) |
| Auth | JWT access + refresh tokens, bcryptjs, `is_active` gate |
| AI | Anthropic Claude (tactics board suggestions) |
| Database | SQLite 3 — single file `backend/volleyops.db` |
| Deployment | Railway (two services — backend + frontend) |

The frontend **proxies** all `/api` requests to the backend during development (`vite.config.js` proxy → `http://localhost:3001`). In production the frontend reads `VITE_API_URL` to talk directly to the Railway backend.

Socket.IO runs on the same Express server (port 3001). The client connects via the same base URL and joins rooms per user (`user:<id>`) and per conversation (`conv:<id>`).

---

## Running Locally (step by step)

### Prerequisites
- **Node.js 20+** — download from https://nodejs.org
- No database setup needed — SQLite is embedded; the DB file is included in the project.

### 1 — Backend

```bash
cd backend
cp .env.example .env        # copy template, then edit .env with your values
npm install                 # installs dependencies including better-sqlite3 native binary
node server.js              # API starts on http://localhost:3001
```

On first start the server seeds demo accounts automatically if the database is empty.

### 2 — Frontend (separate terminal)

```bash
cd frontend
npm install
npm run dev                 # React dev server starts on http://localhost:3000
```

Open **http://localhost:3000** in your browser.

### One-click (Windows only)

Double-click `start.bat` — it opens two terminal windows (backend + frontend) and installs dependencies automatically if `node_modules` is missing.

---

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@volleyops.com | Admin123! |
| Coach (Cedar Spikers) | karim.mansour@volleyops.com | Coach123! |
| Coach (Bayern) | ali.hassan@volleyops.com | Coach123! |
| Player | hadi.cheaib@volleyops.com | Player123! |

---

## Environment Variables (Backend)

Copy `backend/.env.example` to `backend/.env` and fill in:

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing access tokens | — (required) |
| `REFRESH_TOKEN_SECRET` | Secret for signing refresh tokens | — (required) |
| `PORT` | Port the API listens on | `3001` |
| `APP_URL` | Frontend URL (used in password-reset emails) | `http://localhost:3000` |
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:3000` |
| `DB_PATH` | Path to SQLite file | `./volleyops.db` |
| `ANTHROPIC_API_KEY` | For AI tactics suggestions (optional) | — |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS` | Email sending (optional) | — |

---

## Data Persistence & Zipping

The entire database is stored in `backend/volleyops.db`. SQLite uses **WAL (Write-Ahead Log)** mode, which may create two companion files:

- `volleyops.db` — main database file
- `volleyops.db-shm` — shared memory index (transient)
- `volleyops.db-wal` — write-ahead log (pending writes)

**When zipping the project to move it to another device:**

1. Stop the backend server first (close the terminal window or Ctrl+C).
2. Include the entire `backend/` folder in your zip — all three `.db*` files will be present.
3. On the destination device, run `npm install` inside `backend/` before starting — `better-sqlite3` is a native Node.js addon that must be recompiled for each OS/CPU architecture.

The server automatically checkpoints the WAL into the main `.db` file on every startup, so even if only `volleyops.db` is copied (without the `-shm`/`-wal` companions), all previously committed data will be intact after the next server start.

> **Note:** `better-sqlite3` ships a prebuilt binary for the OS where `npm install` was run. If you move the zip from Windows to macOS or Linux (or vice versa), you **must** run `npm install` again inside `backend/` to recompile the native binary for the new platform. The rest of the application code is portable as-is.

---

## Deployment (Railway)

The project uses two Railway services:

- **volleyops** (backend) — root directory: `backend`
- **volleyops-frontend** (frontend) — root directory: `frontend`

Both use the Railpack builder with Node 20.

Attach a Railway Volume to the backend service and set `DB_PATH=/data/volleyops.db` so data survives redeploys. Set `APP_URL` to the deployed frontend URL so password-reset links work correctly.

Do **not** run `backend/seed.js` on a real database — it wipes all data. Use `backend/scripts/seed.js` (safe, only seeds if empty).
