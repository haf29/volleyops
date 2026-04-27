const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// In production on Railway, DB_PATH points to a persistent Volume mount (e.g. /data/volleyops.db).
// Locally it falls back to the file next to this script.
const dbPath = process.env.DB_PATH
  ? path.resolve(__dirname, process.env.DB_PATH)
  : path.join(__dirname, 'volleyops.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Performance + integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- ─── USERS ───────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK(role IN ('admin','coach','assistant_coach','player')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── PLAYERS ─────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS players (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name                TEXT    NOT NULL,
    email               TEXT    NOT NULL,
    phone               TEXT,
    date_of_birth       TEXT,
    position            TEXT    CHECK(position IN (
                          'setter','libero','outside_hitter','opposite',
                          'middle_blocker','defensive_specialist'
                        )),
    jersey_number       INTEGER,
    team_id             INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    registration_status TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(registration_status IN ('pending','approved','rejected','waitlisted')),
    notes               TEXT,
    season              TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── TEAMS ───────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS teams (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    division             TEXT,
    season               TEXT,
    coach_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assistant_coach_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_finalized         INTEGER NOT NULL DEFAULT 0,
    roster_published     INTEGER NOT NULL DEFAULT 0,
    max_players          INTEGER NOT NULL DEFAULT 14,
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── TEAM ↔ PLAYER (many-to-many) ────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS team_players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    is_active   INTEGER NOT NULL DEFAULT 1,
    assigned_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, player_id)
  );

  -- ─── PAYMENT PLANS ───────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS payment_plans (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT    NOT NULL,
    description       TEXT,
    total_amount      REAL    NOT NULL,
    installment_count INTEGER NOT NULL DEFAULT 1,
    interval_days     INTEGER NOT NULL DEFAULT 30,
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── PAYMENTS ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS payments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    plan_id             INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
    amount              REAL    NOT NULL,
    description         TEXT,
    due_date            TEXT,
    paid_at             TEXT,
    status              TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','paid','overdue','cancelled')),
    installment_number  INTEGER,
    notes               TEXT,
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Wallet ledger: tracks deposit requests and wallet-funded payments
  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    player_id    INTEGER REFERENCES players(id) ON DELETE SET NULL,
    payment_id   INTEGER REFERENCES payments(id) ON DELETE SET NULL,
    plan_id      INTEGER REFERENCES payment_plans(id) ON DELETE SET NULL,
    type         TEXT    NOT NULL CHECK(type IN ('deposit','payment','adjustment')),
    status       TEXT    NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending','approved','rejected','applied')),
    amount       REAL    NOT NULL,
    note         TEXT,
    reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── CONVERSATIONS ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    type        TEXT    NOT NULL CHECK(type IN ('direct','group','team','broadcast')),
    team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── CONVERSATION MEMBERS ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS conversation_members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(conversation_id, user_id)
  );

  -- ─── MESSAGES ────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content         TEXT    NOT NULL,
    attachment_name TEXT,
    attachment_url  TEXT,
    is_announcement INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── MESSAGE READ RECEIPTS ────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS message_reads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(message_id, user_id)
  );

  -- ─── IN-APP NOTIFICATIONS ─────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS notifications (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    body         TEXT,
    is_read      INTEGER NOT NULL DEFAULT 0,
    related_type TEXT,
    related_id   INTEGER,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── LEAGUE STANDINGS ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS standings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    season     TEXT    NOT NULL,
    played     INTEGER NOT NULL DEFAULT 0,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    sets_won   INTEGER NOT NULL DEFAULT 0,
    sets_lost  INTEGER NOT NULL DEFAULT 0,
    points     INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, season)
  );

  -- ─── TACTICS BOARDS ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS tactics_boards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    team_id       INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    created_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    markers       TEXT    NOT NULL DEFAULT '[]',
    arrows        TEXT    NOT NULL DEFAULT '[]',
    zones         TEXT    NOT NULL DEFAULT '[]',
    formation     TEXT    NOT NULL DEFAULT '6-2',
    match_context TEXT    NOT NULL DEFAULT '{}',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── AI SUGGESTION HISTORY ────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS ai_suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    board_id    INTEGER REFERENCES tactics_boards(id) ON DELETE SET NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt      TEXT    NOT NULL,
    response    TEXT,
    board_state TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── MATCHES ─────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    opponent    TEXT    NOT NULL,
    match_date  TEXT    NOT NULL,
    location    TEXT,
    home_away   TEXT    NOT NULL DEFAULT 'home'
                  CHECK(home_away IN ('home','away','neutral')),
    competition TEXT,
    status      TEXT    NOT NULL DEFAULT 'scheduled'
                  CHECK(status IN ('scheduled','completed','cancelled','postponed')),
    score_us    INTEGER,
    score_them  INTEGER,
    sets_us     INTEGER,
    sets_them   INTEGER,
    notes       TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- ─── MATCH LINEUPS ────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS match_lineups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    role        TEXT    NOT NULL DEFAULT 'substitute'
                  CHECK(role IN ('starter','substitute')),
    position    TEXT,
    notes       TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(match_id, player_id)
  );

  -- ─── REFRESH TOKENS ──────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
// Add status column to teams if missing (existing DBs won't have it)
const teamCols = db.prepare('PRAGMA table_info(teams)').all().map(c => c.name);
if (!teamCols.includes('status')) {
  db.exec(`ALTER TABLE teams ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
}

// Add notes column to tactics_boards if missing
const tacticsCols = db.prepare('PRAGMA table_info(tactics_boards)').all().map(c => c.name);
if (!tacticsCols.includes('notes')) {
  db.exec(`ALTER TABLE tactics_boards ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
}

// Personal notes (persists per user, independent of any board)
db.exec(`
  CREATE TABLE IF NOT EXISTS user_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT    NOT NULL DEFAULT 'Untitled Note',
    content    TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Team requests: coaches register wanting a specific team (existing or new)
db.exec(`
  CREATE TABLE IF NOT EXISTS team_requests (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Player season statistics
db.exec(`
  CREATE TABLE IF NOT EXISTS player_stats (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    season         TEXT    NOT NULL DEFAULT '2024-2025',
    matches_played INTEGER NOT NULL DEFAULT 0,
    sets_played    INTEGER NOT NULL DEFAULT 0,
    points         INTEGER NOT NULL DEFAULT 0,
    kills          INTEGER NOT NULL DEFAULT 0,
    aces           INTEGER NOT NULL DEFAULT 0,
    blocks         INTEGER NOT NULL DEFAULT 0,
    digs           INTEGER NOT NULL DEFAULT 0,
    errors         INTEGER NOT NULL DEFAULT 0,
    UNIQUE(player_id, season)
  );
`);

// Match-by-match stat lines. Season totals in player_stats are recomputed from these rows.
db.exec(`
  CREATE TABLE IF NOT EXISTS match_player_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    sets_played INTEGER NOT NULL DEFAULT 0,
    points      INTEGER NOT NULL DEFAULT 0,
    kills       INTEGER NOT NULL DEFAULT 0,
    aces        INTEGER NOT NULL DEFAULT 0,
    blocks      INTEGER NOT NULL DEFAULT 0,
    digs        INTEGER NOT NULL DEFAULT 0,
    errors      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(match_id, player_id)
  );
`);

// Password reset tokens (single-use, 1-hour TTL)
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT    UNIQUE NOT NULL,
    expires_at TEXT    NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Tryout sessions + check-in ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS tryouts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    date       TEXT    NOT NULL,
    location   TEXT,
    team_id    INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    season     TEXT,
    notes      TEXT,
    is_open    INTEGER NOT NULL DEFAULT 1,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tryout_attendees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tryout_id     INTEGER NOT NULL REFERENCES tryouts(id) ON DELETE CASCADE,
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status        TEXT    NOT NULL DEFAULT 'registered'
                    CHECK(status IN ('registered','present','absent','excused')),
    checked_in_at TEXT,
    notes         TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tryout_id, player_id)
  );
`);

// ─── Player evaluations (skill scoring) ──────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS player_evaluations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tryout_id    INTEGER REFERENCES tryouts(id) ON DELETE CASCADE,
    player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    evaluated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    season       TEXT,
    serving      INTEGER CHECK(serving      BETWEEN 1 AND 10),
    passing      INTEGER CHECK(passing      BETWEEN 1 AND 10),
    setting      INTEGER CHECK(setting      BETWEEN 1 AND 10),
    hitting      INTEGER CHECK(hitting      BETWEEN 1 AND 10),
    blocking     INTEGER CHECK(blocking     BETWEEN 1 AND 10),
    defense      INTEGER CHECK(defense      BETWEEN 1 AND 10),
    athleticism  INTEGER CHECK(athleticism  BETWEEN 1 AND 10),
    coachability INTEGER CHECK(coachability BETWEEN 1 AND 10),
    notes        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(tryout_id, player_id, evaluated_by)
  );
`);

// ─── Attendance (training sessions + per-player status) ───────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS training_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    date       TEXT    NOT NULL,
    type       TEXT    NOT NULL DEFAULT 'training'
                 CHECK(type IN ('training','match','tournament','other')),
    title      TEXT,
    notes      TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    status     TEXT    NOT NULL DEFAULT 'present'
                 CHECK(status IN ('present','absent','late','excused')),
    notes      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, player_id)
  );
`);

// ─── Calendar subscription tokens ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS calendar_tokens (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    token      TEXT    UNIQUE NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
