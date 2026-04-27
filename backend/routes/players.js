const express = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

function makeAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function makeRefreshToken(userId) {
  const token     = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`).run(userId, token, expiresAt);
  return token;
}

const router = express.Router();

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ errors: errors.array() }); return true; }
  return false;
}

function pushNotification(io, userId, type, title, body_) {
  if (!io || !userId) return;
  try {
    db.prepare(
      `INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`
    ).run(userId, type, title, body_);
    io.to(`user:${userId}`).emit('notification', { type, title, body: body_ });
  } catch {}
}

// ─── POST /api/players ────────────────────────────────────────────────────────
// Public: anyone can submit a registration form. Creates a user account too.
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('team_id').notEmpty().withMessage('Please select a team').isInt({ min: 1 }).withMessage('Invalid team'),
  body('phone').optional().trim(),
  body('date_of_birth').optional().isISO8601(),
  body('position').optional().isIn([
    'setter', 'libero', 'outside_hitter', 'opposite',
    'middle_blocker', 'defensive_specialist',
  ]),
  body('jersey_number').optional().isInt({ min: 0, max: 99 }),
  body('season').optional().trim(),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const {
    name, email, password, team_id, phone, date_of_birth, position,
    jersey_number, season, notes,
  } = req.body;

  // Validate team exists
  const team = db.prepare(`SELECT id, name FROM teams WHERE id = ?`).get(Number(team_id));
  if (!team) return res.status(404).json({ error: 'Selected team not found' });

  // Check email not already taken
  const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const existingPlayer = db.prepare(`SELECT id FROM players WHERE email = ?`).get(email);
  if (existingPlayer) {
    return res.status(409).json({ error: 'A registration with this email already exists' });
  }

  // Create user account (player role, pending approval)
  const passwordHash = bcrypt.hashSync(password, 12);
  const userResult = db.prepare(
    `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'player')`
  ).run(name, email, passwordHash);
  const userId = userResult.lastInsertRowid;

  // Create player record linked to user and team
  const playerResult = db.prepare(`
    INSERT INTO players (user_id, name, email, phone, date_of_birth, position, jersey_number, team_id, season, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, name, email, phone ?? null, date_of_birth ?? null, position ?? null,
         jersey_number ?? null, Number(team_id), season ?? null, notes ?? null);
  const playerId = playerResult.lastInsertRowid;

  // Immediately add to team_players so they can see team/matches right away
  db.prepare(`INSERT OR IGNORE INTO team_players (team_id, player_id, is_active) VALUES (?, ?, 1)`)
    .run(Number(team_id), playerId);

  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);

  // Notify admins
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();
  const io = req.app.get('io');
  admins.forEach(a => pushNotification(io, a.id, 'new_registration',
    'New Player Registration', `${name} applied to join ${team.name} and is awaiting approval.`));

  // Return tokens so the player is logged in immediately
  const user = db.prepare(`SELECT id, name, email, role, is_active FROM users WHERE id = ?`).get(userId);
  const accessToken  = makeAccessToken(user);
  const refreshToken = makeRefreshToken(userId);

  res.status(201).json({ user, player, accessToken, refreshToken });
});

// ─── GET /api/players ─────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'coach', 'assistant_coach'), (req, res) => {
  const { status, position, season, team_id, search, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let sql    = `
    SELECT p.*,
           t.name AS team_name
    FROM players p
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    LEFT JOIN teams t          ON t.id = tp.team_id
    WHERE 1=1
  `;
  const params = [];

  if (status)  { sql += ` AND p.registration_status = ?`; params.push(status); }
  if (position){ sql += ` AND p.position = ?`;            params.push(position); }
  if (season)  { sql += ` AND p.season = ?`;              params.push(season); }
  if (team_id) { sql += ` AND tp.team_id = ?`;            params.push(Number(team_id)); }
  if (search)  {
    sql += ` AND (p.name LIKE ? OR p.email LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`);
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
  sql += ` ORDER BY p.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);

  const players = db.prepare(sql).all(...params);
  res.json({ players, total, page: Number(page), limit: Number(limit) });
});

// ─── GET /api/players/stats ───────────────────────────────────────────────────
// Returns players with their season stats for the coach's teams.
// Query params: team_id (optional), season (optional, default '2024-2025')
router.get('/stats', authenticate, requireRole('admin', 'coach', 'assistant_coach'), (req, res) => {
  const { team_id, season = '2024-2025' } = req.query;

  let teamFilter = '';
  const params = [season];

  if (team_id) {
    teamFilter = 'AND tp.team_id = ?';
    params.push(Number(team_id));
  } else if (req.user.role === 'coach') {
    teamFilter = 'AND t.coach_id = ?';
    params.push(req.user.id);
  } else if (req.user.role === 'assistant_coach') {
    teamFilter = 'AND t.assistant_coach_id = ?';
    params.push(req.user.id);
  }

  const rows = db.prepare(`
    SELECT
      p.id, p.name, p.position, p.jersey_number,
      t.id   AS team_id,
      t.name AS team_name,
      t.division,
      s.matches_played, s.sets_played,
      s.points, s.kills, s.aces, s.blocks, s.digs, s.errors,
      ROUND(CAST(s.points AS REAL) / NULLIF(s.matches_played, 0), 1) AS points_per_match,
      ROUND(CAST(s.kills AS REAL) / NULLIF(s.matches_played, 0), 1) AS kills_per_match,
      ROUND(CAST(s.aces  AS REAL) / NULLIF(s.matches_played, 0), 1) AS aces_per_match,
      ROUND(CAST(s.blocks AS REAL) / NULLIF(s.matches_played, 0), 1) AS blocks_per_match,
      ROUND(CAST(s.digs  AS REAL) / NULLIF(s.matches_played, 0), 1) AS digs_per_match
    FROM players p
    JOIN player_stats s ON s.player_id = p.id AND s.season = ?
    JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    JOIN teams t ON t.id = tp.team_id
    WHERE p.registration_status = 'approved'
    ${teamFilter}
    ORDER BY s.points DESC
  `).all(...params);

  // Also compute team win percentage from standings
  let standingsSql = `
    SELECT t.id AS team_id, t.name AS team_name,
           st.wins, st.losses, st.played,
           ROUND(CAST(st.wins AS REAL) / NULLIF(st.played, 0) * 100, 1) AS win_pct
    FROM standings st
    JOIN teams t ON t.id = st.team_id
    WHERE st.season = ?
  `;
  const standingsParams = [season];
  if (req.user.role === 'coach') {
    standingsSql += ' AND t.coach_id = ?';
    standingsParams.push(req.user.id);
  } else if (req.user.role === 'assistant_coach') {
    standingsSql += ' AND t.assistant_coach_id = ?';
    standingsParams.push(req.user.id);
  }

  const standings = db.prepare(standingsSql).all(...standingsParams);

  res.json({ players: rows, standings });
});

// ─── GET /api/players/:id ─────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const player = db.prepare(`
    SELECT p.*,
           t.name AS team_name, t.id AS team_id
    FROM players p
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    LEFT JOIN teams t          ON t.id = tp.team_id
    WHERE p.id = ?
  `).get(Number(req.params.id));

  if (!player) return res.status(404).json({ error: 'Player not found' });
  res.json(player);
});

// ─── PUT /api/players/:id ─────────────────────────────────────────────────────
router.put('/:id', authenticate, [
  body('name').optional().trim().notEmpty(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().trim(),
  body('date_of_birth').optional().isISO8601(),
  body('position').optional().isIn([
    'setter', 'libero', 'outside_hitter', 'opposite',
    'middle_blocker', 'defensive_specialist',
  ]),
  body('jersey_number').optional().isInt({ min: 0, max: 99 }),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT * FROM players WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: 'Player not found' });

  const isAdminOrCoach = ['admin', 'coach'].includes(req.user.role);
  const isSelf = existing.user_id === req.user.id;

  if (!isAdminOrCoach && !isSelf) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Players may only update their own bio fields; admin/coach can update all fields
  const allowedFields = isAdminOrCoach
    ? ['name', 'email', 'phone', 'date_of_birth', 'position', 'jersey_number', 'notes', 'season']
    : ['phone', 'date_of_birth', 'position', 'jersey_number'];

  const updates = {};
  allowedFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const setClauses = Object.keys(updates).map(f => `${f} = ?`).join(', ');
  db.prepare(`UPDATE players SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(updates), id);

  res.json(db.prepare(`SELECT * FROM players WHERE id = ?`).get(id));
});

// ─── PATCH /api/players/:id/status ───────────────────────────────────────────
router.patch('/:id/status', authenticate, requireRole('admin'), [
  body('status').isIn(['pending','approved','rejected','waitlisted']),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const id = Number(req.params.id);
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  db.prepare(
    `UPDATE players SET registration_status = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(req.body.status, id);

  // Notify linked user if exists
  if (player.user_id) {
    const statusLabels = {
      approved:   'Your registration has been approved! Welcome to the club.',
      rejected:   'Unfortunately your registration was not accepted this season.',
      waitlisted: 'You have been placed on the waitlist. We will contact you soon.',
    };
    const msg = statusLabels[req.body.status];
    if (msg) pushNotification(req.app.get('io'), player.user_id, 'registration_status',
      'Registration Update', msg);
  }

  res.json(db.prepare(`SELECT * FROM players WHERE id = ?`).get(id));
});

// ─── DELETE /api/players/:id ──────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin'), (req, res) => {
  const id = Number(req.params.id);
  const player = db.prepare(`SELECT id FROM players WHERE id = ?`).get(id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  db.prepare(`DELETE FROM players WHERE id = ?`).run(id);
  res.json({ message: 'Player deleted' });
});

// ─── PUT /api/players/:id/stats ───────────────────────────────────────────────
// Upsert season stats for a player. Coach/admin only.
router.put('/:id/stats', authenticate, requireRole('admin', 'coach'), [
  body('season').optional().trim(),
  body('matches_played').optional().isInt({ min: 0 }),
  body('sets_played').optional().isInt({ min: 0 }),
  body('points').optional().isInt({ min: 0 }),
  body('kills').optional().isInt({ min: 0 }),
  body('aces').optional().isInt({ min: 0 }),
  body('blocks').optional().isInt({ min: 0 }),
  body('digs').optional().isInt({ min: 0 }),
  body('errors').optional().isInt({ min: 0 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const playerId = Number(req.params.id);
  const player = db.prepare(`SELECT id FROM players WHERE id = ?`).get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const season = req.body.season || '2024-2025';
  const fields = ['matches_played', 'sets_played', 'points', 'kills', 'aces', 'blocks', 'digs', 'errors'];

  const existing = db.prepare(
    `SELECT * FROM player_stats WHERE player_id = ? AND season = ?`
  ).get(playerId, season);

  if (existing) {
    const updates = {};
    fields.forEach(f => { if (req.body[f] !== undefined) updates[f] = Number(req.body[f]); });
    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(f => `${f} = ?`).join(', ');
      db.prepare(`UPDATE player_stats SET ${setClauses} WHERE player_id = ? AND season = ?`)
        .run(...Object.values(updates), playerId, season);
    }
  } else {
    const vals = {};
    fields.forEach(f => { vals[f] = req.body[f] !== undefined ? Number(req.body[f]) : 0; });
    db.prepare(`
      INSERT INTO player_stats (player_id, season, matches_played, sets_played, points, kills, aces, blocks, digs, errors)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(playerId, season, vals.matches_played, vals.sets_played, vals.points,
           vals.kills, vals.aces, vals.blocks, vals.digs, vals.errors);
  }

  const updated = db.prepare(
    `SELECT * FROM player_stats WHERE player_id = ? AND season = ?`
  ).get(playerId, season);
  res.json(updated);
});

module.exports = router;
