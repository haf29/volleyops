const express = require('express');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

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

function notifyUser(io, userId, title, body, relatedType, relatedId) {
  if (!io || !userId) return;
  db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
    VALUES (?, 'payment', ?, ?, ?, ?)
  `).run(userId, title, body, relatedType ?? null, relatedId ?? null);

  io.to(`user:${userId}`).emit('notification', {
    type: 'payment',
    title,
    body,
    relatedType,
    relatedId,
  });
}

function buildPaymentScope(user, params) {
  // Coaches, assistant coaches, and players all see only their own payments.
  // Only admins see all payments.
  if (user.role !== 'admin') {
    params.push(user.id);
    return ` AND p.user_id = ?`;
  }
  return '';
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

function getPlayerForUser(userId) {
  return db.prepare(`SELECT * FROM players WHERE user_id = ?`).get(userId);
}

function getOrCreateBillingPlayerForUser(userId) {
  const existing = getPlayerForUser(userId);
  if (existing) return existing;

  const user = db.prepare(`SELECT id, name, email FROM users WHERE id = ?`).get(userId);
  if (!user) return null;

  const result = db.prepare(`
    INSERT INTO players (user_id, name, email, registration_status, notes)
    VALUES (?, ?, ?, 'approved', 'Billing profile for wallet purchases')
  `).run(user.id, user.name, user.email);

  return db.prepare(`SELECT * FROM players WHERE id = ?`).get(result.lastInsertRowid);
}

function getWalletSummary(userId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'deposit' AND status = 'pending' THEN amount ELSE 0 END), 0) AS pending_deposits,
      COALESCE(SUM(CASE WHEN type = 'deposit' AND status = 'approved' THEN amount ELSE 0 END), 0) AS approved_deposits,
      COALESCE(SUM(CASE WHEN type = 'payment' AND status = 'applied' THEN -amount ELSE 0 END), 0) AS spent_amount,
      COALESCE(SUM(CASE WHEN status IN ('approved', 'applied') THEN amount ELSE 0 END), 0) AS balance
    FROM wallet_transactions
    WHERE user_id = ?
  `).get(userId);

  return {
    pending_deposits: Number(row.pending_deposits || 0).toFixed(2) * 1,
    approved_deposits: Number(row.approved_deposits || 0).toFixed(2) * 1,
    spent_amount: Number(row.spent_amount || 0).toFixed(2) * 1,
    balance: Number(row.balance || 0).toFixed(2) * 1,
  };
}

function createInstallmentPayments(player, plan, { firstDueDate, description }) {
  const baseDate = firstDueDate ? new Date(firstDueDate) : new Date();
  const installmentCount = Number(plan.installment_count);
  const rawInstallment = Number(plan.total_amount) / installmentCount;
  const payments = [];
  let amountAllocated = 0;

  for (let installmentNumber = 1; installmentNumber <= installmentCount; installmentNumber += 1) {
    let amount = Number(rawInstallment.toFixed(2));
    if (installmentNumber === installmentCount) {
      amount = Number((Number(plan.total_amount) - amountAllocated).toFixed(2));
    }
    amountAllocated += amount;

    const dueDate = new Date(baseDate);
    dueDate.setDate(dueDate.getDate() + ((installmentNumber - 1) * Number(plan.interval_days)));

    const result = db.prepare(`
      INSERT INTO payments (
        player_id, plan_id, amount, description, due_date, status, installment_number
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      player.id,
      plan.id,
      amount,
      description || `${plan.name} installment ${installmentNumber}/${installmentCount}`,
      dueDate.toISOString(),
      installmentNumber,
    );

    payments.push(db.prepare(`SELECT * FROM payments WHERE id = ?`).get(result.lastInsertRowid));
  }

  return payments;
}

function ensurePlanPayments(player, plan, options = {}) {
  const existing = db.prepare(`
    SELECT *
    FROM payments
    WHERE player_id = ? AND plan_id = ?
    ORDER BY installment_number ASC, created_at ASC
  `).all(player.id, plan.id);

  if (existing.length) {
    return { created: false, payments: existing };
  }

  return {
    created: true,
    payments: createInstallmentPayments(player, plan, options),
  };
}

function applyWalletToOutstandingPayments(userId, playerId, planId = null) {
  let available = getWalletSummary(userId).balance;
  if (available <= 0) return [];

  const outstandingSql = `
    SELECT *
    FROM payments
    WHERE player_id = ?
      AND status IN ('pending', 'overdue')
      ${planId ? 'AND plan_id = ?' : ''}
    ORDER BY
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      created_at ASC
  `;
  const outstanding = db.prepare(outstandingSql).all(...[playerId, ...(planId ? [planId] : [])]);

  const applied = [];
  for (const payment of outstanding) {
    const amount = Number(payment.amount || 0);
    if ((available + 0.0001) < amount) continue;

    db.prepare(`
      UPDATE payments
      SET status = 'paid', paid_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(new Date().toISOString(), payment.id);

    db.prepare(`
      INSERT INTO wallet_transactions (
        user_id, player_id, payment_id, plan_id, type, status, amount, note, updated_at
      ) VALUES (?, ?, ?, ?, 'payment', 'applied', ?, ?, datetime('now'))
    `).run(
      userId,
      playerId,
      payment.id,
      payment.plan_id ?? null,
      Number((-amount).toFixed(2)),
      `Applied wallet funds to payment #${payment.id}`,
    );

    available = Number((available - amount).toFixed(2));
    applied.push({ ...payment, amount });
  }

  return applied;
}

router.get('/plans', (req, res) => {
  const { active } = req.query;
  let sql = `SELECT * FROM payment_plans WHERE 1 = 1`;
  const params = [];

  if (active != null) {
    sql += ` AND is_active = ?`;
    params.push(active === 'true' ? 1 : 0);
  }

  sql += ` ORDER BY total_amount ASC, name ASC`;
  res.json({ plans: db.prepare(sql).all(...params) });
});

router.post('/plans', requireRole('admin'), [
  body('name').trim().notEmpty(),
  body('description').optional({ nullable: true }).trim(),
  body('total_amount').isFloat({ gt: 0 }),
  body('installment_count').optional().isInt({ min: 1, max: 24 }),
  body('interval_days').optional().isInt({ min: 1, max: 365 }),
  body('is_active').optional().isBoolean(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const {
    name,
    description = null,
    total_amount,
    installment_count = 1,
    interval_days = 30,
    is_active = true,
  } = req.body;

  const result = db.prepare(`
    INSERT INTO payment_plans (name, description, total_amount, installment_count, interval_days, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, description, total_amount, installment_count, interval_days, is_active ? 1 : 0);

  res.status(201).json(db.prepare(`SELECT * FROM payment_plans WHERE id = ?`).get(result.lastInsertRowid));
});

router.post('/assign-plan', requireRole('admin'), [
  body('playerId').isInt({ min: 1 }),
  body('planId').isInt({ min: 1 }),
  body('firstDueDate').optional().isISO8601(),
  body('description').optional({ nullable: true }).trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const { playerId, planId, firstDueDate, description = null } = req.body;
  const player = db.prepare(`SELECT * FROM players WHERE id = ?`).get(Number(playerId));
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const plan = db.prepare(`SELECT * FROM payment_plans WHERE id = ? AND is_active = 1`).get(Number(planId));
  if (!plan) return res.status(404).json({ error: 'Payment plan not found' });

  const assignPlan = db.transaction(() =>
    ensurePlanPayments(player, plan, {
      firstDueDate,
      description,
    }).payments
  );

  const payments = assignPlan();
  notifyUser(
    req.app.get('io'),
    player.user_id,
    'Payment Plan Assigned',
    `${plan.name} has been assigned to your account.`,
    'player',
    player.id,
  );

  res.status(201).json({ player, plan, payments });
});

router.get('/', (req, res) => {
  const {
    status,
    player_id,
    team_id,
    overdue_only,
    page = 1,
    limit = 50,
  } = req.query;

  const offset = (Number(page) - 1) * Number(limit);
  let sql = `
    SELECT
      pay.*,
      p.name AS player_name,
      p.email AS player_email,
      p.user_id AS player_user_id,
      t.id AS team_id,
      t.name AS team_name,
      plan.name AS plan_name
    FROM payments pay
    JOIN players p ON p.id = pay.player_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    LEFT JOIN teams t ON t.id = tp.team_id
    LEFT JOIN payment_plans plan ON plan.id = pay.plan_id
    WHERE 1 = 1
  `;
  const params = [];

  sql += buildPaymentScope(req.user, params);

  if (status) {
    sql += ` AND pay.status = ?`;
    params.push(status);
  }

  if (player_id) {
    sql += ` AND pay.player_id = ?`;
    params.push(Number(player_id));
  }

  if (team_id) {
    sql += ` AND t.id = ?`;
    params.push(Number(team_id));
  }

  if (overdue_only === 'true') {
    sql += ` AND (pay.status = 'overdue' OR (pay.status = 'pending' AND pay.due_date IS NOT NULL AND pay.due_date < datetime('now')))`;
  }

  const total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
  sql += ` ORDER BY pay.due_date ASC, pay.created_at DESC LIMIT ? OFFSET ?`;
  params.push(Number(limit), offset);

  const payments = db.prepare(sql).all(...params).map((payment) => ({
    ...payment,
    overdue:
      payment.status === 'overdue' ||
      (payment.status === 'pending' && payment.due_date && new Date(payment.due_date) < new Date()),
  }));

  res.json({
    payments,
    total,
    page: Number(page),
    limit: Number(limit),
  });
});

router.get('/summary', (req, res) => {
  let sql = `
    SELECT pay.*
    FROM payments pay
    JOIN players p ON p.id = pay.player_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    LEFT JOIN teams t ON t.id = tp.team_id
    WHERE 1 = 1
  `;
  const params = [];
  sql += buildPaymentScope(req.user, params);

  const payments = db.prepare(sql).all(...params);
  const summary = payments.reduce((acc, payment) => {
    acc.total_amount += Number(payment.amount || 0);
    if (payment.status === 'paid') acc.paid_amount += Number(payment.amount || 0);
    if (payment.status === 'pending') acc.pending_amount += Number(payment.amount || 0);
    if (payment.status === 'overdue') acc.overdue_amount += Number(payment.amount || 0);
    acc.status_counts[payment.status] = (acc.status_counts[payment.status] || 0) + 1;
    return acc;
  }, {
    total_amount: 0,
    paid_amount: 0,
    pending_amount: 0,
    overdue_amount: 0,
    status_counts: {},
  });

  summary.completion_rate = summary.total_amount
    ? Number(((summary.paid_amount / summary.total_amount) * 100).toFixed(1))
    : 0;

  res.json(summary);
});

router.get('/wallet', (req, res) => {
  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Wallet is only available for non-admin users' });
  }

  const player = getPlayerForUser(req.user.id);
  const summary = getWalletSummary(req.user.id);
  const transactions = db.prepare(`
    SELECT
      wt.*,
      plan.name AS plan_name,
      pay.description AS payment_description
    FROM wallet_transactions wt
    LEFT JOIN payment_plans plan ON plan.id = wt.plan_id
    LEFT JOIN payments pay ON pay.id = wt.payment_id
    WHERE wt.user_id = ?
    ORDER BY wt.created_at DESC, wt.id DESC
    LIMIT 10
  `).all(req.user.id);

  res.json({
    ...summary,
    can_request_purchase: true,
    player_id: player?.id ?? null,
    transactions,
  });
});

router.post('/wallet/top-up', [
  body('amount').isFloat({ gt: 0 }),
  body('note').optional({ nullable: true }).trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admins cannot top up a wallet here' });
  }

  const player = getPlayerForUser(req.user.id);
  const amount = Number(Number(req.body.amount).toFixed(2));
  const note = req.body.note || 'Wallet top-up';

  const result = db.prepare(`
    INSERT INTO wallet_transactions (
      user_id, player_id, type, status, amount, note, reviewed_at, updated_at
    ) VALUES (?, ?, 'deposit', 'approved', ?, ?, ?, datetime('now'))
  `).run(
    req.user.id,
    player?.id ?? null,
    amount,
    note,
    new Date().toISOString(),
  );

  const transaction = db.prepare(`
    SELECT *
    FROM wallet_transactions
    WHERE id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({
    transaction,
    wallet: getWalletSummary(req.user.id),
  });
});

router.post('/wallet/purchase-plan', [
  body('planId').isInt({ min: 1 }),
  body('firstDueDate').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admins cannot purchase plans from a wallet' });
  }

  const player = getOrCreateBillingPlayerForUser(req.user.id);
  if (!player) {
    return res.status(400).json({ error: 'Could not create a billing profile for this account' });
  }

  const plan = db.prepare(`SELECT * FROM payment_plans WHERE id = ? AND is_active = 1`).get(Number(req.body.planId));
  if (!plan) return res.status(404).json({ error: 'Payment plan not found' });

  const walletBefore = getWalletSummary(req.user.id);
  if (walletBefore.balance <= 0) {
    return res.status(400).json({ error: 'Add funds to your wallet before purchasing a plan' });
  }

  const purchasePlan = db.transaction(() => {
    const ensured = ensurePlanPayments(player, plan, {
      firstDueDate: req.body.firstDueDate,
      description: null,
    });
    const appliedPayments = applyWalletToOutstandingPayments(req.user.id, player.id, plan.id);
    return {
      created: ensured.created,
      payments: ensured.payments,
      appliedPayments,
    };
  });

  const { created, payments, appliedPayments } = purchasePlan();
  const wallet = getWalletSummary(req.user.id);

  notifyUser(
    req.app.get('io'),
    req.user.id,
    'Wallet Plan Purchase',
    `${plan.name} was linked to your account. ${appliedPayments.length ? `${appliedPayments.length} payment(s) were paid from wallet balance.` : 'No installments were fully covered yet.'}`,
    'payment',
    plan.id,
  );

  res.json({
    plan,
    created_plan: created,
    total_plan_payments: payments.length,
    applied_payments: appliedPayments.length,
    wallet,
  });
});

router.post('/wallet/deposit-requests', [
  body('planId').isInt({ min: 1 }),
  body('amount').isFloat({ gt: 0 }),
  body('note').optional({ nullable: true }).trim(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  if (req.user.role === 'admin') {
    return res.status(403).json({ error: 'Admins cannot create wallet funding requests' });
  }

  const player = getPlayerForUser(req.user.id);
  if (!player) {
    return res.status(400).json({ error: 'Only player-linked accounts can request plan funding' });
  }

  const { planId, amount, note = null } = req.body;
  const plan = db.prepare(`SELECT * FROM payment_plans WHERE id = ? AND is_active = 1`).get(Number(planId));
  if (!plan) return res.status(404).json({ error: 'Payment plan not found' });

  const requestAmount = Number(Number(amount).toFixed(2));
  const result = db.prepare(`
    INSERT INTO wallet_transactions (
      user_id, player_id, plan_id, type, status, amount, note, updated_at
    ) VALUES (?, ?, ?, 'deposit', 'pending', ?, ?, datetime('now'))
  `).run(
    req.user.id,
    player.id,
    plan.id,
    requestAmount,
    note || `Funding request for ${plan.name}`,
  );

  const request = db.prepare(`
    SELECT wt.*, plan.name AS plan_name
    FROM wallet_transactions wt
    LEFT JOIN payment_plans plan ON plan.id = wt.plan_id
    WHERE wt.id = ?
  `).get(result.lastInsertRowid);

  const admins = db.prepare(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`).all();
  admins.forEach((admin) => {
    notifyUser(
      req.app.get('io'),
      admin.id,
      'Wallet Funding Request',
      `${req.user.name} requested $${requestAmount.toLocaleString()} for ${plan.name}.`,
      'payment',
      request.id,
    );
  });

  res.status(201).json(request);
});

router.get('/wallet/requests', requireRole('admin'), (req, res) => {
  const { status = 'pending' } = req.query;
  let sql = `
    SELECT
      wt.*,
      u.name AS user_name,
      u.email AS user_email,
      p.name AS player_name,
      plan.name AS plan_name,
      reviewer.name AS reviewed_by_name
    FROM wallet_transactions wt
    JOIN users u ON u.id = wt.user_id
    LEFT JOIN players p ON p.id = wt.player_id
    LEFT JOIN payment_plans plan ON plan.id = wt.plan_id
    LEFT JOIN users reviewer ON reviewer.id = wt.reviewed_by
    WHERE wt.type = 'deposit'
  `;
  const params = [];

  if (status) {
    sql += ` AND wt.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY wt.created_at DESC, wt.id DESC`;
  res.json({ requests: db.prepare(sql).all(...params) });
});

router.patch('/wallet/requests/:id', requireRole('admin'), [
  body('status').isIn(['approved', 'rejected']),
  body('note').optional({ nullable: true }).trim(),
  body('firstDueDate').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const requestId = Number(req.params.id);
  const request = db.prepare(`
    SELECT
      wt.*,
      u.name AS user_name,
      p.name AS player_name,
      plan.name AS plan_name,
      plan.total_amount,
      plan.installment_count,
      plan.interval_days,
      plan.is_active
    FROM wallet_transactions wt
    JOIN users u ON u.id = wt.user_id
    LEFT JOIN players p ON p.id = wt.player_id
    LEFT JOIN payment_plans plan ON plan.id = wt.plan_id
    WHERE wt.id = ? AND wt.type = 'deposit'
  `).get(requestId);

  if (!request) return res.status(404).json({ error: 'Funding request not found' });
  if (request.status !== 'pending') {
    return res.status(409).json({ error: 'This funding request has already been reviewed' });
  }
  if (!request.plan_id || !request.is_active) {
    return res.status(400).json({ error: 'The selected payment plan is no longer active' });
  }

  const player = request.player_id
    ? db.prepare(`SELECT * FROM players WHERE id = ?`).get(request.player_id)
    : null;
  if (!player) return res.status(400).json({ error: 'Funding request is not linked to a valid player' });

  const reviewStatus = req.body.status;
  const io = req.app.get('io');

  const reviewFunding = db.transaction(() => {
    db.prepare(`
      UPDATE wallet_transactions
      SET status = ?, reviewed_by = ?, reviewed_at = ?, note = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      reviewStatus,
      req.user.id,
      new Date().toISOString(),
      req.body.note || request.note,
      requestId,
    );

    let planPayments = [];
    let appliedPayments = [];
    if (reviewStatus === 'approved') {
      planPayments = ensurePlanPayments(player, {
        id: request.plan_id,
        name: request.plan_name,
        total_amount: request.total_amount,
        installment_count: request.installment_count,
        interval_days: request.interval_days,
      }, {
        firstDueDate: req.body.firstDueDate,
        description: null,
      }).payments;
      appliedPayments = applyWalletToOutstandingPayments(request.user_id, player.id, request.plan_id);
    }

    return { planPayments, appliedPayments };
  });

  const { planPayments, appliedPayments } = reviewFunding();
  const wallet = getWalletSummary(request.user_id);
  const reviewed = db.prepare(`
    SELECT
      wt.*,
      plan.name AS plan_name,
      reviewer.name AS reviewed_by_name
    FROM wallet_transactions wt
    LEFT JOIN payment_plans plan ON plan.id = wt.plan_id
    LEFT JOIN users reviewer ON reviewer.id = wt.reviewed_by
    WHERE wt.id = ?
  `).get(requestId);

  if (reviewStatus === 'approved') {
    const paidCount = appliedPayments.length;
    notifyUser(
      io,
      request.user_id,
      'Wallet Funding Approved',
      `Your $${Number(request.amount).toLocaleString()} funding request for ${request.plan_name} was approved. ${paidCount ? `${paidCount} payment(s) were covered from your wallet. ` : ''}Current balance: $${wallet.balance.toLocaleString()}.`,
      'payment',
      requestId,
    );
  } else {
    notifyUser(
      io,
      request.user_id,
      'Wallet Funding Rejected',
      `Your funding request for ${request.plan_name} was not approved.`,
      'payment',
      requestId,
    );
  }

  res.json({
    request: reviewed,
    wallet,
    created_payments: planPayments.length,
    applied_payments: appliedPayments.length,
  });
});

router.patch('/:id/status', requireRole('admin'), [
  body('status').isIn(['pending', 'paid', 'overdue', 'cancelled']),
  body('paid_at').optional({ nullable: true }).isISO8601(),
], (req, res) => {
  if (validationErrors(req, res)) return;

  const paymentId = Number(req.params.id);
  const payment = db.prepare(`
    SELECT pay.*, p.user_id
    FROM payments pay
    JOIN players p ON p.id = pay.player_id
    WHERE pay.id = ?
  `).get(paymentId);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  const paidAt = req.body.status === 'paid'
    ? (req.body.paid_at || new Date().toISOString())
    : null;

  db.prepare(`
    UPDATE payments
    SET status = ?, paid_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.body.status, paidAt, paymentId);

  if (payment.user_id) {
    const message = req.body.status === 'paid'
      ? `Your payment of $${payment.amount} has been marked as paid.`
      : `Your payment status is now "${req.body.status}".`;
    notifyUser(
      req.app.get('io'),
      payment.user_id,
      'Payment Status Updated',
      message,
      'payment',
      paymentId,
    );
  }

  res.json(db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId));
});

router.post('/:id/remind', requireRole('admin', 'coach'), async (req, res) => {
  const paymentId = Number(req.params.id);
  const payment = db.prepare(`
    SELECT
      pay.*,
      p.name AS player_name,
      p.email AS player_email,
      p.user_id AS player_user_id,
      t.id AS team_id,
      t.name AS team_name,
      t.coach_id
    FROM payments pay
    JOIN players p ON p.id = pay.player_id
    LEFT JOIN team_players tp ON tp.player_id = p.id AND tp.is_active = 1
    LEFT JOIN teams t ON t.id = tp.team_id
    WHERE pay.id = ?
  `).get(paymentId);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });

  if (req.user.role === 'coach' && payment.coach_id !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const title = 'Payment Reminder';
  const bodyText = `Reminder: ${payment.player_name} has an outstanding payment of $${payment.amount}${payment.due_date ? ` due ${new Date(payment.due_date).toLocaleDateString()}` : ''}.`;

  notifyUser(
    req.app.get('io'),
    payment.player_user_id,
    title,
    bodyText,
    'payment',
    paymentId,
  );

  let emailSent = false;
  const transporter = getTransporter();
  if (transporter && payment.player_email) {
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to: payment.player_email,
        subject: `${title} - ${payment.team_name || 'VolleyOps'}`,
        text: bodyText,
        html: `<p>${bodyText}</p>`,
      });
      emailSent = true;
    } catch (error) {
      emailSent = false;
    }
  }

  res.json({
    message: 'Reminder sent',
    emailSent,
  });
});

module.exports = router;
