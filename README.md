# VolleyOps — Volleyball Club Management System

A full-stack web application for managing volleyball clubs: players, teams, schedules, payments, analytics, and real-time communication.

## Project Structure

```
volleyops/
├── backend/                  # Node.js + Express REST API
│   ├── routes/               # API route handlers (auth, teams, players, …)
│   ├── middleware/           # JWT authentication middleware
│   ├── scripts/              # Utility scripts (safe DB seed)
│   ├── db.js                 # SQLite database setup & schema
│   ├── seed.js               # Full seed data (dev use)
│   ├── server.js             # Express app entry point
│   ├── .env.example          # Environment variable template
│   └── railway.toml          # Railway deployment config
│
├── frontend/                 # React + Vite SPA
│   ├── src/
│   │   ├── api/              # Axios client (auto-detects Railway vs local)
│   │   ├── components/       # Shared UI components (Navbar, Sidebar, …)
│   │   ├── context/          # React context (Auth, Socket, Toast)
│   │   └── pages/            # Page components (Dashboard, Players, …)
│   ├── .env.production       # Production API URL
│   └── railway.toml          # Railway deployment config
│
├── design/                   # UI mockups & Figma exports (HTML prototypes)
└── start.bat                 # Local dev launcher (Windows)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, React Router, Axios, Socket.IO client |
| Backend | Node.js, Express, better-sqlite3, Socket.IO |
| Auth | JWT (access + refresh tokens), bcryptjs |
| AI | Anthropic Claude (tactics suggestions) |
| Deployment | Railway (Railpack builder, Node 20) |

## Getting Started (Local)

### Prerequisites
- Node.js 20+

### Backend
```bash
cd backend
cp .env.example .env        # fill in your secrets
npm install
node seed.js                # seed demo data (optional)
node server.js              # starts on :3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev                 # starts on :3000 (proxies /api → :3001)
```

Or run both with:
```
start.bat
```

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@volleyops.com | Admin123! |
| Coach | karim.mansour@volleyops.com | Coach123! |
| Player | hadi.cheaib@volleyops.com | Player123! |

## Environment Variables (Backend)

See `backend/.env.example` for the full list. Key variables:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for signing access tokens |
| `REFRESH_TOKEN_SECRET` | Secret for signing refresh tokens |
| `PORT` | Port the server listens on (default: 3001) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `DB_PATH` | Path to SQLite file (default: `./volleyops.db`) |
| `ANTHROPIC_API_KEY` | API key for AI tactics feature |

## Deployment (Railway)

The project uses two Railway services:

- **volleyops** (backend) — root directory: `backend`
- **volleyops-frontend** (frontend) — root directory: `frontend`

Both use the Railpack builder with Node 20.
