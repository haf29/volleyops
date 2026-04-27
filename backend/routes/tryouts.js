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

function playerForUser(userId) {
  return db.prepare(`SELECT id, registration_status FROM players WHERE user_id = ?`).get(userId);
}

function pushNotification(io, userId, type, title, body_) {
  if (!io || !userId) return;
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`)
      .run(userId, type, title, body_);
    io.to(`user:${userId}`).emit('notification', { type, title, body: body_ });
  } catch {}
}

// Helper: team IDs accessible to this user
function accessibleTeamIds(user) {
  if (user.role === 'admin') return db.prepare(`SELECT id FROM teams`).all().map(r => r.id);
  if (user.role === 'player') {
    const player = playerForUser(user.id);
    if (!player) return [];
    return db.prepare(`
      SELECT team_id FROM team_players
      WHERE player_id = ? AND is_active = 1
    `).all(player.id).map(r => r.team_id);
  }
  return db.prepare(`SELECT id FROM teams WHERE coach_id = ? OR assistant_coach_id = ?`)
    .all(user.id, user.id).map(r => r.id);
}

// ─── GET /api/tryouts ─────────────────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin', 'coach', 'assistant_coach', 'player'), (req, res) => {
  const { season, team_id } = req.query;
  const teamIds = accessibleTeamIds(req.user);
  const currentPlayer = req.user.role === 'player' ? playerForUser(req.user.id) : null;

  if (req.user.role === 'player' && !currentPlayer) {
    return res.json({ tryouts: [] });
  }

  let sql = `
    SELECT t.*, tm.name AS team_name,
           u.name AS created_by_name,
           (SELECT COUNT(*) FROM tryout_attendees ta WHERE ta.tryout_id = t.id) AS total_registered,
           (SELECT COUNT(*) FROM tryout_attendees ta WHERE ta.tryout_id = t.id AND ta.status = 'present') AS total_present,
           ${currentPlayer ? `(SELECT ta.status FROM tryout_attendees ta WHERE ta.tryout_id = t.id AND ta.player_id = ?)` : `NULL`} AS current_user_status
    FROM tryouts t
    LEFT JOIN teams tm ON tm.id = t.team_id
    LEFT JOIN users u  ON u.id  = t.created_by
    WHERE 1=1
  `;
  const params = currentPlayer ? [currentPlayer.id] : [];

  if (req.user.role === 'player') {
    if (teamIds.length) {
      sql += ` AND (t.team_id IS NULL OR t.team_id IN (${teamIds.map(() => '?').join(',')}) OR EXISTS (
        SELECT 1 FROM tryout_attendees ta WHERE ta.tryout_id = t.id AND ta.player_id = ?
      ))`;
      params.push(...teamIds, currentPlayer.id);
    } else {
      sql += ` AND (t.team_id IS NULL OR EXISTS (
        SELECT 1 FROM tryout_attendees ta WHERE ta.tryout_id = t.id AND ta.player_id = ?
      ))`;
      params.push(currentPlayer.id);
    }
    sql += ` AND (t.is_open = 1 OR EXISTS (
      SELECT 1 FROM tryout_attendees ta WHERE ta.tryout_id = t.id AND ta.player_id = ?
    ))`;
    params.push(currentPlayer.id);
  } else if (req.user.role !== 'admin') {
    if (!teamIds.length) return res.json({ tryouts: [] });
    sql += ` AND (t.team_id IN (${teamIds.map(() => '?').join(',')}) OR t.team_id IS NULL)`;
    params.push(...teamIds);
  }
  if (season)  { sql += ` AND t.season = ?`;  params.push(season); }
  if (team_id) { sql += ` AND t.team_id = ?`; params.push(Number(team_id)); }

  sql += ` ORDER BY t.date DESC`;
  const tryouts = db.prepare(sql).all(...params);
  res.json({ tryouts });
});

// ─── POST /api/tryouts ────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin', 'coach'), [
  body('name').trim().notEmpty(),
  body('date').notEmpty(),
  body('team_id').optional({ nullable: true }).isInt(),
  body('location').optional().trim(),
  body('season').optional().trim(),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;
  const { name, date, team_id = null, location, season, notes } = req.body;

  if (team_id && req.user.role !== 'admin') {
    const allowed = accessibleTeamIds(req.user);
    if (!allowed.includes(Number(team_id))) {
      return res.status(403).json({ error: 'Not authorised for this team' });
    }
  }

  const result = db.prepare(`
    INSERT INTO tryouts (name, date, team_id, location, season, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, date, team_id ? Number(team_id) : null,
         location ?? null, season ?? null, notes ?? null, req.user.id);

  const tryout = db.prepare(`SELECT * FROM tryouts WHERE id = ?`).get(result.lastInsertRowid);
  const notifyRows = team_id
    ? db.prepare(`
        SELECT p.user_id FROM team_players tp
        JOIN players p ON p.id = tp.player_id
        WHERE tp.team_id = ? AND tp.is_active = 1 AND p.user_id IS NOT NULL
      `).all(Number(team_id))
    : db.prepare(`
        SELECT user_id FROM players
        WHERE user_id IS NOT NULL AND registration_status = 'approved'
      `).all();
  const io = req.app.get('io');
  notifyRows.forEach(r => pushNotification(
    io,
    r.user_id,
    'tryout_open',
    'New Tryout Open',
    `${name} is open for registration${location ? ` at ${location}` : ''}.`,
  ));

  res.status(201).json({ tryout });
});

// ─── GET /api/tryouts/:id ─────────────────────────────────────────────────────
router.get('/:id', authenticate, requireRole('admin', 'coach', 'assistant_coach', 'player'), (req, res) => {
  const tryout = db.prepare(`
    SELECT t.*, tm.name AS team_name, u.name AS created_by_name
    FROM tryouts t
    LEFT JOIN teams tm ON tm.id = t.team_id
    LEFT JOIN users u  ON u.id  = t.created_by
    WHERE t.id = ?
  `).get(Number(req.params.id));

  if (!tryout) return res.status(404).json({ error: 'Tryout not found' });

  if (req.user.role === 'player') {
    const currentPlayer = playerForUser(req.user.id);
    if (!currentPlayer) return res.status(403).json({ error: 'No player profile linked to this account' });
    const teamIds = accessibleTeamIds(req.user);
    const currentAttendee = db.prepare(`
      SELECT id FROM tryout_attendees WHERE tryout_id = ? AND player_id = ?
    `).get(tryout.id, currentPlayer.id);
    const teamAllowed = !tryout.team_id || teamIds.includes(tryout.team_id);
    if ((!teamAllowed && !currentAttendee) || (!tryout.is_open && !currentAttendee)) {
      return res.status(403).json({ error: 'Not authorised for this tryout' });
    }
  } else if (req.user.role !== 'admin' && tryout.team_id) {
    const teamIds = accessibleTeamIds(req.user);
    if (!teamIds.includes(tryout.team_id)) {
      return res.status(403).json({ error: 'Not authorised for this tryout' });
    }
  }

  const attendeeSql = `
    SELECT ta.*, p.name AS player_name, p.email AS player_email,
           p.position, p.jersey_number
    FROM tryout_attendees ta
    JOIN players p ON p.id = ta.player_id
    WHERE ta.tryout_id = ?
    ${req.user.role === 'player' ? 'AND p.user_id = ?' : ''}
    ORDER BY p.name ASC
  `;
  const attendees = req.user.role === 'player'
    ? db.prepare(attendeeSql).all(Number(req.params.id), req.user.id)
    : db.prepare(attendeeSql).all(Number(req.params.id));

  res.json({ tryout, attendees });
});

// ─── PATCH /api/tryouts/:id ───────────────────────────────────────────────────
router.patch('/:id', authenticate, requireRole('admin', 'coach'), [
  body('name').optional().trim().notEmpty(),
  body('date').optional().notEmpty(),
  body('is_open').optional().isInt({ min: 0, max: 1 }),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;
  const tryout = db.prepare(`SELECT * FROM tryouts WHERE id = ?`).get(Number(req.params.id));
  if (!tryout) return res.status(404).json({ error: 'Tryout not found' });

  if (req.user.role !== 'admin' && tryout.team_id) {
    const teamIds = accessibleTeamIds(req.user);
    if (!teamIds.includes(tryout.team_id)) {
      return res.status(403).json({ error: 'Not authorised for this tryout' });
    }
  }

  const fields = ['name','date','location','season','notes','is_open'];
  const updates = [];
  const params  = [];
  fields.forEach(f => {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  });
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  updates.push(`updated_at = datetime('now')`);
  params.push(tryout.id);

  db.prepare(`UPDATE tryouts SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ tryout: db.prepare(`SELECT * FROM tryouts WHERE id = ?`).get(tryout.id) });
});

// ─── POST /api/tryouts/:id/checkin ────────────────────────────────────────────
// Upsert a player's check-in status for this tryout.
// Body: { player_id, status }
router.post('/:id/checkin', authenticate, requireRole('admin', 'coach', 'assistant_coach'), [
  body('player_id').isInt({ min: 1 }),
  body('status').isIn(['registered', 'present', 'absent', 'excused']),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;
  const tryoutId = Number(req.params.id);
  const { player_id, status, notes } = req.body;

  const tryout = db.prepare(`SELECT id, team_id FROM tryouts WHERE id = ?`).get(tryoutId);
  if (!tryout) return res.status(404).json({ error: 'Tryout not found' });
  if (req.user.role !== 'admin' && tryout.team_id) {
    const teamIds = accessibleTeamIds(req.user);
    if (!teamIds.includes(tryout.team_id)) {
      return res.status(403).json({ error: 'Not authorised for this tryout' });
    }
  }

  const checkedInAt = status === 'present' ? "datetime('now')" : null;

  db.prepare(`
    INSERT INTO tryout_attendees (tryout_id, player_id, status, checked_in_at, notes)
    VALUES (?, ?, ?, ${checkedInAt ? "datetime('now')" : 'NULL'}, ?)
    ON CONFLICT(tryout_id, player_id) DO UPDATE SET
      status = excluded.status,
      checked_in_at = CASE WHEN excluded.status = 'present' THEN datetime('now') ELSE checked_in_at END,
      notes = excluded.notes
  `).run(tryoutId, Number(player_id), status, notes ?? null);

  const attendee = db.prepare(`
    SELECT ta.*, p.name AS player_name
    FROM tryout_attendees ta JOIN players p ON p.id = ta.player_id
    WHERE ta.tryout_id = ? AND ta.player_id = ?
  `).get(tryoutId, Number(player_id));

  res.json({ attendee });
});

// â”€â”€â”€ POST /api/tryouts/:id/register â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Player self-registration for open tryouts.
router.post('/:id/register', authenticate, requireRole('player'), (req, res) => {
  const tryoutId = Number(req.params.id);
  const player = playerForUser(req.user.id);
  if (!player) return res.status(403).json({ error: 'No player profile linked to this account' });

  const tryout = db.prepare(`SELECT * FROM tryouts WHERE id = ?`).get(tryoutId);
  if (!tryout) return res.status(404).json({ error: 'Tryout not found' });
  if (!tryout.is_open) return res.status(400).json({ error: 'This tryout is closed' });

  const teamIds = accessibleTeamIds(req.user);
  if (tryout.team_id && !teamIds.includes(tryout.team_id)) {
    return res.status(403).json({ error: 'This tryout is not available for your team' });
  }

  db.prepare(`
    INSERT INTO tryout_attendees (tryout_id, player_id, status)
    VALUES (?, ?, 'registered')
    ON CONFLICT(tryout_id, player_id) DO UPDATE SET
      status = CASE
        WHEN tryout_attendees.status = 'present' THEN tryout_attendees.status
        ELSE 'registered'
      END
  `).run(tryoutId, player.id);

  const attendee = db.prepare(`
    SELECT ta.*, p.name AS player_name
    FROM tryout_attendees ta
    JOIN players p ON p.id = ta.player_id
    WHERE ta.tryout_id = ? AND ta.player_id = ?
  `).get(tryoutId, player.id);

  res.status(201).json({ attendee });
});

// ─── POST /api/tryouts/:id/bulk-checkin ──────────────────────────────────────
// Register all approved players (or by team_id) into this tryout at once.
router.post('/:id/bulk-register', authenticate, requireRole('admin', 'coach'), (req, res) => {
  const tryoutId = Number(req.params.id);
  const { team_id } = req.body;

  const tryout = db.prepare(`SELECT * FROM tryouts WHERE id = ?`).get(tryoutId);
  if (!tryout) return res.status(404).json({ error: 'Tryout not found' });
  if (req.user.role !== 'admin' && tryout.team_id) {
    const teamIds = accessibleTeamIds(req.user);
    if (!teamIds.includes(tryout.team_id)) {
      return res.status(403).json({ error: 'Not authorised for this tryout' });
    }
  }
  if (req.user.role !== 'admin' && team_id) {
    const teamIds = accessibleTeamIds(req.user);
    if (!teamIds.includes(Number(team_id))) {
      return res.status(403).json({ error: 'Not authorised for this team' });
    }
  }

  let players;
  if (team_id) {
    players = db.prepare(`
      SELECT p.id FROM players p
      JOIN team_players tp ON tp.player_id = p.id
      WHERE tp.team_id = ? AND tp.is_active = 1 AND p.registration_status = 'approved'
    `).all(Number(team_id));
  } else {
    players = db.prepare(`
      SELECT id FROM players WHERE registration_status = 'approved'
    `).all();
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO tryout_attendees (tryout_id, player_id, status)
    VALUES (?, ?, 'registered')
  `);
  const insertMany = db.transaction(ps => ps.forEach(p => insert.run(tryoutId, p.id)));
  insertMany(players);

  res.json({ registered: players.length });
});

module.exports = router;
