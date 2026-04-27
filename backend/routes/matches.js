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

function pushNotification(io, userId, type, title, body_) {
  if (!io || !userId) return;
  try {
    db.prepare(`INSERT INTO notifications (user_id, type, title, body) VALUES (?, ?, ?, ?)`)
      .run(userId, type, title, body_);
    io.to(`user:${userId}`).emit('notification', { type, title, body: body_ });
  } catch {}
}

// Helper: get the player record for a user
function playerForUser(userId) {
  return db.prepare(`SELECT id FROM players WHERE user_id = ?`).get(userId);
}

// Helper: get team IDs a user is associated with (as coach or as player)
function teamIdsForUser(user) {
  if (user.role === 'admin') {
    return db.prepare(`SELECT id FROM teams`).all().map(r => r.id);
  }
  if (user.role === 'coach' || user.role === 'assistant_coach') {
    return db.prepare(
      `SELECT id FROM teams WHERE coach_id = ? OR assistant_coach_id = ?`
    ).all(user.id, user.id).map(r => r.id);
  }
  if (user.role === 'player') {
    const p = playerForUser(user.id);
    if (!p) return [];
    return db.prepare(
      `SELECT team_id FROM team_players WHERE player_id = ? AND is_active = 1`
    ).all(p.id).map(r => r.team_id);
  }
  return [];
}

function seasonForMatch(match) {
  const team = db.prepare(`SELECT season FROM teams WHERE id = ?`).get(match.team_id);
  if (team?.season) return team.season;

  const date = match.match_date ? new Date(match.match_date) : new Date();
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  const start = date.getMonth() >= 7 ? year : year - 1;
  return `${start}-${start + 1}`;
}

function recomputeStandingForTeam(teamId, season) {
  const matches = db.prepare(`
    SELECT sets_us, sets_them
    FROM matches
    WHERE team_id = ?
      AND status = 'completed'
      AND sets_us IS NOT NULL
      AND sets_them IS NOT NULL
  `).all(teamId);

  const totals = matches.reduce((acc, match) => {
    const setsUs = Number(match.sets_us) || 0;
    const setsThem = Number(match.sets_them) || 0;
    acc.played += 1;
    acc.sets_won += setsUs;
    acc.sets_lost += setsThem;
    if (setsUs > setsThem) {
      acc.wins += 1;
      acc.points += 3;
    } else {
      acc.losses += 1;
    }
    return acc;
  }, { played: 0, wins: 0, losses: 0, sets_won: 0, sets_lost: 0, points: 0 });

  db.prepare(`
    INSERT INTO standings (team_id, season, played, wins, losses, sets_won, sets_lost, points)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(team_id, season) DO UPDATE SET
      played = excluded.played,
      wins = excluded.wins,
      losses = excluded.losses,
      sets_won = excluded.sets_won,
      sets_lost = excluded.sets_lost,
      points = excluded.points,
      updated_at = datetime('now')
  `).run(
    teamId,
    season,
    totals.played,
    totals.wins,
    totals.losses,
    totals.sets_won,
    totals.sets_lost,
    totals.points,
  );
}

function recomputePlayerSeasonStats(teamId, season, playerIds) {
  const ids = [...new Set(playerIds.map(Number).filter(Boolean))];
  if (!ids.length) return;

  const aggregate = db.prepare(`
    SELECT
      COUNT(DISTINCT CASE
        WHEN mps.sets_played > 0 OR mps.points > 0 OR mps.kills > 0 OR mps.aces > 0
          OR mps.blocks > 0 OR mps.digs > 0 OR mps.errors > 0
        THEN mps.match_id
      END) AS matches_played,
      COALESCE(SUM(mps.sets_played), 0) AS sets_played,
      COALESCE(SUM(mps.points), 0) AS points,
      COALESCE(SUM(mps.kills), 0) AS kills,
      COALESCE(SUM(mps.aces), 0) AS aces,
      COALESCE(SUM(mps.blocks), 0) AS blocks,
      COALESCE(SUM(mps.digs), 0) AS digs,
      COALESCE(SUM(mps.errors), 0) AS errors
    FROM match_player_stats mps
    JOIN matches m ON m.id = mps.match_id
    WHERE mps.player_id = ?
      AND m.team_id = ?
      AND m.status = 'completed'
  `);

  const upsert = db.prepare(`
    INSERT INTO player_stats (
      player_id, season, matches_played, sets_played, points, kills, aces, blocks, digs, errors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, season) DO UPDATE SET
      matches_played = excluded.matches_played,
      sets_played = excluded.sets_played,
      points = excluded.points,
      kills = excluded.kills,
      aces = excluded.aces,
      blocks = excluded.blocks,
      digs = excluded.digs,
      errors = excluded.errors
  `);

  const recompute = db.transaction(() => {
    ids.forEach((playerId) => {
      const totals = aggregate.get(playerId, teamId);
      upsert.run(
        playerId,
        season,
        totals.matches_played || 0,
        totals.sets_played || 0,
        totals.points || 0,
        totals.kills || 0,
        totals.aces || 0,
        totals.blocks || 0,
        totals.digs || 0,
        totals.errors || 0,
      );
    });
  });

  recompute();
}

// ─── GET /api/matches ─────────────────────────────────────────────────────────
router.get('/', authenticate, (req, res) => {
  const { team_id, status, upcoming } = req.query;
  const allowedTeams = teamIdsForUser(req.user);
  if (!allowedTeams.length) return res.json({ matches: [] });

  let sql = `
    SELECT m.*,
           t.name AS team_name,
           t.division,
           (SELECT COUNT(*) FROM match_lineups ml WHERE ml.match_id = m.id) AS lineup_count,
           (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = m.team_id AND tp.is_active = 1) AS roster_size
    FROM matches m
    JOIN teams t ON t.id = m.team_id
    WHERE m.team_id IN (${allowedTeams.map(() => '?').join(',')})
  `;
  const params = [...allowedTeams];

  if (team_id) { sql += ` AND m.team_id = ?`; params.push(Number(team_id)); }
  if (status)  { sql += ` AND m.status = ?`;  params.push(status); }
  if (upcoming === 'true') {
    sql += ` AND m.status = 'scheduled' AND m.match_date >= datetime('now')`;
  }

  sql += ` ORDER BY m.match_date ASC`;
  const matches = db.prepare(sql).all(...params);
  res.json({ matches });
});

// ─── POST /api/matches ────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole('admin', 'coach'), [
  body('team_id').isInt(),
  body('opponent').trim().notEmpty(),
  body('match_date').notEmpty(),
  body('home_away').optional().isIn(['home', 'away', 'neutral']),
  body('competition').optional().trim(),
  body('location').optional().trim(),
  body('notes').optional().trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;
  const { team_id, opponent, match_date, home_away = 'home', competition, location, notes } = req.body;

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(Number(team_id))) {
    return res.status(403).json({ error: 'Not authorised for this team' });
  }

  const result = db.prepare(`
    INSERT INTO matches (team_id, opponent, match_date, home_away, competition, location, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(team_id, opponent, match_date, home_away, competition ?? null, location ?? null, notes ?? null, req.user.id);

  const match = db.prepare(`
    SELECT m.*, t.name AS team_name FROM matches m JOIN teams t ON t.id = m.team_id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  // Notify all players on the team's roster
  const roster = db.prepare(`
    SELECT p.user_id FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1 AND p.user_id IS NOT NULL
  `).all(team_id);
  const io = req.app.get('io');
  roster.forEach(r => pushNotification(io, r.user_id, 'match_scheduled',
    '📅 New Match Scheduled',
    `${match.team_name} vs ${opponent} on ${new Date(match_date).toLocaleDateString()}`));

  res.status(201).json(match);
});

// ─── GET /api/matches/my ──────────────────────────────────────────────────────
// Player's next upcoming match + their lineup status
router.get('/my', authenticate, (req, res) => {
  const player = playerForUser(req.user.id);
  if (!player) return res.json({ match: null, role: null });

  const teamIds = teamIdsForUser(req.user);
  if (!teamIds.length) return res.json({ match: null, role: null });

  const match = db.prepare(`
    SELECT m.*, t.name AS team_name, t.division,
           (SELECT COUNT(*) FROM match_lineups ml WHERE ml.match_id = m.id AND ml.role = 'starter') AS starter_count,
           (SELECT COUNT(*) FROM match_lineups ml WHERE ml.match_id = m.id) AS lineup_count,
           (SELECT COUNT(*) FROM team_players tp WHERE tp.team_id = m.team_id AND tp.is_active = 1) AS roster_size
    FROM matches m
    JOIN teams t ON t.id = m.team_id
    WHERE m.team_id IN (${teamIds.map(() => '?').join(',')})
      AND m.status = 'scheduled'
      AND m.match_date >= datetime('now')
    ORDER BY m.match_date ASC
    LIMIT 1
  `).get(...teamIds);

  if (!match) return res.json({ match: null, role: null });

  const lineup = db.prepare(
    `SELECT role, position, notes FROM match_lineups WHERE match_id = ? AND player_id = ?`
  ).get(match.id, player.id);

  res.json({ match, role: lineup?.role ?? null, position: lineup?.position ?? null });
});

// ─── GET /api/matches/:id ─────────────────────────────────────────────────────
router.get('/:id', authenticate, (req, res) => {
  const match = db.prepare(`
    SELECT m.*, t.name AS team_name, t.division
    FROM matches m JOIN teams t ON t.id = m.team_id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });

  // Full lineup with player details
  const lineup = db.prepare(`
    SELECT ml.*, p.name AS player_name, p.position AS player_position, p.jersey_number
    FROM match_lineups ml
    JOIN players p ON p.id = ml.player_id
    WHERE ml.match_id = ?
    ORDER BY ml.role DESC, p.name ASC
  `).all(match.id);

  // Roster not yet in lineup
  const lineupPlayerIds = lineup.map(l => l.player_id);
  const rosterSql = `
    SELECT p.id, p.name, p.position, p.jersey_number
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1
    ${lineupPlayerIds.length ? `AND p.id NOT IN (${lineupPlayerIds.map(() => '?').join(',')})` : ''}
    ORDER BY p.name ASC
  `;
  const unassigned = db.prepare(rosterSql).all(match.team_id, ...lineupPlayerIds);

  res.json({ ...match, lineup, unassigned });
});

router.get('/:id/stats', authenticate, (req, res) => {
  const match = db.prepare(`
    SELECT m.*, t.name AS team_name
    FROM matches m
    JOIN teams t ON t.id = m.team_id
    WHERE m.id = ?
  `).get(req.params.id);

  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });

  const players = db.prepare(`
    SELECT
      p.id AS player_id,
      p.name AS player_name,
      p.position,
      p.jersey_number,
      ml.role,
      COALESCE(mps.sets_played, 0) AS sets_played,
      COALESCE(mps.points, 0) AS points,
      COALESCE(mps.kills, 0) AS kills,
      COALESCE(mps.aces, 0) AS aces,
      COALESCE(mps.blocks, 0) AS blocks,
      COALESCE(mps.digs, 0) AS digs,
      COALESCE(mps.errors, 0) AS errors
    FROM team_players tp
    JOIN players p ON p.id = tp.player_id
    LEFT JOIN match_lineups ml ON ml.match_id = ? AND ml.player_id = p.id
    LEFT JOIN match_player_stats mps ON mps.match_id = ? AND mps.player_id = p.id
    WHERE tp.team_id = ? AND tp.is_active = 1
    ORDER BY
      CASE ml.role WHEN 'starter' THEN 0 WHEN 'substitute' THEN 1 ELSE 2 END,
      p.name ASC
  `).all(match.id, match.id, match.team_id);

  res.json({ match, season: seasonForMatch(match), players });
});

router.post('/:id/stats', authenticate, requireRole('admin', 'coach', 'assistant_coach'), [
  body('stats').isArray({ min: 1 }),
  body('stats.*.player_id').isInt({ min: 1 }),
  body('stats.*.sets_played').optional().isInt({ min: 0 }),
  body('stats.*.points').optional().isInt({ min: 0 }),
  body('stats.*.kills').optional().isInt({ min: 0 }),
  body('stats.*.aces').optional().isInt({ min: 0 }),
  body('stats.*.blocks').optional().isInt({ min: 0 }),
  body('stats.*.digs').optional().isInt({ min: 0 }),
  body('stats.*.errors').optional().isInt({ min: 0 }),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });
  if (match.status !== 'completed') {
    return res.status(400).json({ error: 'Record the match result before saving player stats' });
  }

  const rosterIds = new Set(db.prepare(`
    SELECT player_id FROM team_players
    WHERE team_id = ? AND is_active = 1
  `).all(match.team_id).map(r => r.player_id));

  const rows = req.body.stats.map((row) => ({
    player_id: Number(row.player_id),
    sets_played: Number(row.sets_played) || 0,
    points: Number(row.points) || 0,
    kills: Number(row.kills) || 0,
    aces: Number(row.aces) || 0,
    blocks: Number(row.blocks) || 0,
    digs: Number(row.digs) || 0,
    errors: Number(row.errors) || 0,
  }));

  const invalid = rows.find(row => !rosterIds.has(row.player_id));
  if (invalid) {
    return res.status(403).json({ error: 'Stats can only be recorded for players on this team roster' });
  }

  const upsert = db.prepare(`
    INSERT INTO match_player_stats (
      match_id, player_id, sets_played, points, kills, aces, blocks, digs, errors
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      sets_played = excluded.sets_played,
      points = excluded.points,
      kills = excluded.kills,
      aces = excluded.aces,
      blocks = excluded.blocks,
      digs = excluded.digs,
      errors = excluded.errors,
      updated_at = datetime('now')
  `);

  const saveAll = db.transaction(() => {
    rows.forEach(row => upsert.run(
      match.id,
      row.player_id,
      row.sets_played,
      row.points,
      row.kills,
      row.aces,
      row.blocks,
      row.digs,
      row.errors,
    ));
  });
  saveAll();

  const season = seasonForMatch(match);
  recomputePlayerSeasonStats(match.team_id, season, rows.map(row => row.player_id));

  res.json({ saved: rows.length, season });
});

// ─── PUT /api/matches/:id ─────────────────────────────────────────────────────
router.put('/:id', authenticate, requireRole('admin', 'coach'), [
  body('opponent').optional().trim().notEmpty(),
  body('match_date').optional().notEmpty(),
  body('home_away').optional().isIn(['home', 'away', 'neutral']),
  body('status').optional().isIn(['scheduled', 'completed', 'cancelled', 'postponed']),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });

  const { opponent, match_date, home_away, competition, location, status, score_us, score_them, sets_us, sets_them, notes } = req.body;

  db.prepare(`
    UPDATE matches SET
      opponent    = COALESCE(?, opponent),
      match_date  = COALESCE(?, match_date),
      home_away   = COALESCE(?, home_away),
      competition = COALESCE(?, competition),
      location    = COALESCE(?, location),
      status      = COALESCE(?, status),
      score_us    = COALESCE(?, score_us),
      score_them  = COALESCE(?, score_them),
      sets_us     = COALESCE(?, sets_us),
      sets_them   = COALESCE(?, sets_them),
      notes       = COALESCE(?, notes),
      updated_at  = datetime('now')
    WHERE id = ?
  `).run(opponent ?? null, match_date ?? null, home_away ?? null, competition ?? null,
         location ?? null, status ?? null, score_us ?? null, score_them ?? null,
         sets_us ?? null, sets_them ?? null, notes ?? null, match.id);

  const updated = db.prepare(`
    SELECT m.*, t.name AS team_name FROM matches m JOIN teams t ON t.id = m.team_id WHERE m.id = ?
  `).get(match.id);

  const season = seasonForMatch(updated);
  recomputeStandingForTeam(updated.team_id, season);

  if (updated.status === 'completed' && updated.sets_us != null && updated.sets_them != null) {
    const roster = db.prepare(`
      SELECT p.user_id FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = ? AND tp.is_active = 1 AND p.user_id IS NOT NULL
    `).all(updated.team_id);
    const io = req.app.get('io');
    const resultLabel = Number(updated.sets_us) > Number(updated.sets_them) ? 'won' : 'lost';
    roster.forEach(r => pushNotification(
      io,
      r.user_id,
      'match_result',
      'Match Result Recorded',
      `${updated.team_name} ${resultLabel} ${updated.sets_us}-${updated.sets_them} vs ${updated.opponent}.`,
    ));
  }

  res.json(updated);
});

// ─── DELETE /api/matches/:id ──────────────────────────────────────────────────
router.delete('/:id', authenticate, requireRole('admin', 'coach'), (req, res) => {
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });

  db.prepare(`DELETE FROM matches WHERE id = ?`).run(match.id);
  res.json({ message: 'Deleted' });
});

// ─── POST /api/matches/:id/lineup ─────────────────────────────────────────────
// Bulk upsert: body = { lineup: [{ player_id, role, position, notes }, ...] }
router.post('/:id/lineup', authenticate, requireRole('coach', 'assistant_coach'), (req, res) => {
  const match = db.prepare(`SELECT * FROM matches WHERE id = ?`).get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });

  const allowed = teamIdsForUser(req.user);
  if (!allowed.includes(match.team_id)) return res.status(403).json({ error: 'Forbidden' });

  const { lineup } = req.body;
  if (!Array.isArray(lineup)) return res.status(422).json({ error: 'lineup must be an array' });

  const upsert = db.prepare(`
    INSERT INTO match_lineups (match_id, player_id, role, position, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, player_id) DO UPDATE SET
      role = excluded.role,
      position = excluded.position,
      notes = excluded.notes,
      created_by = excluded.created_by
  `);

  const remove = db.prepare(`DELETE FROM match_lineups WHERE match_id = ? AND player_id = ?`);

  db.transaction(() => {
    for (const entry of lineup) {
      if (entry.role === 'remove') {
        remove.run(match.id, entry.player_id);
      } else {
        upsert.run(match.id, entry.player_id, entry.role ?? 'substitute',
          entry.position ?? null, entry.notes ?? null, req.user.id);
      }
    }
  })();

  // Notify affected players
  const io = req.app.get('io');
  for (const entry of lineup) {
    if (entry.role === 'remove') continue;
    const player = db.prepare(`SELECT user_id, name FROM players WHERE id = ?`).get(entry.player_id);
    if (!player?.user_id) continue;
    const roleLabel = entry.role === 'starter' ? '🟢 Starting XI' : '🔵 Substitute';
    pushNotification(io, player.user_id, 'lineup_set',
      '📋 Lineup Updated',
      `You have been selected as ${roleLabel} for the match vs ${match.opponent}`);
  }

  // Return full updated lineup
  const updated = db.prepare(`
    SELECT ml.*, p.name AS player_name, p.position AS player_position, p.jersey_number
    FROM match_lineups ml
    JOIN players p ON p.id = ml.player_id
    WHERE ml.match_id = ?
    ORDER BY ml.role DESC, p.name ASC
  `).all(match.id);

  res.json({ lineup: updated });
});

module.exports = router;
