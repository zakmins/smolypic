// SQLite layer for Smolympic — better-sqlite3, no ORM.
// Ported from the former FastAPI backend (backend/db.py). Runs in the Electron
// main process and in plain Node (seed / tests). Synchronous, prepared statements.
const crypto = require('crypto');
const Database = require('better-sqlite3');

const ISO_LEN = 19; // "YYYY-MM-DDTHH:MM:SS"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rfid_uid TEXT UNIQUE NOT NULL,    -- numeric UID printed on the member's RFID tag
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  dob TEXT,
  phone TEXT,
  sports TEXT NOT NULL,             -- JSON array
  membership_type TEXT NOT NULL,    -- 'subscription' | 'session'
  sub_start TEXT,
  sub_end TEXT,
  duration_days INTEGER,
  sessions_total INTEGER,           -- NULL ⇒ unlimited subscription (date-only)
  sessions_left INTEGER,            -- may go negative: club owes sessions
  insurance INTEGER NOT NULL DEFAULT 0,
  insurance_expiry TEXT,            -- end of the paid insurance year (NULL ⇒ never enrolled)
  balance INTEGER NOT NULL DEFAULT 0, -- unpaid membership fees still owed (DZD); 0 ⇒ fully paid
  hue INTEGER NOT NULL DEFAULT 0,
  join_date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  entry_time TEXT NOT NULL,
  exit_time TEXT                    -- NULL ⇒ member is inside right now
);
CREATE INDEX IF NOT EXISTS idx_entries_member ON entries(member_id);
CREATE INDEX IF NOT EXISTS idx_entries_open ON entries(exit_time) WHERE exit_time IS NULL;
CREATE INDEX IF NOT EXISTS idx_entries_time ON entries(entry_time);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL,               -- 'subscription' | 'session'
  sport TEXT,                       -- primary sport at payment time, for revenue-by-sport
  method TEXT,
  date TEXT NOT NULL,
  walk_in INTEGER NOT NULL DEFAULT 0 -- 1 ⇒ anonymous "+ Session" drop-in (never a member)
);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);

CREATE TABLE IF NOT EXISTS judo_students (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  belt INTEGER NOT NULL,
  weight_cat TEXT,
  attendance_rate INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS judo_competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT, event TEXT, result TEXT
);

CREATE TABLE IF NOT EXISTS wrestling_students (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  category INTEGER NOT NULL,
  style TEXT,
  weight_kg INTEGER, height_cm INTEGER,
  attendance_rate INTEGER
);
CREATE TABLE IF NOT EXISTS wrestling_competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  date TEXT, event TEXT, result TEXT
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport TEXT NOT NULL,              -- 'judo' | 'wrestling'
  day TEXT, time TEXT, grp TEXT
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  qty INTEGER NOT NULL,
  min INTEGER NOT NULL,
  buy INTEGER,
  sell INTEGER,
  supplier TEXT,
  expiry TEXT,
  last_restock TEXT
);
CREATE TABLE IF NOT EXISTS stock_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,             -- 'add' | 'remove'
  qty INTEGER NOT NULL,
  reason TEXT,
  cost INTEGER,
  date TEXT NOT NULL
);

-- Walk-in "free sessions": one-off paid visits not tied to a member. They count
-- on the floor until expires_at (entry + 2h), then drop off automatically.
CREATE TABLE IF NOT EXISTS guest_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_time TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Optional member portrait — kept out of the member rows/list payloads. The
-- ~320px JPEG is served on demand via the smolphoto:// protocol (see main.js).
CREATE TABLE IF NOT EXISTS member_photos (
  member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  photo BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── Auth & audit ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name TEXT,
  address TEXT,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'coach',   -- 'admin' | 'coach'
  color TEXT NOT NULL DEFAULT '#10D98E',
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  login_at TEXT NOT NULL,
  logout_at TEXT                        -- NULL ⇒ session still active
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);

-- App-wide configuration as key → JSON. Currently holds the editable price book
-- (key 'pricing'); rows are absent until first saved, so reads fall back to
-- DEFAULT_PRICING. Created on every open, so existing databases pick it up too.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

// ── Price book ────────────────────────────────────────────────────────────────
// The editable source of truth for every amount the billing logic charges.
//  · insurance      — yearly fee (DZD)
//  · sessions       — named pay-per-session / walk-in prices (name + amount). The
//                     first one is the default rate billed on a pay-per-session swipe.
//  · subscriptions  — monthly subscription prices. Gym/Cardio carry one price per
//                     weekly plan tier (2/3/4 per week + unlimited); Judo &
//                     Wrestling are flat monthly. GYM_CARDIO is the gym+cardio combo.
const DEFAULT_PRICING = {
  insurance: 500,
  sessions: [
    { id: 'standard', label: 'Standard session', price: 300 },
    { id: 'cardio', label: 'Cardio session', price: 400 },
  ],
  subscriptions: {
    GYM: { 2: 2000, 3: 2500, 4: 3000, unlimited: 3500 },
    CARDIO: { 2: 2000, 3: 2500, 4: 3000, unlimited: 3500 },
    GYM_CARDIO: { 2: 2000, 3: 2500, 4: 3000, unlimited: 3500 },
    JUDO: { monthly: 3000 },
    WRESTLING: { monthly: 3000 },
  },
};

const clone = (v) => JSON.parse(JSON.stringify(v));
const toMoney = (v, fallback = 0) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Merge a stored/incoming price book over the defaults so a partial or stale
// object always yields a complete, well-typed one. Unknown keys are dropped.
function normalizePricing(input) {
  const base = clone(DEFAULT_PRICING);
  if (!input || typeof input !== 'object') return base;
  const out = { insurance: toMoney(input.insurance, base.insurance), sessions: [], subscriptions: {} };
  const sessions = Array.isArray(input.sessions) ? input.sessions : base.sessions;
  out.sessions = sessions
    .filter((s) => s && (s.label != null || s.price != null))
    .map((s, i) => ({
      id: String(s.id || `s${i}`),
      label: String(s.label || `Session ${i + 1}`),
      price: toMoney(s.price, 0),
    }));
  if (!out.sessions.length) out.sessions = clone(base.sessions);
  for (const [cat, def] of Object.entries(base.subscriptions)) {
    const given = (input.subscriptions && input.subscriptions[cat]) || {};
    out.subscriptions[cat] = {};
    for (const tier of Object.keys(def)) out.subscriptions[cat][tier] = toMoney(given[tier], def[tier]);
  }
  return out;
}

function getPricing(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='pricing'").get();
  let stored = null;
  if (row) { try { stored = JSON.parse(row.value); } catch { stored = null; } }
  return normalizePricing(stored);
}

function savePricing(db, pricing) {
  const merged = normalizePricing(pricing);
  db.prepare(
    "INSERT INTO settings (key,value) VALUES ('pricing',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(JSON.stringify(merged));
  return merged;
}

// The default per-session rate — the first configured session price. Used for
// pay-per-session billing on swipe and the "sessions owed" amounts.
function sessionPriceFor(pricing) {
  return pricing.sessions[0] ? pricing.sessions[0].price : 0;
}

// ── Time helpers (local time, matching the former Python "%Y-%m-%dT%H:%M:%S") ──
const pad = (n) => String(n).padStart(2, '0');

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T`
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Date-only stamp (YYYY-MM-DD) for fields that represent a calendar day rather
// than an instant — e.g. the subscription window (sub_start/sub_end). Accepts a
// Date or any iso()/date string. ms() parses these back as local midnight.
function isoDate(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ms(s) {
  // Parse "YYYY-MM-DDTHH:MM:SS" as local time → epoch milliseconds.
  const [date, time = '00:00:00'] = s.slice(0, ISO_LEN).split('T');
  const [Y, M, D] = date.split('-').map(Number);
  const [h, mi, se] = time.split(':').map(Number);
  return new Date(Y, M - 1, D, h, mi, se || 0).getTime();
}

// Add a column if an older database predates it (CREATE TABLE IF NOT EXISTS
// won't alter an existing table). No-ops once the column is present.
function ensureColumn(db, table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  // Per-user UI preferences (theme + language). NULL ⇒ fall back to app defaults.
  ensureColumn(db, 'users', 'theme', 'TEXT');
  ensureColumn(db, 'users', 'language', 'TEXT');
  // Outstanding membership balance — added for partial payments. Older databases
  // predate the column; default 0 means "fully paid" for every existing member.
  ensureColumn(db, 'members', 'balance', 'INTEGER NOT NULL DEFAULT 0');
  // payments.walk_in marks anonymous "+ Session" drop-ins, so deleting a member
  // never reclassifies their session payments as walk-ins (deletion nulls
  // member_id). Backfill ONCE on upgrade: before this column existed, the only
  // member-less session rows were genuine walk-ins (no member had been deleted
  // yet), so that exact set is the legacy walk-in history. This must not run on
  // later opens, or it would re-tag a deleted member's orphaned payments.
  const hasWalkIn = db.prepare('PRAGMA table_info(payments)').all().some((c) => c.name === 'walk_in');
  if (!hasWalkIn) {
    db.exec('ALTER TABLE payments ADD COLUMN walk_in INTEGER NOT NULL DEFAULT 0');
    db.exec("UPDATE payments SET walk_in=1 WHERE member_id IS NULL AND kind='session'");
  }
  return db;
}

// ── Auth helpers (stdlib crypto — PBKDF2-HMAC-SHA256, per-user salt) ───────────
function hashPassword(password, salt = null) {
  if (salt === null) salt = crypto.randomBytes(16).toString('hex');
  const digest = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), 100000, 32, 'sha256');
  return { hash: digest.toString('hex'), salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function userRowToDict(r) {
  return {
    id: r.id,
    username: r.username,
    fullName: r.full_name,
    address: r.address,
    phone: r.phone,
    role: r.role,
    color: r.color,
    createdAt: r.created_at,
    active: !!r.active,
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'dark',
    language: r.language === 'en' || r.language === 'fr' ? r.language : 'en',
  };
}

function memberRowToDict(db, r) {
  // amountPaid / paymentDate / lastVisit are derived from payments & entries.
  // amountPaid is membership spend only — the yearly insurance fee is tracked separately.
  const pay = db.prepare(
    "SELECT COALESCE(SUM(CASE WHEN kind!='insurance' THEN amount ELSE 0 END),0) AS total, MAX(date) AS last FROM payments WHERE member_id=?",
  ).get(r.id);
  const lastVisit = db.prepare(
    'SELECT MAX(entry_time) AS t FROM entries WHERE member_id=?',
  ).get(r.id).t;
  // Only a flag + a cache-busting tag — never the image bytes — go into the row.
  const photo = db.prepare('SELECT updated_at FROM member_photos WHERE member_id=?').get(r.id);
  return {
    id: r.id,
    rfidUid: r.rfid_uid,
    name: r.name,
    gender: r.gender,
    dob: r.dob,
    phone: r.phone,
    sports: JSON.parse(r.sports),
    membershipType: r.membership_type,
    subStart: r.sub_start,
    subEnd: r.sub_end,
    durationDays: r.duration_days,
    sessionsTotal: r.sessions_total,
    sessionsLeft: r.sessions_left,
    amountPaid: pay.total,
    paymentDate: pay.last || r.join_date,
    balance: r.balance || 0,
    insurance: !!r.insurance,
    insuranceExpiry: r.insurance_expiry,
    hasPhoto: !!photo,
    photoTag: photo ? ms(photo.updated_at) : null,
    hue: r.hue,
    lastVisit: lastVisit || r.join_date,
    joinDate: r.join_date,
  };
}

// Store/replace/clear a member's portrait. `dataUrl` is a base64 image data URL
// (e.g. data:image/jpeg;base64,…); null/empty clears it. Bytes never leave here
// except through the smolphoto:// protocol.
function setMemberPhoto(db, memberId, dataUrl) {
  if (!dataUrl) {
    db.prepare('DELETE FROM member_photos WHERE member_id=?').run(memberId);
    return;
  }
  const comma = dataUrl.indexOf(',');
  const buf = Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, 'base64');
  db.prepare(
    `INSERT INTO member_photos (member_id, photo, updated_at) VALUES (?,?,?)
     ON CONFLICT(member_id) DO UPDATE SET photo=excluded.photo, updated_at=excluded.updated_at`,
  ).run(memberId, buf, iso(new Date()));
}

function logActivity(db, userId, action, target, detail) {
  db.prepare(
    'INSERT INTO activity_log (user_id,action,target,detail,created_at) VALUES (?,?,?,?,?)',
  ).run(userId, action, target, detail, iso(new Date()));
}

module.exports = {
  SCHEMA, openDb, iso, isoDate, ms,
  hashPassword, verifyPassword, userRowToDict, memberRowToDict, setMemberPhoto, logActivity,
  DEFAULT_PRICING, getPricing, savePricing, sessionPriceFor,
};
