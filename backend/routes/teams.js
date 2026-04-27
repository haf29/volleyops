const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/teams/public ────────────────────────────────────────────────────
// No auth — used by the player registration form to populate the team dropdown.
router.get('/public', (_req, res) => {
  const teams = db.prepare(`
    SELECT t.id, t.name, t.division, t.season,
           t.max_players,
           COUNT(CASE WHEN tp.is_active = 1 THEN 1 END) AS player_count
    FROM teams t
    LEFT JOIN team_players tp ON tp.team_id = t.id
    WHERE t.status = 'active' OR t.status IS NULL
    GROUP BY t.id
    ORDER BY t.season DESC, t.division ASC, t.name ASC
  `).all();
  res.json({ teams });
});

router.use(authenticate);

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function canViewTeam(user, team) {
  if (user.role === 'admin') return true;
  return team.coach_id === user.id || team.assistant_coach_id === user.id;
}

function canManageTeam(user, team) {
  if (user.role === 'admin') return true;
  return user.role === 'coach' && team.coach_id === user.id;
}

function notifyUser(io, userId, title, body, relatedType, relatedId) {
  if (!io || !userId) return;
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
    VALUES (?, 'team_update', ?, ?, ?, ?)
  `).run(userId, title, body, relatedType ?? null, relatedId ?? null);

  io.to(`user:${userId}`).emit('notification', {
    type: 'team_update',
    title,
    body,
    relatedType,
    relatedId,
  });
}

function getTeamRoster(teamId) {
  return db.prepare(`
    SELECT
      p.id,
      p.user_id,
      p.name,
      p.email,
      p.phone,
      p.position,
      p.jersey_number,
      p.registration_status,
      tp.assigned_at
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1
    ORDER BY
      CASE WHEN p.jersey_number IS NULL THEN 1 ELSE 0 END,
      p.jersey_number ASC,
      p.name ASC
  `).all(teamId);
}

router.get('/', (req, res) => {
  const { season, division, finalized, published, search } = req.query;
  let sql = `
    SELECT
      t.*,
      coach.name AS coach_name,
      assistant.name AS assistant_coach_name,
      COUNT(CASE WHEN tp.is_active = 1 THEN 1 END) AS player_count
    FROM teams t
    LEFT JOIN users coach ON coach.id = t.coach_id
    LEFT JOIN users assistant ON assistant.id = t.assistant_coach_id
    LEFT JOIN team_players tp ON tp.team_id = t.id
    WHERE 1 = 1
  `;
  const params = [];

  if (req.user.role === 'coach') {
    sql += ` AND t.coach_id = ?`;
    params.push(req.user.id);
  }

  if (req.user.role === 'assistant_coach') {
    sql += ` AND t.assistant_coach_id = ?`;
    params.push(req.user.id);
  }

  // Players only see teams they are assigned to
  if (req.user.role === 'player') {
    const player = db.prepare(`SELECT id FROM players WHERE user_id = ?`).get(req.user.id);
    if (!player) return res.json({ teams: [] });
    sql += ` AND t.id IN (SELECT team_id FROM team_players WHERE player_id = ? AND is_active = 1)`;
    params.push(player.id);
  }

  if (season) {
    sql += ` AND t.season = ?`;
    params.push(season);
  }

  if (division) {
    sql += ` AND t.division = ?`;
    params.push(division);
  }

  if (finalized != null) {
    sql += ` AND t.is_finalized = ?`;
    params.push(finalized === 'true' ? 1 : 0);
  }

  if (published != null) {
    sql += ` AND t.roster_published = ?`;
    params.push(published === 'true' ? 1 : 0);
  }

  if (search) {
    sql += ` AND t.name LIKE ?`;
    params.push(`%${search}%`);
  }

  sql += `
    GROUP BY t.id
    ORDER BY t.season DESC, t.division ASC, t.name ASC
  `;

  const teams = db.prepare(sql).all(...params).map((team) => ({
    ...team,
    is_finalized: Boolean(team.is_finalized),
    roster_published: Boolean(team.roster_published),
  }));

  res.json({ teams });
});

router.post('/', requireRole('admin'), [
  body('name').trim().notEmpty().withMessage('Team name is required'),
  body('division').optional().trim(),
  body('season').optional().trim(),
  body('coach_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('assistant_coach_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('max_players').optional().isInt({ min: 6, max: 30 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const {
    name,
    division = null,
    season = null,
    coach_id = null,
    assistant_coach_id = null,
    max_players = 14,
  } = req.body;

  if (coach_id) {
    const taken = db.prepare(`SELECT name FROM teams WHERE coach_id = ?`).get(Number(coach_id));
    if (taken) return res.status(409).json({ error: `This coach is already assigned to "${taken.name}"` });
  }
  if (assistant_coach_id) {
    const taken = db.prepare(`SELECT name FROM teams WHERE assistant_coach_id = ?`).get(Number(assistant_coach_id));
    if (taken) return res.status(409).json({ error: `This assistant coach is already assigned to "${taken.name}"` });
  }

  const result = db.prepare(`
    INSERT INTO teams (name, division, season, coach_id, assistant_coach_id, max_players)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, division, season, coach_id, assistant_coach_id, max_players);

  const teamId = result.lastInsertRowid;

  // Auto-activate assigned staff so they can log in immediately
  if (coach_id) db.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).run(Number(coach_id));
  if (assistant_coach_id) db.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).run(Number(assistant_coach_id));

  // Derive standings season: use team season, or latest existing, or current academic year
  const standingsSeason = (() => {
    if (season) return season;
    const latest = db.prepare(`SELECT season FROM standings ORDER BY season DESC LIMIT 1`).get();
    const yr = new Date().getFullYear();
    return latest?.season || `${yr}-${yr + 1}`;
  })();

  db.prepare(`
    INSERT OR IGNORE INTO standings (team_id, season, played, wins, losses, sets_won, sets_lost, points)
    VALUES (?, ?, 0, 0, 0, 0, 0, 0)
  `).run(teamId, standingsSeason);

  const io = req.app.get('io');
  if (io) io.emit('standings_updated', { team_id: teamId, season: standingsSeason });

  // Auto-create team conversation with all current members
  const convMemberIds = [...new Set([
    req.user.id,
    coach_id ? Number(coach_id) : null,
    assistant_coach_id ? Number(assistant_coach_id) : null,
  ].filter(Boolean))];

  if (convMemberIds.length >= 2) {
    const convRes = db.prepare(`
      INSERT INTO conversations (name, type, team_id, created_by) VALUES (?, 'team', ?, ?)
    `).run(name, teamId, req.user.id);
    const insertConvMember = db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`);
    convMemberIds.forEach(mid => insertConvMember.run(convRes.lastInsertRowid, mid));
  }

  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  res.status(201).json(team);
});

router.get('/:id', requireRole('admin', 'coach', 'assistant_coach'), (req, res) => {
  const teamId = Number(req.params.id);
  const team = db.prepare(`
    SELECT
      t.*,
      coach.name AS coach_name,
      assistant.name AS assistant_coach_name
    FROM teams t
    LEFT JOIN users coach ON coach.id = t.coach_id
    LEFT JOIN users assistant ON assistant.id = t.assistant_coach_id
    WHERE t.id = ?
  `).get(teamId);

  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canViewTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });

  const roster = getTeamRoster(teamId);

  res.json({
    ...team,
    is_finalized: Boolean(team.is_finalized),
    roster_published: Boolean(team.roster_published),
    roster,
  });
});

router.put('/:id', requireRole('admin', 'coach'), [
  body('name').optional().trim().notEmpty(),
  body('division').optional({ nullable: true }).trim(),
  body('season').optional({ nullable: true }).trim(),
  body('coach_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('assistant_coach_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('max_players').optional().isInt({ min: 6, max: 30 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const teamId = Number(req.params.id);
  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canManageTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });

  const allowed = ['name', 'division', 'season', 'coach_id', 'assistant_coach_id', 'max_players'];
  const updates = {};
  for (const field of allowed) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  if (updates.coach_id) {
    const taken = db.prepare(`SELECT name FROM teams WHERE coach_id = ? AND id != ?`).get(Number(updates.coach_id), teamId);
    if (taken) return res.status(409).json({ error: `This coach is already assigned to "${taken.name}"` });
  }
  if (updates.assistant_coach_id) {
    const taken = db.prepare(`SELECT name FROM teams WHERE assistant_coach_id = ? AND id != ?`).get(Number(updates.assistant_coach_id), teamId);
    if (taken) return res.status(409).json({ error: `This assistant coach is already assigned to "${taken.name}"` });
  }

  const setClause = Object.keys(updates).map((field) => `${field} = ?`).join(', ');
  db.prepare(`
    UPDATE teams
    SET ${setClause}, updated_at = datetime('now')
    WHERE id = ?
  `).run(...Object.values(updates), teamId);

  // Auto-activate any newly assigned coach/assistant
  if (updates.coach_id) db.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).run(Number(updates.coach_id));
  if (updates.assistant_coach_id) db.prepare(`UPDATE users SET is_active = 1 WHERE id = ?`).run(Number(updates.assistant_coach_id));

  res.json(db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId));
});

router.post('/:id/players', requireRole('coach'), [
  body('playerIds').optional().isArray({ min: 1 }),
  body('playerId').optional().isInt({ min: 1 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const teamId = Number(req.params.id);
  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canManageTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });

  const incomingIds = Array.isArray(req.body.playerIds)
    ? req.body.playerIds
    : req.body.playerId
      ? [req.body.playerId]
      : [];
  const playerIds = [...new Set(incomingIds.map(Number).filter(Boolean))];

  if (playerIds.length === 0) {
    return res.status(400).json({ error: 'Provide at least one playerId' });
  }

  const currentCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM team_players
    WHERE team_id = ? AND is_active = 1
  `).get(teamId).count;

  if (currentCount + playerIds.length > team.max_players) {
    return res.status(400).json({
      error: `Team capacity exceeded. Max players: ${team.max_players}`,
    });
  }

  const io = req.app.get('io');
  const assignPlayer = db.transaction((ids) => {
    const results = [];
    for (const playerId of ids) {
      const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(playerId);
      if (!player) {
        throw Object.assign(new Error(`Player ${playerId} not found`), { status: 404 });
      }

      // A player can only be on one team at a time
      const currentTeam = db.prepare(`
        SELECT t.name FROM team_players tp
        JOIN teams t ON t.id = tp.team_id
        WHERE tp.player_id = ? AND tp.is_active = 1 AND tp.team_id != ?
      `).get(playerId, teamId);
      if (currentTeam) {
        throw Object.assign(
          new Error(`${player.name} is already on "${currentTeam.name}". Remove them from that team first.`),
          { status: 409 }
        );
      }

      const existingLink = db.prepare(`
        SELECT id
        FROM team_players
        WHERE team_id = ? AND player_id = ?
      `).get(teamId, playerId);

      if (existingLink) {
        db.prepare(`
          UPDATE team_players
          SET is_active = 1, assigned_at = datetime('now')
          WHERE id = ?
        `).run(existingLink.id);
      } else {
        db.prepare(`
          INSERT INTO team_players (team_id, player_id, is_active)
          VALUES (?, ?, 1)
        `).run(teamId, playerId);
      }

      notifyUser(
        io,
        player.user_id,
        'Team Assignment Updated',
        `You have been assigned to ${team.name}.`,
        'team',
        teamId,
      );

      // Auto-add player to team conversation
      if (player.user_id) {
        const teamConv = db.prepare(`SELECT id FROM conversations WHERE team_id = ? AND type = 'team' LIMIT 1`).get(teamId);
        if (teamConv) {
          db.prepare(`INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)`).run(teamConv.id, player.user_id);
        }
      }

      results.push({
        player_id: playerId,
        player_name: player.name,
      });
    }
    return results;
  });

  try {
    const assigned = assignPlayer(playerIds);
    res.json({
      message: 'Players assigned successfully',
      assigned,
      roster: getTeamRoster(teamId),
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.delete('/:id/players/:playerId', requireRole('coach'), (req, res) => {
  const teamId = Number(req.params.id);
  const playerId = Number(req.params.playerId);

  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canManageTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });

  const existing = db.prepare(`
    SELECT tp.id, p.user_id
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = ? AND tp.player_id = ? AND tp.is_active = 1
  `).get(teamId, playerId);

  if (!existing) {
    return res.status(404).json({ error: 'Active team assignment not found' });
  }

  db.prepare(`UPDATE team_players SET is_active = 0 WHERE id = ?`).run(existing.id);
  notifyUser(
    req.app.get('io'),
    existing.user_id,
    'Roster Update',
    `You have been removed from ${team.name}.`,
    'team',
    teamId,
  );

  res.json({
    message: 'Player removed from team',
    roster: getTeamRoster(teamId),
  });
});

router.patch('/:id/finalize', requireRole('admin', 'coach'), [
  body('is_finalized').optional().isBoolean(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const teamId = Number(req.params.id);
  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canManageTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });

  const isFinalized = req.body.is_finalized === undefined ? 1 : (req.body.is_finalized ? 1 : 0);

  db.prepare(`
    UPDATE teams
    SET is_finalized = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(isFinalized, teamId);

  res.json(db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId));
});

router.patch('/:id/publish', requireRole('admin', 'coach'), [
  body('roster_published').optional().isBoolean(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const teamId = Number(req.params.id);
  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  if (!canManageTeam(req.user, team)) return res.status(403).json({ error: 'Access denied' });
  if (!team.is_finalized) {
    return res.status(400).json({ error: 'Finalize the team before publishing the roster' });
  }

  const publish = req.body.roster_published === undefined ? 1 : (req.body.roster_published ? 1 : 0);
  db.prepare(`
    UPDATE teams
    SET roster_published = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(publish, teamId);

  if (publish) {
    const io = req.app.get('io');
    const roster = getTeamRoster(teamId);
    roster.forEach((player) => {
      notifyUser(
        io,
        player.user_id,
        'Roster Published',
        `${team.name} roster has been finalized and published.`,
        'team',
        teamId,
      );
    });
  }

  res.json(db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const teamId = Number(req.params.id);
  const team = db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
  res.json({ message: 'Team deleted' });
});

module.exports = router;
