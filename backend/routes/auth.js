const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function makeRefreshToken(userId) {
  const token     = uuidv4();
  const expiresAt = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000   // 7 days
  ).toISOString();

  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(userId, token, expiresAt);

  return { token, expiresAt };
}

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// ─── Notification helper ──────────────────────────────────────────────────────
function pushNotification(io, userId, type, title, body_) {
  if (!io || !userId) return;
  try {
    db.prepare(
      `INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`
    ).run(userId, type, title, body_);
    io.to(`user:${userId}`).emit('notification', { type, title, body: body_ });
  } catch {}
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
// Public: creates a player, coach, or assistant_coach account.
router.post('/register', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').isIn(['player', 'coach', 'assistant_coach']).withMessage('Role must be player, coach, or assistant_coach'),
  body('team_id').optional().isInt({ min: 1 }),
  body('new_team_name').optional().trim(),
  body('phone').optional().trim(),
  body('date_of_birth').optional().isISO8601(),
  body('position').optional().isIn(['setter','libero','outside_hitter','opposite','middle_blocker','defensive_specialist']),
  body('jersey_number').optional().isInt({ min: 0, max: 99 }),
  body('season').optional().trim(),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { name, email, password, role, team_id, phone, date_of_birth, position, jersey_number, season, notes } = req.body;
  const io = req.app.get('io');

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const passwordHash = bcrypt.hashSync(password, 12);
  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin'`).all();

  // ── Player ─────────────────────────────────────────────────────────────────
  if (role === 'player') {
    const existingPlayer = db.prepare(`SELECT id FROM players WHERE email = ?`).get(email);
    if (existingPlayer) return res.status(409).json({ error: 'A registration with this email already exists' });

    const team = db.prepare(`SELECT id, name FROM teams WHERE id = ?`).get(Number(team_id));
    if (!team) return res.status(404).json({ error: 'Selected team not found' });

    const userResult = db.prepare(
      `INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'player')`
    ).run(name, email, passwordHash);
    const userId = userResult.lastInsertRowid;

    const playerResult = db.prepare(`
      INSERT INTO players (user_id, name, email, phone, date_of_birth, position, jersey_number, team_id, season, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, name, email, phone ?? null, date_of_birth ?? null, position ?? null,
           jersey_number ?? null, Number(team_id), season ?? null, notes ?? null);
    const playerId = playerResult.lastInsertRowid;

    db.prepare(`INSERT OR IGNORE INTO team_players (team_id, player_id, is_active) VALUES (?, ?, 1)`)
      .run(Number(team_id), playerId);

    admins.forEach(a => pushNotification(io, a.id, 'new_registration', 'New Player Registration',
      `${name} applied to join ${team.name} and is awaiting approval.`));

    const user = db.prepare(`SELECT id, name, email, role, is_active FROM users WHERE id = ?`).get(userId);
    return res.status(201).json({ user, accessToken: makeAccessToken(user), refreshToken: makeRefreshToken(userId).token });
  }

  // ── Coach / Assistant Coach — pending until admin activates ────────────────
  const { team_id: staffTeamId, new_team_name } = req.body;

  if (!staffTeamId && !new_team_name) {
    return res.status(400).json({ error: 'Please select a team or enter your team name.' });
  }

  // Determine the field to check based on role
  const coachField = role === 'coach' ? 'coach_id' : 'assistant_coach_id';
  const roleLabel  = role === 'coach' ? 'Head Coach' : 'Assistant Coach';

  let teamId;

  if (staffTeamId) {
    // Existing team — validate role slot is open
    const team = db.prepare(`SELECT id, name, coach_id, assistant_coach_id FROM teams WHERE id = ? AND (status = 'active' OR status IS NULL)`).get(Number(staffTeamId));
    if (!team) return res.status(404).json({ error: 'Team not found.' });
    if (team[coachField]) {
      return res.status(409).json({ error: `${team.name} already has a ${roleLabel}. Choose a different team or register a new one.` });
    }
    teamId = team.id;
  } else {
    // New team — create it with status='pending'
    const trimmedName = new_team_name.trim();
    if (!trimmedName) return res.status(400).json({ error: 'Team name cannot be empty.' });
    const teamResult = db.prepare(
      `INSERT INTO teams (name, status) VALUES (?, 'pending')`
    ).run(trimmedName);
    teamId = teamResult.lastInsertRowid;
  }

  const userResult = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 0)`
  ).run(name, email, passwordHash, role);
  const userId = userResult.lastInsertRowid;

  // Store the team request so admin can approve and assign in one step
  db.prepare(`INSERT INTO team_requests (user_id, team_id) VALUES (?, ?)`).run(userId, teamId);

  const teamName = staffTeamId
    ? db.prepare(`SELECT name FROM teams WHERE id = ?`).get(teamId).name
    : new_team_name.trim();

  admins.forEach(a => pushNotification(io, a.id, 'new_registration', `New ${roleLabel} Registration`,
    `${name} registered as ${roleLabel} for "${teamName}" and is awaiting approval.`));

  const user = db.prepare(`SELECT id, name, email, role, is_active FROM users WHERE id = ?`).get(userId);
  res.status(201).json({ user, accessToken: makeAccessToken(user), refreshToken: makeRefreshToken(userId).token });
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { email, password } = req.body;

  const user = db.prepare(
    `SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = ?`
  ).get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Coaches/assistant_coaches with is_active=0 are pending approval — let them
  // log in so the frontend can show the pending screen instead of a hard block.
  if (!user.is_active && user.role !== 'coach' && user.role !== 'assistant_coach') {
    return res.status(403).json({ error: 'Account deactivated' });
  }

  const { password_hash: _, ...safeUser } = user;
  const accessToken  = makeAccessToken(user);
  const refreshToken = makeRefreshToken(user.id);

  res.json({ user: safeUser, accessToken, refreshToken: refreshToken.token });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  const stored = db.prepare(
    `SELECT * FROM refresh_tokens WHERE token = ?`
  ).get(refreshToken);

  if (!stored || new Date(stored.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }

  const user = db.prepare(
    `SELECT id, name, email, role, is_active FROM users WHERE id = ?`
  ).get(stored.user_id);

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'User not found or deactivated' });
  }

  // Rotate refresh token
  db.prepare(`DELETE FROM refresh_tokens WHERE token = ?`).run(refreshToken);
  const newRefresh = makeRefreshToken(user.id);
  const accessToken = makeAccessToken(user);

  res.json({ accessToken, refreshToken: newRefresh.token });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    db.prepare(`DELETE FROM refresh_tokens WHERE token = ?`).run(refreshToken);
  }
  res.json({ message: 'Logged out' });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  const user = db.prepare(
    `SELECT id, name, email, role, is_active, created_at, updated_at FROM users WHERE id = ?`
  ).get(req.user.id);

  // For players, attach their registration_status so the frontend can gate access
  if (user.role === 'player') {
    const player = db.prepare(
      `SELECT id, registration_status FROM players WHERE user_id = ?`
    ).get(user.id);
    user.player_id     = player?.id     ?? null;
    user.player_status = player?.registration_status ?? 'pending';
  }

  res.json(user);
});

// ─── POST /api/auth/change-password ──────────────────────────────────────────
router.post('/change-password', authenticate, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { currentPassword, newPassword } = req.body;
  const user = db.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user.id);

  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare(
    `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(newHash, req.user.id);

  // Invalidate all refresh tokens
  db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(req.user.id);

  res.json({ message: 'Password changed. Please log in again.' });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Generates a single-use reset token. If SMTP is configured, emails it.
// In non-production mode also returns the token directly for dev convenience.
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { email } = req.body;
  const user = db.prepare(`SELECT id, name FROM users WHERE email = ?`).get(email);

  // Always respond the same way to prevent user enumeration
  const safeResponse = { message: 'If an account with that email exists, a reset link has been sent.' };

  if (!user) return res.json(safeResponse);

  // Invalidate any previous unused tokens for this user
  db.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ? AND used = 0`).run(user.id);

  const token     = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(user.id, token, expiresAt);

  // Attempt to send email if SMTP is configured
  const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  if (smtpConfigured) {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const appUrl = (process.env.APP_URL || req.get('origin') || 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${appUrl}/reset-password?token=${token}`;
    transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'VolleyOps — Password Reset',
      text: `Hello ${user.name},\n\nClick the link below to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, please ignore this email.`,
      html: `<p>Hello ${user.name},</p><p>Click <a href="${resetUrl}">here</a> to reset your password (valid 1 hour).</p>`,
    }).catch(err => console.error('Password reset email failed:', err));
  }

  // In non-production, also return the token so devs can test without SMTP
  if (process.env.NODE_ENV !== 'production') {
    return res.json({ ...safeResponse, dev_token: token });
  }

  res.json(safeResponse);
});

// ─── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', [
  body('token').notEmpty(),
  body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { token, newPassword } = req.body;

  const record = db.prepare(
    `SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0`
  ).get(token);

  if (!record) return res.status(400).json({ error: 'Invalid or expired reset token.' });
  if (new Date(record.expires_at) < new Date()) {
    db.prepare(`DELETE FROM password_reset_tokens WHERE id = ?`).run(record.id);
    return res.status(400).json({ error: 'Reset token has expired. Please request a new one.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(newHash, record.user_id);

  // Mark token used and invalidate all refresh tokens for security
  db.prepare(`UPDATE password_reset_tokens SET used = 1 WHERE id = ?`).run(record.id);
  db.prepare(`DELETE FROM refresh_tokens WHERE user_id = ?`).run(record.user_id);

  res.json({ message: 'Password reset successfully. You can now log in.' });
});

// ─── GET /api/auth/smtp-status ────────────────────────────────────────────────
// Admin-only: tells the frontend whether SMTP is configured.
router.get('/smtp-status', authenticate, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  res.json({
    configured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  });
});

module.exports = router;
