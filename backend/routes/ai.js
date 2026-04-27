const express = require('express');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate, requireRole('admin', 'coach', 'assistant_coach'));

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_AI_MODEL || 'gpt-5.4-mini';
const MAX_AI_INPUT_CHARS = 14000;

function compactJson(value, maxChars = MAX_AI_INPUT_CHARS) {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...truncated to control token cost...`;
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.value === 'string') chunks.push(content.value);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonObject(text) {
  const clean = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) return null;
    try {
      return JSON.parse(clean.slice(first, last + 1));
    } catch {
      return null;
    }
  }
}

async function callOpenAI({ instructions, input, maxOutputTokens = 700 }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: DEFAULT_OPENAI_MODEL,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI request failed (${response.status}): ${raw.slice(0, 240)}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('OpenAI returned a non-JSON response');
  }

  const text = extractOpenAIText(data);
  if (!text) throw new Error('OpenAI returned an empty response');

  return { model: DEFAULT_OPENAI_MODEL, text };
}

function loadTeamContext(teamId) {
  if (!teamId) return null;

  const team = db.prepare(`SELECT id, name, division, season FROM teams WHERE id = ?`).get(teamId);
  if (!team) return null;

  const standing = db.prepare(`
    SELECT played, wins, losses, sets_won, sets_lost, points, season
    FROM standings
    WHERE team_id = ?
    ORDER BY season DESC
    LIMIT 1
  `).get(teamId);

  const statSeason = standing?.season || team.season || '2024-2025';

  const topPlayers = db.prepare(`
    SELECT
      p.name,
      p.position,
      ps.matches_played,
      ps.points,
      ps.kills,
      ps.aces,
      ps.blocks,
      ps.digs,
      ps.errors
    FROM player_stats ps
    JOIN players p ON p.id = ps.player_id
    JOIN team_players tp ON tp.player_id = p.id AND tp.team_id = ?
    WHERE ps.season = ?
    ORDER BY ps.points DESC, ps.kills DESC
    LIMIT 5
  `).all(teamId, statSeason);

  const recentMatches = db.prepare(`
    SELECT opponent, sets_us, sets_them, match_date
    FROM matches
    WHERE team_id = ? AND status = 'completed'
    ORDER BY match_date DESC
    LIMIT 3
  `).all(teamId);

  const attendance = db.prepare(`
    SELECT COUNT(CASE WHEN a.status IN ('present','late') THEN 1 END) * 100.0
      / NULLIF(COUNT(ts.id), 0) AS rate
    FROM team_players tp
    JOIN training_sessions ts ON ts.team_id = tp.team_id
    LEFT JOIN attendance a ON a.session_id = ts.id AND a.player_id = tp.player_id
    WHERE tp.team_id = ? AND tp.is_active = 1
  `).get(teamId);

  return {
    team,
    standing,
    statSeason,
    topPlayers,
    recentMatches,
    attendanceRate: attendance?.rate ? Math.round(attendance.rate) : null,
  };
}

function accessibleTeamIds(user) {
  if (user.role === 'admin') return db.prepare(`SELECT id FROM teams`).all().map(r => r.id);
  return db.prepare(`SELECT id FROM teams WHERE coach_id = ? OR assistant_coach_id = ?`)
    .all(user.id, user.id).map(r => r.id);
}

const POSITION_LABELS = {
  setter: 'Setter',
  libero: 'Libero',
  outside_hitter: 'Outside Hitter',
  opposite: 'Opposite',
  middle_blocker: 'Middle Blocker',
  defensive_specialist: 'Defensive Specialist',
};

const POSITION_KEYS = Object.keys(POSITION_LABELS);

function n(value) {
  return Number(value) || 0;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function topEvaluationSkills(player) {
  return [
    ['serving', player.serving],
    ['passing', player.passing],
    ['setting', player.setting],
    ['hitting', player.hitting],
    ['blocking', player.blocking],
    ['defense', player.defense],
    ['athleticism', player.athleticism],
    ['coachability', player.coachability],
  ]
    .filter(([, value]) => value != null)
    .sort((a, b) => n(b[1]) - n(a[1]))
    .slice(0, 3)
    .map(([skill, value]) => `${skill} ${round1(n(value))}/10`);
}

function statHighlights(player) {
  return [
    ['points', player.points],
    ['kills', player.kills],
    ['aces', player.aces],
    ['blocks', player.blocks],
    ['digs', player.digs],
    ['errors', player.errors],
  ]
    .filter(([, value]) => n(value) > 0)
    .sort((a, b) => n(b[1]) - n(a[1]))
    .slice(0, 4)
    .map(([stat, value]) => `${n(value)} ${stat}`);
}

function scorePositionFit(player) {
  const matches = Math.max(1, n(player.matches_played));
  const attackBoost = clamp((n(player.points) / matches) * 0.25 + (n(player.kills) / matches) * 0.45 - (n(player.errors) / matches) * 0.2, -2, 3);
  const serveBoost = clamp((n(player.aces) / matches) * 0.7, 0, 3);
  const blockBoost = clamp((n(player.blocks) / matches) * 0.8, 0, 3);
  const digBoost = clamp((n(player.digs) / matches) * 0.45, 0, 3);
  const reliabilityBoost = clamp((n(player.sets_played) / matches) * 0.08 - (n(player.errors) / matches) * 0.25, -2, 2);

  const skills = {
    serving: n(player.serving),
    passing: n(player.passing),
    setting: n(player.setting),
    hitting: n(player.hitting),
    blocking: n(player.blocking),
    defense: n(player.defense),
    athleticism: n(player.athleticism),
    coachability: n(player.coachability),
  };

  return {
    setter: round1(
      skills.setting * 2.2 + skills.serving * 1.0 + skills.passing * 1.0 +
      skills.defense * 0.7 + skills.coachability * 0.9 + serveBoost * 0.7 +
      digBoost * 0.3 + reliabilityBoost
    ),
    libero: round1(
      skills.defense * 2.2 + skills.passing * 1.8 + skills.coachability * 0.8 +
      skills.athleticism * 0.7 + digBoost * 1.1 + reliabilityBoost
    ),
    outside_hitter: round1(
      skills.hitting * 1.6 + skills.passing * 1.1 + skills.defense * 0.9 +
      skills.serving * 0.8 + skills.athleticism * 0.9 + attackBoost * 1.1 +
      serveBoost * 0.5 + digBoost * 0.4
    ),
    opposite: round1(
      skills.hitting * 1.8 + skills.blocking * 1.0 + skills.serving * 0.8 +
      skills.athleticism * 0.8 + attackBoost * 1.2 + blockBoost * 0.6 +
      reliabilityBoost * 0.4
    ),
    middle_blocker: round1(
      skills.blocking * 2.1 + skills.hitting * 1.1 + skills.athleticism * 1.1 +
      skills.coachability * 0.6 + blockBoost * 1.2 + attackBoost * 0.5
    ),
    defensive_specialist: round1(
      skills.defense * 1.9 + skills.passing * 1.5 + skills.serving * 1.0 +
      skills.coachability * 0.9 + digBoost * 1.0 + serveBoost * 0.5 +
      reliabilityBoost
    ),
  };
}

function buildPositionRecommendation(player) {
  const fitScores = scorePositionFit(player);
  const ranked = POSITION_KEYS
    .map(position => ({ position, score: fitScores[position] }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const gap = best.score - second.score;
  const overall = n(player.overall);
  const confidence = gap >= 4 && overall >= 7.5
    ? 'high'
    : gap >= 2 || overall >= 6.5
      ? 'medium'
      : 'low';
  const roleFocus = best.score >= 28 && overall >= 7
    ? 'Primary lineup candidate'
    : best.score >= 22
      ? 'Development rotation candidate'
      : 'Needs targeted development';
  const skills = topEvaluationSkills(player);
  const stats = statHighlights(player);

  return {
    player_id: player.id,
    player_name: player.name,
    current_position: player.position,
    recommended_position: best.position,
    recommended_position_label: POSITION_LABELS[best.position],
    secondary_position: second.position,
    secondary_position_label: POSITION_LABELS[second.position],
    fit_score: best.score,
    confidence,
    role_focus: roleFocus,
    overall,
    evaluation_scores: {
      serving: player.serving,
      passing: player.passing,
      setting: player.setting,
      hitting: player.hitting,
      blocking: player.blocking,
      defense: player.defense,
      athleticism: player.athleticism,
      coachability: player.coachability,
    },
    season_stats: {
      matches_played: n(player.matches_played),
      sets_played: n(player.sets_played),
      points: n(player.points),
      kills: n(player.kills),
      aces: n(player.aces),
      blocks: n(player.blocks),
      digs: n(player.digs),
      errors: n(player.errors),
    },
    fit_scores: fitScores,
    reasoning: [
      skills.length ? `Strongest evaluations: ${skills.join(', ')}.` : 'No detailed evaluation scores recorded yet.',
      stats.length ? `Season stats considered: ${stats.join(', ')}.` : 'No season match stats recorded yet, so this leans more heavily on coach evaluations.',
      `Recommended as ${POSITION_LABELS[best.position]} over ${POSITION_LABELS[second.position]} by ${round1(gap)} fit points.`,
    ].join(' '),
  };
}

async function generateOpenAIPositionRecommendations({ team, tryout, season, recommendations }) {
  if (!process.env.OPENAI_API_KEY) return null;

  const result = await callOpenAI({
    maxOutputTokens: Math.min(1600, 420 + recommendations.length * 180),
    instructions: [
      'You are the VolleyOps AI position analyst for a volleyball coach.',
      'Recommend positions inside the selected coach team only. Do not recommend or assign teams.',
      'Use every supplied coach evaluation dimension and every supplied match stat category.',
      'You may adjust the algorithmic recommendation only when the evidence clearly supports it.',
      'Do not invent stats, players, evaluations, or teams.',
      'Return JSON only with recommendations: [{ player_id, recommended_position, secondary_position, confidence, role_focus, reasoning }].',
      `Valid position keys: ${POSITION_KEYS.join(', ')}. Confidence must be high, medium, or low.`,
    ].join(' '),
    input: compactJson({
      team,
      tryout,
      season,
      position_labels: POSITION_LABELS,
      players: recommendations.map((rec) => ({
        player_id: rec.player_id,
        player_name: rec.player_name,
        current_position: rec.current_position,
        algorithmic_recommendation: rec.recommended_position,
        algorithmic_secondary: rec.secondary_position,
        algorithmic_fit_score: rec.fit_score,
        algorithmic_fit_scores: rec.fit_scores,
        overall_evaluation: rec.overall,
        evaluation_scores: rec.evaluation_scores,
        season_stats: rec.season_stats,
        fallback_reasoning: rec.reasoning,
      })),
    }),
  });

  if (!result) return null;

  const parsed = parseJsonObject(result.text);
  if (!parsed || !Array.isArray(parsed.recommendations)) return null;

  const aiByPlayerId = new Map(
    parsed.recommendations
      .filter(item => item && item.player_id != null)
      .map(item => [Number(item.player_id), item]),
  );

  return {
    model: result.model,
    recommendations: recommendations.map((base) => {
      const ai = aiByPlayerId.get(Number(base.player_id));
      if (!ai) return base;

      const recommended = POSITION_LABELS[ai.recommended_position]
        ? ai.recommended_position
        : base.recommended_position;
      const secondary = POSITION_LABELS[ai.secondary_position]
        ? ai.secondary_position
        : base.secondary_position;
      const confidence = ['high', 'medium', 'low'].includes(ai.confidence)
        ? ai.confidence
        : base.confidence;

      return {
        ...base,
        recommended_position: recommended,
        recommended_position_label: POSITION_LABELS[recommended],
        secondary_position: secondary,
        secondary_position_label: POSITION_LABELS[secondary],
        confidence,
        role_focus: typeof ai.role_focus === 'string' && ai.role_focus.trim()
          ? ai.role_focus.trim().slice(0, 120)
          : base.role_focus,
        reasoning: typeof ai.reasoning === 'string' && ai.reasoning.trim()
          ? ai.reasoning.trim().slice(0, 900)
          : base.reasoning,
      };
    }),
  };
}

function buildFallbackSuggestion({ prompt, formation, markers, matchContext, teamContext }) {
  const lowerPrompt = (prompt || '').toLowerCase();
  const ourMarkers = (markers || []).filter((marker) => marker.team === 'our');
  const oppMarkers = (markers || []).filter((marker) => marker.team === 'opp');
  const contextBits = [];

  if (matchContext?.rotation) contextBits.push(`Current rotation: ${matchContext.rotation}`);
  if (matchContext?.score) contextBits.push(`Score context: ${matchContext.score}`);
  if (matchContext?.serveReceive) contextBits.push(`Serve receive focus: ${matchContext.serveReceive}`);
  if (teamContext?.team) contextBits.push(`Team: ${teamContext.team.name}${teamContext.team.division ? ` (${teamContext.team.division})` : ''}`);
  if (teamContext?.standing) {
    contextBits.push(`Standings: ${teamContext.standing.wins}-${teamContext.standing.losses}, ${teamContext.standing.points} points`);
  }
  if (teamContext?.attendanceRate != null) contextBits.push(`Recent attendance rate: ${teamContext.attendanceRate}%`);
  if (teamContext?.topPlayers?.length) {
    contextBits.push(`Current leaders: ${teamContext.topPlayers.slice(0, 3).map(p => `${p.name} ${p.points} pts`).join(', ')}`);
  }

  const suggestions = [];

  if (lowerPrompt.includes('serve')) {
    const topServer = [...(teamContext?.topPlayers || [])].sort((a, b) => (b.aces || 0) - (a.aces || 0))[0];
    suggestions.push(topServer?.aces
      ? `Build the first serving run around ${topServer.name}; they currently lead your live stats in aces, so pair that with deep zone 1 pressure.`
      : 'Target deep zone 1 with a fast float serve to force the opponent setter off the net.');
  }

  if (lowerPrompt.includes('receive') || lowerPrompt.includes('serve-receive')) {
    suggestions.push('Use a three-player receive lane and release the setter early to keep your side-out tempo stable.');
  }

  if (lowerPrompt.includes('rotation')) {
    suggestions.push(`In ${formation || 'the current'} formation, keep the setter one step inside so the second-ball path stays shorter and cleaner.`);
  }

  if (lowerPrompt.includes('block') || lowerPrompt.includes('counter')) {
    const topBlocker = [...(teamContext?.topPlayers || [])].sort((a, b) => (b.blocks || 0) - (a.blocks || 0))[0];
    suggestions.push(topBlocker?.blocks
      ? `Anchor the block around ${topBlocker.name}; they lead your live block data, so shade help coverage behind their seam.`
      : 'Shift the middle blocker half a step toward zone 2 and pre-load the libero toward zone 6 for soft-block coverage.');
  }

  if (suggestions.length === 0) {
    suggestions.push('Tighten your right-side defensive spacing and start the libero slightly deeper in zone 6 to improve dig coverage.');
    suggestions.push('If the opponent is in-system, commit the middle only on visible quick tempo and prioritize sealing cross-court first.');
    if (teamContext?.attendanceRate != null && teamContext.attendanceRate < 75) {
      suggestions.push('Keep the tactical plan simple today because recent attendance is below 75%; prioritize two repeatable serve-receive calls over a larger package.');
    }
  }

  return {
    source: 'fallback',
    summary: `Analyzed ${ourMarkers.length} of your players and ${oppMarkers.length} opponent markers on a ${formation || 'custom'} board.`,
    suggestions,
    context: contextBits,
  };
}

async function generateOpenAITacticSuggestion(payload) {
  if (!process.env.OPENAI_API_KEY) return null;

  const teamContext = payload.teamContext
    ? {
        team: payload.teamContext.team,
        standing: payload.teamContext.standing,
        attendanceRate: payload.teamContext.attendanceRate,
        topPlayers: payload.teamContext.topPlayers,
        recentMatches: payload.teamContext.recentMatches,
      }
    : null;

  const result = await callOpenAI({
    maxOutputTokens: 650,
    instructions: [
      'You are the VolleyOps volleyball tactics assistant for club coaches.',
      'Use only the supplied live dashboard, analytics, match, attendance, and board-state data.',
      'Give concrete volleyball advice for rotations, serve-receive, blocking, defensive coverage, and counter-tactics.',
      'If data is missing, say what is missing instead of inventing it.',
      'Avoid generic motivational language.',
      'Return JSON only with: summary string, suggestions array of 3-5 strings, context array of short strings.',
    ].join(' '),
    input: [
      `Coach prompt: ${payload.prompt}`,
      'Live team/dashboard context:',
      compactJson(teamContext),
      'Current tactics board state:',
      compactJson({
        formation: payload.formation,
        markers: payload.markers,
        arrows: payload.arrows,
        zones: payload.zones,
        matchContext: payload.matchContext,
      }),
    ].join('\n\n'),
  });

  if (!result) return null;

  const parsed = parseJsonObject(result.text);
  if (parsed && Array.isArray(parsed.suggestions)) {
    return {
      source: 'openai',
      model: result.model,
      summary: parsed.summary || 'Generated with OpenAI using the latest VolleyOps data.',
      suggestions: parsed.suggestions.filter(Boolean).slice(0, 5),
      context: Array.isArray(parsed.context) ? parsed.context.filter(Boolean).slice(0, 6) : [],
    };
  }

  return {
    source: 'openai',
    model: result.model,
    summary: 'Generated with OpenAI using the latest VolleyOps data.',
    suggestions: [result.text],
    context: [],
  };
}

router.post('/suggest', [
  body('prompt').trim().notEmpty(),
  body('boardId').optional({ nullable: true }).isInt({ min: 1 }),
  body('markers').optional().isArray(),
  body('arrows').optional().isArray(),
  body('zones').optional().isArray(),
  body('formation').optional().isString(),
  body('matchContext').optional().isObject(),
], async (req, res) => {
  if (validationErrors(req, res)) return;

  let boardId = req.body.boardId ? Number(req.body.boardId) : null;
  let teamIdForContext = req.body.matchContext?.team_id ? Number(req.body.matchContext.team_id) : null;
  let boardState = {
    markers: req.body.markers || [],
    arrows: req.body.arrows || [],
    zones: req.body.zones || [],
    formation: req.body.formation || '6-2',
    matchContext: req.body.matchContext || {},
  };

  if (boardId) {
    const board = db.prepare(`
      SELECT
        tb.*,
        t.coach_id,
        t.assistant_coach_id
      FROM tactics_boards tb
      LEFT JOIN teams t ON t.id = tb.team_id
      WHERE tb.id = ?
    `).get(boardId);

    if (!board) return res.status(404).json({ error: 'Board not found' });
    const canAccess = req.user.role === 'admin'
      || board.created_by === req.user.id
      || board.coach_id === req.user.id
      || board.assistant_coach_id === req.user.id;

    if (!canAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    boardState = {
      markers: JSON.parse(board.markers || '[]'),
      arrows: JSON.parse(board.arrows || '[]'),
      zones: JSON.parse(board.zones || '[]'),
      formation: board.formation,
      matchContext: JSON.parse(board.match_context || '{}'),
    };
    teamIdForContext = board.team_id || boardState.matchContext?.team_id || teamIdForContext;
  }

  const teamContext = loadTeamContext(teamIdForContext);

  let suggestion;
  try {
    suggestion = await generateOpenAITacticSuggestion({
      prompt: req.body.prompt,
      ...boardState,
      teamContext,
    });
  } catch (error) {
    suggestion = null;
  }

  if (!suggestion) {
    suggestion = buildFallbackSuggestion({
      prompt: req.body.prompt,
      ...boardState,
      teamContext,
    });
  }

  const responseText = [suggestion.summary, ...suggestion.suggestions].join('\n\n');
  const historyResult = db.prepare(`
    INSERT INTO ai_suggestions (board_id, user_id, prompt, response, board_state)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    boardId,
    req.user.id,
    req.body.prompt,
    responseText,
    JSON.stringify({ ...boardState, teamContext }),
  );

  res.json({
    suggestionId: historyResult.lastInsertRowid,
    ...suggestion,
  });
});

// ─── POST /api/ai/team-placement ──────────────────────────────────────────────
// POST /api/ai/position-recommendations
// Suggest each evaluated player's best position inside a selected coach team.
router.post('/position-recommendations', [
  body('team_id').isInt({ min: 1 }),
  body('tryout_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('season').optional().trim(),
], async (req, res) => {
  if (validationErrors(req, res)) return;

  const teamId = Number(req.body.team_id);
  const allowed = accessibleTeamIds(req.user);
  if (!allowed.includes(teamId)) return res.status(403).json({ error: 'Access denied to that team' });

  const team = db.prepare(`SELECT id, name, season FROM teams WHERE id = ?`).get(teamId);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const tryout = req.body.tryout_id
    ? db.prepare(`SELECT id, name, season FROM tryouts WHERE id = ?`).get(Number(req.body.tryout_id))
    : null;
  if (req.body.tryout_id && !tryout) return res.status(404).json({ error: 'Tryout not found' });

  const season = req.body.season || tryout?.season || team.season || '2024-2025';
  const params = [season];
  let evalFilter = '';
  if (tryout) {
    evalFilter = 'AND e.tryout_id = ?';
    params.push(tryout.id);
  }

  const players = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.position,
      p.jersey_number,
      AVG(e.serving) AS serving,
      AVG(e.passing) AS passing,
      AVG(e.setting) AS setting,
      AVG(e.hitting) AS hitting,
      AVG(e.blocking) AS blocking,
      AVG(e.defense) AS defense,
      AVG(e.athleticism) AS athleticism,
      AVG(e.coachability) AS coachability,
      ROUND(
        (
          COALESCE(AVG(e.serving), 0) + COALESCE(AVG(e.passing), 0) +
          COALESCE(AVG(e.setting), 0) + COALESCE(AVG(e.hitting), 0) +
          COALESCE(AVG(e.blocking), 0) + COALESCE(AVG(e.defense), 0) +
          COALESCE(AVG(e.athleticism), 0) + COALESCE(AVG(e.coachability), 0)
        ) / 8.0,
        1
      ) AS overall,
      COUNT(e.id) AS evaluation_count,
      COALESCE(ps.matches_played, 0) AS matches_played,
      COALESCE(ps.sets_played, 0) AS sets_played,
      COALESCE(ps.points, 0) AS points,
      COALESCE(ps.kills, 0) AS kills,
      COALESCE(ps.aces, 0) AS aces,
      COALESCE(ps.blocks, 0) AS blocks,
      COALESCE(ps.digs, 0) AS digs,
      COALESCE(ps.errors, 0) AS errors
    FROM player_evaluations e
    JOIN players p ON p.id = e.player_id
    LEFT JOIN player_stats ps ON ps.player_id = p.id AND ps.season = ?
    WHERE 1=1 ${evalFilter}
    GROUP BY p.id
    ORDER BY overall DESC, points DESC
  `).all(...params);

  if (!players.length) {
    return res.status(400).json({ error: 'No evaluated players found. Add coach evaluations first.' });
  }

  const baseRecommendations = players.map(buildPositionRecommendation);
  let source = 'fallback';
  let model = null;
  let recommendations = baseRecommendations;

  try {
    const aiResult = await generateOpenAIPositionRecommendations({
      team,
      tryout,
      season,
      recommendations: baseRecommendations,
    });

    if (aiResult?.recommendations?.length) {
      source = 'openai';
      model = aiResult.model;
      recommendations = aiResult.recommendations;
    }
  } catch (error) {
    console.error('OpenAI position recommendation error:', error.message);
  }

  res.json({
    source,
    model,
    team,
    tryout,
    season,
    recommendations,
  });
});

// Given a list of evaluated players + available teams, suggest assignments.
// Body: { tryout_id?, player_ids?, team_ids? }
// Returns: { placements: [{ player_id, player_name, suggested_team_id, suggested_team_name, reasoning, confidence }], source }
router.post('/team-placement', authenticate, requireRole('admin', 'coach'), [
  body('tryout_id').optional({ nullable: true }).isInt({ min: 1 }),
  body('player_ids').optional().isArray(),
  body('team_ids').optional().isArray(),
], async (req, res) => {
  return res.status(410).json({
    error: 'Team placement AI has been retired. Use /api/ai/position-recommendations to recommend positions inside a coach team.',
  });

  if (validationErrors(req, res)) return;

  const { tryout_id, player_ids, team_ids } = req.body;

  // Load players with their evaluation averages
  let playerFilter = '';
  const pParams = [];
  if (tryout_id) {
    playerFilter = `AND e.tryout_id = ?`;
    pParams.push(Number(tryout_id));
  }
  if (player_ids && player_ids.length) {
    playerFilter += ` AND e.player_id IN (${player_ids.map(() => '?').join(',')})`;
    pParams.push(...player_ids.map(Number));
  }

  const players = db.prepare(`
    SELECT p.id, p.name, p.position,
           ROUND(AVG(e.serving),1)      AS serving,
           ROUND(AVG(e.passing),1)      AS passing,
           ROUND(AVG(e.setting),1)      AS setting,
           ROUND(AVG(e.hitting),1)      AS hitting,
           ROUND(AVG(e.blocking),1)     AS blocking,
           ROUND(AVG(e.defense),1)      AS defense,
           ROUND(AVG(e.athleticism),1)  AS athleticism,
           ROUND(AVG(e.coachability),1) AS coachability,
           ROUND(
             (COALESCE(AVG(e.serving),0)+COALESCE(AVG(e.passing),0)+COALESCE(AVG(e.setting),0)+
              COALESCE(AVG(e.hitting),0)+COALESCE(AVG(e.blocking),0)+COALESCE(AVG(e.defense),0)+
              COALESCE(AVG(e.athleticism),0)+COALESCE(AVG(e.coachability),0)) / 8.0, 1
           ) AS overall
    FROM player_evaluations e
    JOIN players p ON p.id = e.player_id
    WHERE 1=1 ${playerFilter}
    GROUP BY e.player_id
    ORDER BY overall DESC
  `).all(...pParams);

  if (!players.length) {
    return res.status(400).json({ error: 'No evaluated players found. Run evaluations first.' });
  }

  // Load available teams
  let teams;
  if (team_ids && team_ids.length) {
    const placeholders = team_ids.map(() => '?').join(',');
    teams = db.prepare(`SELECT id, name, division, max_players FROM teams WHERE id IN (${placeholders})`).all(...team_ids.map(Number));
  } else {
    teams = db.prepare(`SELECT id, name, division, max_players FROM teams`).all();
  }

  if (!teams.length) {
    return res.status(400).json({ error: 'No teams available for placement.' });
  }

  // Try AI placement
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const prompt = [
        `You are a volleyball team placement assistant. Based on the following player evaluations and available teams, suggest the best team placement for each player.`,
        ``,
        `Players (with skill scores 1-10, null means not evaluated):`,
        ...players.map(p =>
          `- ${p.name} (${p.position || 'unspecified'}, overall: ${p.overall}): ` +
          `serving=${p.serving}, passing=${p.passing}, setting=${p.setting}, hitting=${p.hitting}, ` +
          `blocking=${p.blocking}, defense=${p.defense}, athleticism=${p.athleticism}, coachability=${p.coachability}`
        ),
        ``,
        `Available teams:`,
        ...teams.map(t => `- Team ID ${t.id}: "${t.name}" (${t.division || 'no division'}, max ${t.max_players} players)`),
        ``,
        `Return a JSON array ONLY — no markdown, no prose — like:`,
        `[{"player_id":1,"suggested_team_id":2,"reasoning":"...","confidence":"high|medium|low"}]`,
        `Assign every player to exactly one team. Balance team sizes and skill levels where possible.`,
      ].join('\n');

      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      let parsed;
      try {
        // Strip any accidental markdown fences
        const clean = text.replace(/^```[a-z]*\n?/i, '').replace(/```$/,'').trim();
        parsed = JSON.parse(clean);
      } catch {
        parsed = null;
      }

      if (Array.isArray(parsed)) {
        const teamMap = Object.fromEntries(teams.map(t => [t.id, t.name]));
        const placements = parsed.map(item => ({
          ...item,
          suggested_team_name: teamMap[item.suggested_team_id] || null,
          player_name: players.find(p => p.id === item.player_id)?.name || null,
        }));
        return res.json({ placements, source: 'anthropic' });
      }
    } catch (err) {
      console.error('AI team placement error:', err.message);
    }
  }

  // Fallback: round-robin by overall score descending
  const sorted = [...players].sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const placements = sorted.map((p, i) => {
    const team = teams[i % teams.length];
    return {
      player_id: p.id,
      player_name: p.name,
      suggested_team_id: team.id,
      suggested_team_name: team.name,
      reasoning: `Assigned by skill score ranking (overall: ${p.overall ?? 'N/A'}).`,
      confidence: 'medium',
    };
  });

  res.json({ placements, source: 'fallback' });
});

module.exports = router;

