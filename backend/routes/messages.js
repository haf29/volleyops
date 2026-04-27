const express = require('express');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function isConversationMember(conversationId, userId) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
  `).get(conversationId, userId));
}

function getConversationMembers(conversationId) {
  return db.prepare(`
    SELECT u.id, u.name, u.email
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    WHERE cm.conversation_id = ?
    ORDER BY u.name ASC
  `).all(conversationId);
}

function notifyRecipients(io, recipientIds, title, body, relatedId) {
  for (const userId of recipientIds) {
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
      VALUES (?, 'message', ?, ?, 'conversation', ?)
    `).run(userId, title, body, relatedId);

    io.to(`user:${userId}`).emit('notification', {
      type: 'message',
      title,
      body,
      relatedType: 'conversation',
      relatedId,
    });
  }
}

function canManageTeamConversation(user, team) {
  if (user.role === 'admin') return true;
  if (user.role === 'coach') return team.coach_id === user.id;
  if (user.role === 'assistant_coach') return team.assistant_coach_id === user.id;
  return false;
}

router.get('/conversations', (req, res) => {
  const conversations = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.type,
      c.team_id,
      c.created_at,
      COALESCE(
        c.name,
        t.name,
        CASE WHEN c.type = 'direct' THEN (
          SELECT u2.name
          FROM conversation_members cm2
          JOIN users u2 ON u2.id = cm2.user_id
          WHERE cm2.conversation_id = c.id AND cm2.user_id != ?
          LIMIT 1
        ) END
      ) AS display_name,
      (
        SELECT m.content
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message,
      (
        SELECT m.created_at
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message_at,
      (
        SELECT COUNT(*)
        FROM messages m
        LEFT JOIN message_reads mr
          ON mr.message_id = m.id
         AND mr.user_id = ?
        WHERE m.conversation_id = c.id
          AND m.sender_id != ?
          AND mr.id IS NULL
      ) AS unread_count
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    LEFT JOIN teams t ON t.id = c.team_id
    WHERE cm.user_id = ?
    ORDER BY COALESCE(last_message_at, c.created_at) DESC
  `).all(req.user.id, req.user.id, req.user.id, req.user.id);

  res.json({ conversations });
});

// Search users for new conversations.
// mode=direct → who you can DM
// mode=group  → who you can add to a group (team-scope only)
router.get('/users/search', (req, res) => {
  const { q = '', mode = 'direct' } = req.query;
  const search = `%${q}%`;
  const { id: userId, role } = req.user;

  // Admin reaches everyone in both modes
  if (role === 'admin') {
    const users = db.prepare(`
      SELECT id, name, email, role FROM users
      WHERE id != ? AND (name LIKE ? OR email LIKE ?)
      ORDER BY name ASC LIMIT 20
    `).all(userId, search, search);
    return res.json({ users });
  }

  // Roster player subquery for a placeholder list of team ids
  function rosterSub(ph) {
    return `SELECT p2.user_id FROM players p2
            JOIN team_players tp2 ON tp2.player_id = p2.id
            WHERE tp2.team_id IN (${ph}) AND tp2.is_active = 1 AND p2.user_id IS NOT NULL`;
  }

  if (role === 'coach' || role === 'assistant_coach') {
    const col = role === 'coach' ? 'coach_id' : 'assistant_coach_id';
    const teamIds = db.prepare(`SELECT id FROM teams WHERE ${col} = ?`).all(userId).map(r => r.id);
    const ph = teamIds.length ? teamIds.map(() => '?').join(',') : 'NULL';

    let sql, params;

    if (mode === 'group') {
      // Groups: team scope only — own roster players + the other staff on each team
      if (!teamIds.length) return res.json({ users: [] });
      const otherStaff = role === 'coach' ? 'assistant_coach_id' : 'coach_id';
      sql = `
        SELECT DISTINCT u.id, u.name, u.email, u.role
        FROM users u
        WHERE u.id != ? AND (u.name LIKE ? OR u.email LIKE ?)
          AND u.id IN (
            ${rosterSub(ph)}
            UNION
            SELECT ${otherStaff} FROM teams WHERE id IN (${ph}) AND ${otherStaff} IS NOT NULL
          )
        ORDER BY u.name ASC LIMIT 20`;
      params = [userId, search, search, ...teamIds, ...teamIds];
    } else {
      // Direct: admin + ALL coaches + ALL assistant coaches + own team players only
      sql = `
        SELECT DISTINCT u.id, u.name, u.email, u.role
        FROM users u
        WHERE u.id != ? AND (u.name LIKE ? OR u.email LIKE ?)
          AND (
            u.role IN ('admin', 'coach', 'assistant_coach')
            ${teamIds.length ? `OR u.id IN (${rosterSub(ph)})` : ''}
          )
        ORDER BY u.name ASC LIMIT 20`;
      params = [userId, search, search, ...teamIds];
    }

    return res.json({ users: db.prepare(sql).all(...params) });
  }

  if (role === 'player') {
    const player = db.prepare(`SELECT id FROM players WHERE user_id = ?`).get(userId);
    if (!player) return res.json({ users: [] });
    const teamIds = db.prepare(
      `SELECT team_id FROM team_players WHERE player_id = ? AND is_active = 1`
    ).all(player.id).map(r => r.team_id);
    if (!teamIds.length) return res.json({ users: [] });
    const ph = teamIds.map(() => '?').join(',');

    // Both direct and group: teammates only (no admin, no staff)
    const users = db.prepare(`
      SELECT DISTINCT u.id, u.name, u.email, u.role
      FROM users u
      WHERE u.id != ? AND (u.name LIKE ? OR u.email LIKE ?)
        AND u.id IN (${rosterSub(ph)})
      ORDER BY u.name ASC LIMIT 20
    `).all(userId, search, search, ...teamIds);
    return res.json({ users });
  }

  res.json({ users: [] });
});

router.post('/conversations', [
  body('type').isIn(['direct', 'group', 'team', 'broadcast']),
  body('name').optional({ nullable: true }).trim(),
  body('teamId').optional({ nullable: true }).isInt({ min: 1 }),
  body('memberIds').optional().isArray(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { type, name = null, teamId = null } = req.body;
  let memberIds = Array.isArray(req.body.memberIds) ? req.body.memberIds.map(Number) : [];

  // Deduplicate: if a direct conversation already exists between the two users, return it
  if (type === 'direct' && memberIds.length === 1) {
    const otherId = memberIds[0];
    const existing = db.prepare(`
      SELECT c.id FROM conversations c
      JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
      JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
      WHERE c.type = 'direct'
      LIMIT 1
    `).get(req.user.id, otherId);
    if (existing) {
      return res.status(200).json({
        conversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(existing.id),
        members: getConversationMembers(existing.id),
        existing: true,
      });
    }
  }

  if (type === 'broadcast' && !['admin', 'coach'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only admins and coaches can create broadcasts' });
  }

  if (type === 'team') {
    if (!teamId) return res.status(400).json({ error: 'teamId is required for team conversations' });
    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(Number(teamId));
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (!canManageTeamConversation(req.user, team)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const rosterUsers = db.prepare(`
      SELECT p.user_id
      FROM team_players tp
      JOIN players p ON p.id = tp.player_id
      WHERE tp.team_id = ? AND tp.is_active = 1 AND p.user_id IS NOT NULL
    `).all(Number(teamId)).map((row) => row.user_id);

    memberIds = [
      ...rosterUsers,
      team.coach_id,
      team.assistant_coach_id,
    ].filter(Boolean);
  }

  memberIds = [...new Set([req.user.id, ...memberIds])];
  if (memberIds.length < 2) {
    return res.status(400).json({ error: 'A conversation requires at least two members' });
  }

  const createConversation = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO conversations (name, type, team_id, created_by)
      VALUES (?, ?, ?, ?)
    `).run(name, type, teamId, req.user.id);

    const conversationId = result.lastInsertRowid;
    const insertMember = db.prepare(`
      INSERT INTO conversation_members (conversation_id, user_id)
      VALUES (?, ?)
    `);

    for (const memberId of memberIds) {
      insertMember.run(conversationId, memberId);
    }

    return conversationId;
  });

  const conversationId = createConversation();
  res.status(201).json({
    conversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId),
    members: getConversationMembers(conversationId),
  });
});

router.get('/conversations/:id/messages', (req, res) => {
  const conversationId = Number(req.params.id);
  if (!isConversationMember(conversationId, req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const messages = db.prepare(`
    SELECT
      m.*,
      u.name AS sender_name,
      u.role AS sender_role
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC
  `).all(conversationId);

  res.json({
    conversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId),
    members: getConversationMembers(conversationId),
    messages,
  });
});

router.post('/conversations/:id/messages', [
  body('content').trim().notEmpty(),
  body('attachment_name').optional({ nullable: true }).trim(),
  body('attachment_url').optional({ nullable: true }).trim(),
  body('is_announcement').optional().isBoolean(),
  body('send_email').optional().isBoolean(),
], async (req, res) => {
  if (validationErrors(req, res)) return;

  const conversationId = Number(req.params.id);
  if (!isConversationMember(conversationId, req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const {
    content,
    attachment_name = null,
    attachment_url = null,
    is_announcement = false,
    send_email = false,
  } = req.body;

  const result = db.prepare(`
    INSERT INTO messages (
      conversation_id, sender_id, content, attachment_name, attachment_url, is_announcement
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    conversationId,
    req.user.id,
    content,
    attachment_name,
    attachment_url,
    is_announcement ? 1 : 0,
  );

  const message = db.prepare(`
    SELECT m.*, u.name AS sender_name, u.role AS sender_role
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  db.prepare(`
    INSERT OR IGNORE INTO message_reads (message_id, user_id)
    VALUES (?, ?)
  `).run(message.id, req.user.id);

  const members = getConversationMembers(conversationId);
  const recipientIds = members
    .filter((member) => member.id !== req.user.id)
    .map((member) => member.id);

  const io = req.app.get('io');
  io.to(`conv:${conversationId}`).emit('message_created', message);
  notifyRecipients(
    io,
    recipientIds,
    `New message from ${req.user.name}`,
    content.slice(0, 140),
    conversationId,
  );

  let emailSent = false;
  if (send_email) {
    const transporter = getTransporter();
    const recipients = members
      .filter((member) => member.id !== req.user.id && member.email)
      .map((member) => member.email);

    if (transporter && recipients.length > 0) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.SMTP_USER,
          to: recipients.join(','),
          subject: `VolleyOps message from ${req.user.name}`,
          text: content,
          html: `<p>${content}</p>`,
        });
        emailSent = true;
      } catch (error) {
        emailSent = false;
      }
    }
  }

  res.status(201).json({ message, emailSent });
});

router.post('/conversations/:id/read', (req, res) => {
  const conversationId = Number(req.params.id);
  if (!isConversationMember(conversationId, req.user.id)) {
    return res.status(403).json({ error: 'Access denied' });
  }

  db.prepare(`
    INSERT OR IGNORE INTO message_reads (message_id, user_id)
    SELECT m.id, ?
    FROM messages m
    WHERE m.conversation_id = ?
  `).run(req.user.id, conversationId);

  res.json({ message: 'Conversation marked as read' });
});

module.exports = router;
