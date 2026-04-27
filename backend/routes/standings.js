const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function computeRankedStandings(rows) {
  const sorted = [...rows].sort((a, b) => {
    const aSetRatio = a.sets_lost === 0 ? a.sets_won : a.sets_won / a.sets_lost;
    const bSetRatio = b.sets_lost === 0 ? b.sets_won : b.sets_won / b.sets_lost;

    return (
      b.points - a.points ||
      b.wins - a.wins ||
      bSetRatio - aSetRatio ||
      b.sets_won - a.sets_won ||
      a.team_name.localeCompare(b.team_name)
    );
  });

  return sorted.map((row, index) => ({
    ...row,
    rank: index + 1,
    set_ratio: row.sets_lost === 0 ? row.sets_won : Number((row.sets_won / row.sets_lost).toFixed(2)),
    win_rate: row.played ? Number(((row.wins / row.played) * 100).toFixed(1)) : 0,
  }));
}

function upsertStandingRecord(req, res, teamId) {
  const {
    season,
    played = 0,
    wins = 0,
    losses = 0,
    sets_won = 0,
    sets_lost = 0,
    points = 0,
  } = req.body;

  const team = db.prepare(`SELECT id FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

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
  `).run(teamId, season, played, wins, losses, sets_won, sets_lost, points);

  const saved = db.prepare(`SELECT * FROM standings WHERE team_id = ? AND season = ?`).get(teamId, season);

  // Broadcast so all connected clients refresh standings in real-time
  const io = req.app.get('io');
  if (io) io.emit('standings_updated', { team_id: teamId, season });

  return res.status(201).json(saved);
}

router.get('/', (req, res) => {
  const { season: seasonParam, division, team_id } = req.query;

  // Derive effective season: explicit param → latest in DB → current academic year
  let season = seasonParam;
  if (!season) {
    const latest = db.prepare(`SELECT season FROM standings ORDER BY season DESC LIMIT 1`).get();
    const yr = new Date().getFullYear();
    season = latest?.season || `${yr}-${yr + 1}`;
  }

  // All seasons that have any data (for filter buttons in UI)
  const allSeasons = db.prepare(`SELECT DISTINCT season FROM standings ORDER BY season DESC`)
    .all().map((r) => r.season);
  if (!allSeasons.includes(season)) allSeasons.unshift(season);

  let sql = `
    SELECT
      t.id   AS team_id,
      t.name AS team_name,
      t.division,
      s.id,
      ?      AS season,
      COALESCE(s.played,    0) AS played,
      COALESCE(s.wins,      0) AS wins,
      COALESCE(s.losses,    0) AS losses,
      COALESCE(s.sets_won,  0) AS sets_won,
      COALESCE(s.sets_lost, 0) AS sets_lost,
      COALESCE(s.points,    0) AS points,
      s.updated_at
    FROM teams t
    LEFT JOIN standings s ON s.team_id = t.id AND s.season = ?
    WHERE 1 = 1
  `;
  const params = [season, season];

  if (division) {
    sql += ` AND t.division = ?`;
    params.push(division);
  }

  if (team_id) {
    sql += ` AND t.id = ?`;
    params.push(Number(team_id));
  }

  sql += ` ORDER BY COALESCE(s.points, 0) DESC, COALESCE(s.wins, 0) DESC, s.updated_at DESC, t.name ASC`;

  const standings = computeRankedStandings(db.prepare(sql).all(...params));
  res.json({ standings, seasons: allSeasons });
});

router.post('/', authenticate, requireRole('admin'), [
  body('team_id').isInt({ min: 1 }),
  body('season').trim().notEmpty(),
  body('played').optional().isInt({ min: 0 }),
  body('wins').optional().isInt({ min: 0 }),
  body('losses').optional().isInt({ min: 0 }),
  body('sets_won').optional().isInt({ min: 0 }),
  body('sets_lost').optional().isInt({ min: 0 }),
  body('points').optional().isInt({ min: 0 }),
], (req, res) => {
  if (validationErrors(req, res)) return;
  return upsertStandingRecord(req, res, Number(req.body.team_id));
});

router.put('/:teamId', authenticate, requireRole('admin'), [
  body('season').trim().notEmpty(),
  body('played').optional().isInt({ min: 0 }),
  body('wins').optional().isInt({ min: 0 }),
  body('losses').optional().isInt({ min: 0 }),
  body('sets_won').optional().isInt({ min: 0 }),
  body('sets_lost').optional().isInt({ min: 0 }),
  body('points').optional().isInt({ min: 0 }),
], (req, res) => {
  if (validationErrors(req, res)) return;
  return upsertStandingRecord(req, res, Number(req.params.teamId));
});

module.exports = router;
