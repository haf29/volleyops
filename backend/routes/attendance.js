const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(422).json({ errors: errors.array() }); return true; }
  return false;
}

function accessibleTeamIds(user) {
  if (user.role === 'admin') return db.prepare(`SELECT id FROM teams`).all().map(r => r.id);
  if (user.role === 'player') {
    const player = db.prepare(`SELECT id FROM players WHERE user_id = ?`).get(user.id);
    if (!player) return [];
    return db.prepare(`
      SELECT team_id FROM team_players
      WHERE player_id = ? AND is_active = 1
    `).all(player.id).map(r => r.team_id);
  }
  return db.prepare(`SELECT id FROM teams WHERE coach_id = ? OR assistant_coach_id = ?`)
    .all(user.id, user.id).map(r => r.id);
}

function pushNotification(io, userId, type, title, body_) {
  if (!io || !userId) return;
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`)
      .run(userId, type, title, body_);
    io.to(`user:${userId}`).emit('notification', { type, title, body: body_ });
  } catch {}
}

// ─── GET /api/attendance/sessions ─────────────────────────────────────────────
router.get('/sessions', authenticate, requireRole('admin', 'coach', 'assistant_coach', 'player'), (req, res) => {
  const { team_id, type } = req.query;
  const teamIds = accessibleTeamIds(req.user);
  if (!teamIds.length) return res.json({ sessions: [] });

  let sql = `
    SELECT ts.*,
           t.name AS team_name,
           u.name AS created_by_name,
           (SELECT COUNT(*) FROM attendance a WHERE a.session_id = ts.id) AS marked_count,
           (SELECT COUNT(*) FROM attendance a WHERE a.session_id = ts.id AND a.status = 'present') AS present_count,
           (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = ts.team_id AND tp.is_active = 1) AS roster_size
    FROM training_sessions ts
    JOIN teams t ON t.id = ts.team_id
    LEFT JOIN users u ON u.id = ts.created_by
    WHERE ts.team_id IN (${teamIds.map(() => '?').join(',')})
  `;
  const params = [...teamIds];

  if (team_id) { sql += ` AND ts.team_id = ?`; params.push(Number(team_id)); }
  if (type)    { sql += ` AND ts.type = ?`;     params.push(type); }

  sql += ` ORDER BY ts.date DESC LIMIT 100`;
  res.json({ sessions: db.prepare(sql).all(...params) });
});

// ─── POST /api/attendance/sessions ────────────────────────────────────────────
router.post('/sessions', authenticate, requireRole('admin', 'coach'), [
  body('team_id').isInt({ min: 1 }),
  body('date').notEmpty(),
  body('type').optional().isIn(['training','match','tournament','other']),
  body('title').optional().trim(),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;
  const { team_id, date, type = 'training', title, notes } = req.body;

  const teamIds = accessibleTeamIds(req.user);
  if (!teamIds.includes(Number(team_id))) {
    return res.status(403).json({ error: 'Not authorised for this team' });
  }

  const result = db.prepare(`
    INSERT INTO training_sessions (team_id, date, type, title, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(Number(team_id), date, type, title ?? null, notes ?? null, req.user.id);

  const session = db.prepare(`SELECT * FROM training_sessions WHERE id = ?`).get(result.lastInsertRowid);
  const team = db.prepare(`SELECT name FROM teams WHERE id = ?`).get(Number(team_id));
  const roster = db.prepare(`
    SELECT p.user_id FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1 AND p.user_id IS NOT NULL
  `).all(Number(team_id));
  const io = req.app.get('io');
  roster.forEach(r => pushNotification(
    io,
    r.user_id,
    'practice_scheduled',
    'New Practice Scheduled',
    `${team?.name || 'Your team'} has practice on ${new Date(date).toLocaleString()}`,
  ));

  res.status(201).json({ session });
});

// ─── GET /api/attendance/sessions/:id ─────────────────────────────────────────
router.get('/sessions/:id', authenticate, requireRole('admin', 'coach', 'assistant_coach', 'player'), (req, res) => {
  const session = db.prepare(`
    SELECT ts.*, t.name AS team_name
    FROM training_sessions ts
    JOIN teams t ON t.id = ts.team_id
    WHERE ts.id = ?
  `).get(Number(req.params.id));

  if (!session) return res.status(404).json({ error: 'Session not found' });

  const teamIds = accessibleTeamIds(req.user);
  if (req.user.role !== 'admin' && !teamIds.includes(session.team_id)) {
    return res.status(403).json({ error: 'Not authorised for this session' });
  }

  // All players on the team with their attendance status for this session
  const roster = db.prepare(`
    SELECT p.id AS player_id, p.name AS player_name, p.position, p.jersey_number,
           a.status, a.notes AS attendance_notes
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    LEFT JOIN attendance a ON a.session_id = ? AND a.player_id = p.id
    WHERE tp.team_id = ? AND tp.is_active = 1
    ORDER BY p.name ASC
  `).all(session.id, session.team_id);

  res.json({ session, roster });
});

// ─── POST /api/attendance/sessions/:id/mark ───────────────────────────────────
// Bulk upsert attendance for a session.
// Body: { records: [{ player_id, status, notes? }] }
router.post('/sessions/:id/mark', authenticate, requireRole('admin', 'coach', 'assistant_coach'), [
  body('records').isArray({ min: 1 }),
  body('records.*.player_id').isInt({ min: 1 }),
  body('records.*.status').isIn(['present','absent','late','excused']),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const sessionId = Number(req.params.id);
  const session = db.prepare(`SELECT id, team_id FROM training_sessions WHERE id = ?`).get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const teamIds = accessibleTeamIds(req.user);
  if (req.user.role !== 'admin' && !teamIds.includes(session.team_id)) {
    return res.status(403).json({ error: 'Not authorised for this session' });
  }

  const { records } = req.body;
  const upsert = db.prepare(`
    INSERT INTO attendance (session_id, player_id, status, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id, player_id) DO UPDATE SET
      status = excluded.status,
      notes  = excluded.notes
  `);
  const markAll = db.transaction(recs => {
    recs.forEach(r => upsert.run(sessionId, Number(r.player_id), r.status, r.notes ?? null));
  });
  markAll(records);

  const roster = db.prepare(`
    SELECT DISTINCT p.user_id FROM attendance a
    JOIN players p ON p.id = a.player_id
    WHERE a.session_id = ? AND p.user_id IS NOT NULL
  `).all(sessionId);
  const io = req.app.get('io');
  roster.forEach(r => pushNotification(
    io,
    r.user_id,
    'attendance_marked',
    'Attendance Updated',
    'Your coach updated attendance for a practice session.',
  ));

  res.json({ marked: records.length });
});

// ─── GET /api/attendance/summary ──────────────────────────────────────────────
// Per-player attendance rates for a team.
// Query: team_id (required), from_date?, to_date?
router.get('/summary', authenticate, requireRole('admin', 'coach', 'assistant_coach', 'player'), (req, res) => {
  const { team_id, from_date, to_date } = req.query;
  if (!team_id) return res.status(400).json({ error: 'team_id required' });

  const teamIds = accessibleTeamIds(req.user);
  if (!teamIds.includes(Number(team_id))) {
    return res.status(403).json({ error: 'Not authorised for this team' });
  }

  let dateFilter = '';
  const params = [];
  if (from_date) { dateFilter += ` AND ts.date >= ?`; params.push(from_date); }
  if (to_date)   { dateFilter += ` AND ts.date <= ?`; params.push(to_date); }
  params.push(Number(team_id));

  const rows = db.prepare(`
    SELECT p.id AS player_id, p.name AS player_name, p.position, p.jersey_number,
           COUNT(ts.id)                                                 AS total_sessions,
           SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END)       AS present,
           SUM(CASE WHEN a.status = 'absent'  THEN 1 ELSE 0 END)       AS absent,
           SUM(CASE WHEN a.status = 'late'    THEN 1 ELSE 0 END)       AS late,
           SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END)       AS excused
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    LEFT JOIN training_sessions ts ON ts.team_id = tp.team_id ${dateFilter}
    LEFT JOIN attendance a ON a.session_id = ts.id AND a.player_id = p.id
    WHERE tp.team_id = ? AND tp.is_active = 1
    GROUP BY p.id
    ORDER BY p.name ASC
  `).all(...params);

  const summary = rows.map(r => ({
    ...r,
    rate: r.total_sessions > 0
      ? Math.round(((r.present + r.late) / r.total_sessions) * 100)
      : null,
  }));

  res.json({ summary });
});

module.exports = router;
