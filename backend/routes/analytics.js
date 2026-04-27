const express = require('express');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── Helper: get team IDs accessible to a user ────────────────────────────────
function accessibleTeamIds(user) {
  if (user.role === 'admin') {
    return db.prepare(`SELECT id FROM teams`).all().map(r => r.id);
  }
  return db.prepare(
    `SELECT id FROM teams WHERE coach_id = ? OR assistant_coach_id = ?`
  ).all(user.id, user.id).map(r => r.id);
}

// ─── GET /api/analytics/admin ─────────────────────────────────────────────────
// Admin-only: club-wide analytics
router.get('/admin', authenticate, requireRole('admin'), (req, res) => {
  // ── Payment KPIs ──────────────────────────────────────────────────────────
  const paymentKpi = db.prepare(`
    SELECT
      COALESCE(SUM(amount), 0)                                           AS total_invoiced,
      COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount ELSE 0 END), 0) AS total_collected,
      COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0) AS overdue_amount,
      COUNT(*)                                                            AS total_payments,
      COUNT(CASE WHEN status = 'paid'    THEN 1 END)                     AS paid_count,
      COUNT(CASE WHEN status = 'pending' THEN 1 END)                     AS pending_count,
      COUNT(CASE WHEN status = 'overdue' THEN 1 END)                     AS overdue_count,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END)                   AS cancelled_count
    FROM payments
  `).get();

  const paymentPct = paymentKpi.total_payments > 0
    ? Math.round((paymentKpi.paid_count / paymentKpi.total_payments) * 100)
    : 0;

  // ── Active players ────────────────────────────────────────────────────────
  const activePlayers = db.prepare(
    `SELECT COUNT(*) AS count FROM players WHERE registration_status = 'approved'`
  ).get().count;

  // ── Club-wide attendance rate ─────────────────────────────────────────────
  const attRow = db.prepare(`
    SELECT
      COUNT(CASE WHEN status IN ('present','late') THEN 1 END) * 100.0
        / NULLIF(COUNT(id), 0) AS rate
    FROM attendance
  `).get();
  const attendanceRate = attRow.rate ? Math.round(attRow.rate) : 0;

  // ── Alert: players with overdue payments ──────────────────────────────────
  const overdueAlert = db.prepare(`
    SELECT COUNT(DISTINCT player_id) AS count,
           COALESCE(SUM(amount), 0)  AS amount
    FROM payments WHERE status = 'overdue'
  `).get();

  // ── Payment status distribution (for donut) ───────────────────────────────
  const paymentStatusDist = db.prepare(`
    SELECT status,
           COUNT(*)      AS count,
           SUM(amount)   AS total
    FROM payments
    GROUP BY status
  `).all();

  // ── Monthly attendance trends (last 7 months) ─────────────────────────────
  const monthlyAttendance = db.prepare(`
    SELECT
      strftime('%Y-%m', ts.date) AS month,
      COUNT(DISTINCT ts.id)                                              AS sessions,
      COUNT(a.id)                                                        AS total_marks,
      COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END)        AS attended
    FROM training_sessions ts
    LEFT JOIN attendance a ON a.session_id = ts.id
    GROUP BY month
    ORDER BY month DESC
    LIMIT 7
  `).all().reverse();

  // ── Overdue payments table (top 20) ──────────────────────────────────────
  const overdueList = db.prepare(`
    SELECT
      p.id        AS player_id,
      p.name      AS player_name,
      p.email     AS player_email,
      t.name      AS team_name,
      pay.amount,
      pay.due_date,
      pay.description,
      pay.status
    FROM payments pay
    JOIN players p ON p.id = pay.player_id
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE pay.status = 'overdue'
    ORDER BY pay.amount DESC
    LIMIT 20
  `).all();

  // ── All teams performance ─────────────────────────────────────────────────
  const teamsPerf = db.prepare(`
    SELECT
      t.id               AS team_id,
      t.name             AS team_name,
      t.division,
      COALESCE(s.wins,     0) AS wins,
      COALESCE(s.losses,   0) AS losses,
      COALESCE(s.played,   0) AS played,
      COALESCE(s.points,   0) AS points,
      COALESCE(s.sets_won, 0) AS sets_won,
      COALESCE(s.sets_lost,0) AS sets_lost,
      (SELECT COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) * 100.0
              / NULLIF(COUNT(ts.id), 0)
       FROM team_players tp3
       JOIN training_sessions ts ON ts.team_id = tp3.team_id
       LEFT JOIN attendance a ON a.session_id = ts.id AND a.player_id = tp3.player_id
       WHERE tp3.team_id = t.id AND tp3.is_active = 1)          AS team_attendance_rate,
      (SELECT COUNT(*) FROM team_players tp2
       WHERE tp2.team_id = t.id AND tp2.is_active = 1)        AS player_count
    FROM teams t
    LEFT JOIN standings s ON s.team_id = t.id
      AND s.season = (SELECT COALESCE(MAX(season), '') FROM standings)
    ORDER BY s.points DESC NULLS LAST
  `).all().map(row => ({
    ...row,
    win_rate: row.played > 0 ? Math.round((row.wins / row.played) * 100) : 0,
    set_ratio: row.sets_lost > 0
      ? Number((row.sets_won / row.sets_lost).toFixed(2))
      : row.sets_won,
    team_attendance_rate: row.team_attendance_rate
      ? Math.round(row.team_attendance_rate)
      : 0,
  }));

  // ── Players registered per team ───────────────────────────────────────────
  const registrationByTeam = db.prepare(`
    SELECT
      t.name        AS team_name,
      COUNT(tp.player_id) AS player_count
    FROM teams t
    LEFT JOIN team_players tp ON tp.team_id = t.id AND tp.is_active = 1
    GROUP BY t.id
    ORDER BY player_count DESC
  `).all();

  res.json({
    kpi: {
      total_collected: paymentKpi.total_collected,
      total_invoiced:  paymentKpi.total_invoiced,
      payment_pct:     paymentPct,
      attendance_pct:  attendanceRate,
      active_players:  activePlayers,
      overdue_amount:  paymentKpi.overdue_amount,
    },
    overdue_alert: overdueAlert,
    payment_status_dist: paymentStatusDist,
    monthly_attendance:  monthlyAttendance,
    overdue_list:        overdueList,
    teams_performance:   teamsPerf,
    registration_by_team: registrationByTeam,
  });
});

// ─── GET /api/analytics/coach ─────────────────────────────────────────────────
// Coach/assistant/admin: team-scoped analytics
router.get('/coach', authenticate, requireRole('admin', 'coach', 'assistant_coach'), (req, res) => {
  const { team_id } = req.query;

  // Determine accessible teams
  const accessible = accessibleTeamIds(req.user);
  if (!accessible.length) return res.json({ error: 'No teams accessible' });

  // Use requested team_id if accessible, else default to first
  let tid = team_id ? Number(team_id) : accessible[0];
  if (!accessible.includes(tid)) return res.status(403).json({ error: 'Access denied to that team' });

  const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(tid);
  if (!team) return res.status(404).json({ error: 'Team not found' });
  const statSeason = req.query.season
    || team.season
    || db.prepare(`
      SELECT ps.season
      FROM player_stats ps
      JOIN team_players tp ON tp.player_id = ps.player_id AND tp.team_id = ?
      ORDER BY ps.season DESC
      LIMIT 1
    `).get(tid)?.season
    || '2024-2025';

  // ── KPIs ────────────────────────────────────────────────────────────────
  const standing = db.prepare(`
    SELECT * FROM standings WHERE team_id = ?
    ORDER BY season DESC LIMIT 1
  `).get(tid);

  const playerCount = db.prepare(
    `SELECT COUNT(*) AS count FROM team_players WHERE team_id = ? AND is_active = 1`
  ).get(tid).count;

  const attRow = db.prepare(`
    SELECT
      COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) * 100.0
        / NULLIF(COUNT(ts.id), 0) AS rate
    FROM team_players tp
    JOIN training_sessions ts ON ts.team_id = tp.team_id
    LEFT JOIN attendance a ON a.session_id = ts.id AND a.player_id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1
  `).get(tid);
  const teamAttendanceRate = attRow.rate ? Math.round(attRow.rate) : 0;

  // ── Player attendance table ───────────────────────────────────────────────
  const playerAttendance = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.position,
      COUNT(ts.id)                                                        AS total_sessions,
      COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END)         AS attended,
      COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) * 100.0
        / NULLIF(COUNT(ts.id), 0)                                         AS rate
    FROM players p
    JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = ?
    LEFT JOIN training_sessions ts ON ts.team_id = tp.team_id
    LEFT JOIN attendance a ON a.session_id = ts.id AND a.player_id = p.id
    GROUP BY p.id
    ORDER BY rate DESC NULLS LAST
  `).all(tid).map(r => ({
    ...r,
    rate: r.rate ? Math.round(r.rate) : 0,
    risk: r.rate == null ? 'Unknown'
        : r.rate >= 80 ? 'Low'
        : r.rate >= 60 ? 'Medium'
        : 'High',
  }));

  // ── Recent match results (last 5 completed) ──────────────────────────────
  const recentMatches = db.prepare(`
    SELECT id, opponent, match_date, sets_us, sets_them, score_us, score_them,
           home_away, competition, location, status
    FROM matches
    WHERE team_id = ? AND status = 'completed'
    ORDER BY match_date DESC
    LIMIT 5
  `).all(tid).map(m => ({
    ...m,
    result: m.sets_us != null && m.sets_them != null
      ? (m.sets_us > m.sets_them ? 'W' : 'L')
      : null,
  }));

  // ── Top player stats (last season) ───────────────────────────────────────
  const topStats = db.prepare(`
    SELECT
      p.id, p.name, p.position,
      ps.matches_played, ps.points, ps.kills, ps.aces, ps.blocks, ps.digs, ps.errors, ps.season
    FROM player_stats ps
    JOIN players p ON p.id = ps.player_id
    JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = ?
    WHERE ps.season = ?
    ORDER BY ps.points DESC
    LIMIT 5
  `).all(tid, statSeason);

  // ── Accessible teams list (for switcher) ─────────────────────────────────
  const teamList = db.prepare(
    `SELECT id, name, division FROM teams WHERE id IN (${accessible.map(() => '?').join(',')})`
  ).all(...accessible);

  res.json({
    team,
    team_list: teamList,
    kpi: {
      attendance_rate: teamAttendanceRate,
      wins:    standing?.wins    ?? 0,
      losses:  standing?.losses  ?? 0,
      played:  standing?.played  ?? 0,
      points:  standing?.points  ?? 0,
      sets_won:  standing?.sets_won  ?? 0,
      sets_lost: standing?.sets_lost ?? 0,
      set_ratio: standing?.sets_lost
        ? Number((standing.sets_won / standing.sets_lost).toFixed(2))
        : (standing?.sets_won ?? 0),
      player_count: playerCount,
    },
    player_attendance: playerAttendance,
    recent_matches:    recentMatches,
    top_stats:         topStats,
    stat_season:       statSeason,
  });
});

module.exports = router;
