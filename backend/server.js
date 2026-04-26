require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const morgan   = require('morgan');
const jwt      = require('jsonwebtoken');

const db = require('./db');

const app    = express();
const server = http.createServer(app);

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:5173').split(',');

function isAllowedOrigin(origin) {
  if (!origin) return true;                                      // same-origin / server-to-server
  if (allowedOrigins.includes(origin)) return true;             // explicit whitelist
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin)) return true; // any Railway subdomain
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Attach io to every request so routes can emit events
app.use((req, _res, next) => { req.io = io; next(); });

// Socket.io auth + real-time messaging
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;

  // Each user joins their personal room for targeted notifications
  socket.join(`user:${userId}`);

  // Join a conversation room
  socket.on('join_conversation', (conversationId) => {
    // Verify membership before joining
    const member = db.prepare(
      `SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?`
    ).get(conversationId, userId);
    if (member) socket.join(`conv:${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conv:${conversationId}`);
  });

  // Typing indicator
  socket.on('typing', ({ conversationId, isTyping }) => {
    socket.to(`conv:${conversationId}`).emit('user_typing', {
      userId,
      conversationId,
      isTyping,
    });
  });

  socket.on('disconnect', () => {});
});

// Make io accessible in routes via app
app.set('io', io);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/players',       require('./routes/players'));
app.use('/api/teams',         require('./routes/teams'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/messages',      require('./routes/messages'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/standings',     require('./routes/standings'));
app.use('/api/tactics',       require('./routes/tactics'));
app.use('/api/ai',            require('./routes/ai'));
app.use('/api/matches',       require('./routes/matches'));
app.use('/api/notes',         require('./routes/notes'));
app.use('/api/team-requests', require('./routes/team-requests'));
app.use('/api/tryouts',       require('./routes/tryouts'));
app.use('/api/evaluations',   require('./routes/evaluations'));
app.use('/api/attendance',    require('./routes/attendance'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/calendar',      require('./routes/calendar'));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`VolleyOps API running on port ${PORT}`);
});
