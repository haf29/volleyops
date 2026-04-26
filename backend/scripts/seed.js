/**
 * VolleyOps — Production-safe seed entry point
 * Runs the full seed ONLY when the database is empty (no users exist).
 * Safe to include in the Railway start command on every deploy.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const db = require('../db');

const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();

if (count > 0) {
  console.log(`ℹ️  Database already contains ${count} user(s) — skipping seed.`);
  process.exit(0);
}

console.log('🌱  Empty database detected — running seed…');
require('../seed');
