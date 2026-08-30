// Smolympic request router — Node port of the former FastAPI app (backend/main.py).
// Dispatches { method, path, body, token } to a handler and returns
// { status, data } on success or { status, error } on failure. Runs in the
// Electron main process (over IPC) and in plain Node (tests).
const crypto = require('crypto');
const {
  iso, isoDate, ms, hashPassword, verifyPassword, userRowToDict, memberRowToDict, setMemberPhoto, logActivity,
  getPricing, savePricing, sessionPriceFor, getCorrectionSettings, saveCorrectionSettings,
} = require('./db.js');

const INSURANCE_DAYS = 365;
const SUB_DURATION_LABEL = { 30: '1 month', 90: '3 months', 180: '6 months', 365: '1 year' };

const dayStart = () => {
  const n = new Date();
  return iso(new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0));
};

class HttpError extends Error {
  constructor(status, detail) { super(detail); this.status = status; this.detail = detail; }
}

const pad = (n) => String(n).padStart(2, '0');

// ISO-8601 week number (weeks start Monday; week 1 holds the first Thursday).
const isoWeek = (d) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date - firstThu) / (7 * 86400000));
};

// ── membership rule (shared by live cards + stats; mirrors src/utils.js) ───────
// Whole days left in the window. sub_end is the renewal day (exclusive): the last
// active day is the day before it, so a sub paid on the 25th for 30 days runs the
// 25th through the 24th next month — exactly 30 days. ceil ⇒ "1 day left" through
// the final active day, then ≤ 0 once sub_end arrives.
const subDaysLeft = (m) => Math.ceil((ms(m.subEnd) - Date.now()) / 86400000);

// Same day count, but off a raw db row (snake_case sub_end) rather than the
// camelCase dict shape — for swipe/check-in, which never go through memberRowToDict.
const rowDaysLeft = (m, now) => Math.ceil((ms(m.sub_end) - now.getTime()) / 86400000);

// Negative quota ⇒ the club is carrying the member. Unlimited subs (NULL quota) never qualify.
const isOwed = (m) => m.sessionsLeft != null && m.sessionsLeft < 0;

// A subscription about to lapse, excluding the already-expired. Returns the
// triggering axis 'date' | 'sessions' | 'both', or null. Unlimited subs trip on
// the date axis only; metered subs on either the date or sessions axis.
function expiringReason(m) {
  if (m.membershipType !== 'subscription') return null;
  const dr = subDaysLeft(m);
  const metered = m.sessionsTotal != null;
  if (dr <= 0 || (metered && m.sessionsLeft <= 0)) return null;   // already expired
  const dateAxis = dr < 2;
  const sessionsAxis = metered && m.sessionsLeft < 2;
  if (!dateAxis && !sessionsAxis) return null;
  return dateAxis && sessionsAxis ? 'both' : dateAxis ? 'date' : 'sessions';
}

// ── shared payload helpers ────────────────────────────────────────────────────
function getMember(db, id) {
  const r = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!r) throw new HttpError(404, 'Member not found');
  return r;
}

function paymentRowToDict(db, r) {
  const author = r.created_by ? db.prepare('SELECT full_name, username FROM users WHERE id=?').get(r.created_by) : null;
  return {
    id: r.id,
    memberId: r.member_id,
    amount: r.amount,
    kind: r.kind,
    sport: r.sport,
    method: r.method,
    date: r.date,
    walkIn: !!r.walk_in,
    balancePayment: !!r.balance_payment,
    createdBy: author ? (author.full_name || author.username) : null,
    reversesPaymentId: r.reverses_payment_id,
    voidedAt: r.voided_at,
    isReversal: r.reverses_payment_id != null,
  };
}

// Can `user` void/edit a payment recorded at `dateStr` by `createdBy`? Own
// transactions are self-service within the configured window; anything else
// (someone else's entry, or past the window) needs an admin.
function canCorrect(db, user, dateStr, createdBy) {
  if (user.role === 'admin') return true;
  if (createdBy !== user.id) return false;
  const windowMs = getCorrectionSettings(db).windowHours * 3600000;
  return (Date.now() - ms(dateStr)) <= windowMs;
}

function presenceList(db) {
  const members = db.prepare('SELECT member_id, entry_time FROM entries WHERE exit_time IS NULL ORDER BY entry_time DESC')
    .all().map((r) => ({ memberId: r.member_id, entryTime: ms(r.entry_time) }));
  // Walk-in free sessions count as inside until their 2h window lapses.
  const guests = db.prepare(
    'SELECT id, name, amount, entry_time, expires_at, payment_id FROM guest_sessions WHERE expires_at > ? ORDER BY entry_time DESC',
  ).all(iso(new Date())).map((r) => ({
    guest: true, guestId: r.id, name: r.name, amount: r.amount,
    entryTime: ms(r.entry_time), expiresAt: ms(r.expires_at), paymentId: r.payment_id,
  }));
  return [...guests, ...members];
}

function exitsList(db, limit = 20) {
  return db.prepare(
    'SELECT member_id, entry_time, exit_time FROM entries WHERE exit_time IS NOT NULL ORDER BY exit_time DESC LIMIT ?',
  ).all(limit).map((r) => ({ memberId: r.member_id, entryTime: ms(r.entry_time), exitTime: ms(r.exit_time) }));
}

function todayStats(db) {
  const now = new Date();
  const start = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
  const memberEntries = db.prepare('SELECT COUNT(*) c FROM entries WHERE entry_time>=?').get(start).c;
  const guestEntries = db.prepare('SELECT COUNT(*) c FROM guest_sessions WHERE entry_time>=?').get(start).c;
  const srev = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='session' AND date>=?").get(start).s;
  const subrev = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='subscription' AND date>=?").get(start).s;
  const scount = db.prepare("SELECT COUNT(*) c FROM payments WHERE kind='session' AND date>=?").get(start).c;
  // Excludes balance_payment=1: collecting an old balance is real revenue (counted
  // in subrev) but isn't a new subscribe/renew event, so it shouldn't inflate "Subscribed today".
  const subcount = db.prepare("SELECT COUNT(*) c FROM payments WHERE kind='subscription' AND balance_payment=0 AND date>=?").get(start).c;
  return {
    entries: memberEntries + guestEntries,   // walk-in free sessions count as entries too
    sessionRevenue: srev, subscriptionRevenue: subrev,
    sessionCount: scount, subscriptionCount: subcount,
  };
}

function allMembers(db) {
  const rows = db.prepare('SELECT * FROM members ORDER BY name').all();
  // Batch the per-member aggregates memberRowToDict would otherwise fetch one row
  // at a time (N+1): three grouped queries instead of 3×N. allMembers runs on
  // every swipe / guest session / stats load, so this is the hot path.
  const payMap = new Map();
  for (const p of db.prepare(
    "SELECT member_id, COALESCE(SUM(CASE WHEN kind!='insurance' THEN amount ELSE 0 END),0) total, MAX(date) last "
    + 'FROM payments WHERE member_id IS NOT NULL GROUP BY member_id',
  ).all()) payMap.set(p.member_id, p);
  const visitMap = new Map();
  for (const e of db.prepare('SELECT member_id, MAX(entry_time) t FROM entries GROUP BY member_id').all()) {
    visitMap.set(e.member_id, e.t);
  }
  const photoMap = new Map();
  for (const ph of db.prepare('SELECT member_id, updated_at FROM member_photos').all()) {
    photoMap.set(ph.member_id, ph.updated_at);
  }
  // Mirrors memberRowToDict (db.js) but reads the batched maps. Keep the two in sync.
  return rows.map((r) => {
    const pay = payMap.get(r.id) || { total: 0, last: null };
    const photoUpdated = photoMap.get(r.id) || null;
    return {
      id: r.id,
      rfidUid: r.rfid_uid,
      name: r.name,
      gender: r.gender,
      dob: r.dob,
      phone: r.phone,
      bloodType: r.blood_type,
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
      hasPhoto: !!photoUpdated,
      photoTag: photoUpdated ? ms(photoUpdated) : null,
      hue: r.hue,
      lastVisit: visitMap.get(r.id) || r.join_date,
      joinDate: r.join_date,
    };
  });
}

function stockPayload(db) {
  const items = db.prepare('SELECT * FROM stock_items ORDER BY id').all().map((r) => {
    const it = {
      ...r,
      lastRestock: r.last_restock,
      unit: r.unit || 'unit',
      containerSize: r.container_size ?? null,
      portions: r.portions ? safeParsePortions(r.portions) : [],
    };
    delete it.last_restock;
    delete it.container_size;
    return it;
  });
  const log = db.prepare('SELECT * FROM stock_log ORDER BY date DESC LIMIT 60').all().map((r) => ({
    id: r.id, itemId: r.item_id, action: r.action, qty: r.qty, reason: r.reason, cost: r.cost, date: r.date,
  }));
  const monthAgo = iso(new Date(Date.now() - 30 * 86400000));
  // "Most consumed" — weight items report grams; the client formats g/kg via `unit`.
  const consumed = db.prepare(
    "SELECT si.name, si.unit unit, SUM(sl.qty) q FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id "
    + "WHERE sl.action='remove' AND sl.date>=? GROUP BY si.id ORDER BY q DESC LIMIT 8",
  ).all(monthAgo).map((r) => ({ name: r.name, qty: r.q, unit: r.unit || 'unit' }));
  return { stock: items, stockLog: log, consumed };
}

// Portions are user-entered JSON; never let a corrupt row crash the payload.
function safeParsePortions(json) {
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p) => ({ g: Math.round(Number(p.g)), price: Math.round(Number(p.price)) }))
      .filter((p) => p.g > 0 && p.price >= 0);
  } catch { return []; }
}

function competitions(db, table, memberId) {
  return db.prepare(`SELECT id, date, event, result FROM ${table} WHERE member_id=? ORDER BY date DESC`).all(memberId);
}

// ── auth ──────────────────────────────────────────────────────────────────────
function resolveUser(db, token) {
  if (!token) return null;
  const row = db.prepare(
    'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.logout_at IS NULL',
  ).get(token);
  if (!row || !row.active) return null;
  return row;
}

// ── handlers ────────────────────────────────────────────────────────────────
function login(db, { body }) {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get((body.username || '').trim());
  if (!u || !u.active) throw new HttpError(401, 'No user with this username');
  if (!verifyPassword(body.password || '', u.password_salt, u.password_hash)) {
    throw new HttpError(401, 'Wrong password');
  }
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (user_id,token,login_at) VALUES (?,?,?)').run(u.id, token, iso(new Date()));
  logActivity(db, u.id, 'login', u.username, 'Signed in');
  return { token, user: userRowToDict(u) };
}

function logout(db, { user }) {
  db.prepare('UPDATE sessions SET logout_at=? WHERE token=? AND logout_at IS NULL').run(iso(new Date()), user.token);
  logActivity(db, user.id, 'logout', user.username, 'Signed out');
  return { ok: true };
}

function me(db, { user }) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
  if (!u) throw new HttpError(401, 'Account no longer exists');
  return userRowToDict(u);
}

// Per-user UI preferences (theme + language). Only the signed-in user's own
// preferences; pricing and other app-wide config live elsewhere.
function updatePreferences(db, { body, user }) {
  if (body.theme === 'dark' || body.theme === 'light') {
    db.prepare('UPDATE users SET theme=? WHERE id=?').run(body.theme, user.id);
  }
  if (body.language === 'fr' || body.language === 'en') {
    db.prepare('UPDATE users SET language=? WHERE id=?').run(body.language, user.id);
  }
  return userRowToDict(db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
}

function bootstrap(db) {
  return {
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
    pricing: getPricing(db),
    ...stockPayload(db),
  };
}

// The editable price book (insurance, session and subscription prices) plus
// the payment-correction settings (self-service void/edit window).
function getSettings(db) {
  return { pricing: getPricing(db), corrections: getCorrectionSettings(db) };
}

function updateSettings(db, { body, user }) {
  const pricing = savePricing(db, body.pricing ?? body);
  const corrections = body.corrections ? saveCorrectionSettings(db, body.corrections) : getCorrectionSettings(db);
  logActivity(db, user.id, 'settings.update', 'pricing', 'Updated the price book');
  return { pricing, corrections };
}

// Today's subscribers — one entry per subscribe/renew payment dated today, newest
// first. Excludes balance_payment=1 (paying off an old balance isn't a fresh
// subscribe/renew) and voided/reversal rows (a corrected mistake shouldn't
// re-list, or list negatively, as if it were a real subscription today).
function liveSubscribedToday(db) {
  const start = dayStart();
  const rows = db.prepare(
    "SELECT amount, method, date, member_id FROM payments "
    + "WHERE kind='subscription' AND balance_payment=0 AND voided_at IS NULL AND reverses_payment_id IS NULL AND date>=? ORDER BY date DESC",
  ).all(start);
  const out = [];
  for (const r of rows) {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(r.member_id);
    if (!m) continue;
    out.push({
      member: memberRowToDict(db, m),
      amount: r.amount,
      paymentTime: ms(r.date),
      durationLabel: SUB_DURATION_LABEL[m.duration_days] || `${m.duration_days} days`,
      subEnd: m.sub_end,
    });
  }
  return out;
}

// Today's entry events (members + walk-ins), newest first. One row per entry, so
// the list length matches today.entries. exitTime null ⇒ still inside.
function liveEntriesToday(db) {
  const start = dayStart();
  const nowIso = iso(new Date());
  const memberEntries = db.prepare(
    'SELECT member_id, entry_time, exit_time FROM entries WHERE entry_time>=?',
  ).all(start).map((r) => {
    const m = db.prepare('SELECT * FROM members WHERE id=?').get(r.member_id);
    return m ? {
      member: memberRowToDict(db, m),
      entryTime: ms(r.entry_time),
      exitTime: r.exit_time ? ms(r.exit_time) : null,
    } : null;
  }).filter(Boolean);
  const guestEntries = db.prepare(
    'SELECT id, name, entry_time, expires_at FROM guest_sessions WHERE entry_time>=?',
  ).all(start).map((r) => ({
    guest: true,
    guestId: r.id,
    name: r.name,
    entryTime: ms(r.entry_time),
    exitTime: r.expires_at <= nowIso ? ms(r.expires_at) : null,   // rolled off the floor at expiry
  }));
  return [...memberEntries, ...guestEntries].sort((a, b) => b.entryTime - a.entryTime);
}

// Registered members the club owes sessions to (negative quota), most owed first.
// amountToCollect = owed sessions × their per-session price (cardio 400, else 300).
function liveSessionsOwed(db) {
  const pricing = getPricing(db);
  return allMembers(db)
    .filter(isOwed)
    .map((m) => {
      const owed = Math.abs(m.sessionsLeft);
      const price = sessionPriceFor(pricing);
      return { member: m, owed, amountToCollect: owed * price };
    })
    .sort((a, b) => b.owed - a.owed);
}

// Subscriptions about to lapse, the closest-to-zero triggering axis first.
function liveExpiringSoon(db) {
  const out = [];
  for (const m of allMembers(db)) {
    const reason = expiringReason(m);
    if (!reason) continue;
    out.push({
      member: m,
      daysRemaining: subDaysLeft(m),
      sessionsLeft: m.sessionsTotal != null ? m.sessionsLeft : null,   // null ⇒ unlimited
      reason,
    });
  }
  const closest = (r) => {
    const axes = [];
    if (r.reason !== 'sessions') axes.push(r.daysRemaining);
    if (r.reason !== 'date') axes.push(r.sessionsLeft);
    return Math.min(...axes);
  };
  return out.sort((a, b) => closest(a) - closest(b));
}

function swipe(db, { body }) {
  const now = new Date();
  const m = db.prepare('SELECT * FROM members WHERE rfid_uid=?').get(body.rfidUid);
  let event;
  if (!m) {
    event = { kind: 'unknown', rfidUid: body.rfidUid, at: now.getTime() };
  } else {
    const open = db.prepare('SELECT * FROM entries WHERE member_id=? AND exit_time IS NULL').get(m.id);
    if (open) {
      db.prepare('UPDATE entries SET exit_time=? WHERE id=?').run(iso(now), open.id);
      event = { kind: 'out', entryTime: ms(open.entry_time), at: now.getTime() };
    } else {
      db.prepare('INSERT INTO entries (member_id,entry_time,exit_time) VALUES (?,?,NULL)').run(m.id, iso(now));
      if (m.membership_type === 'subscription') {
        const dead = rowDaysLeft(m, now) <= 0;   // sub_end already passed — the plan is dead
        if (m.sessions_total != null) {
          // Metered subscription: burn a session from the quota (already paid, no charge).
          // Once the plan is dead, there's no live balance left to spend — floor it at 0
          // first so a swipe on a dead plan always costs exactly one owed session, instead
          // of quietly draining whatever was left unused on an expired plan.
          const base = dead ? Math.min(m.sessions_left, 0) : m.sessions_left;
          db.prepare('UPDATE members SET sessions_left=? WHERE id=?').run(base - 1, m.id);
        } else if (dead) {
          // Unlimited subscription, but expired: a dead plan no longer grants free
          // access, so the club owes a session — same as an expired metered plan —
          // to be settled directly or carried into the member's next renewal.
          db.prepare('UPDATE members SET sessions_left=? WHERE id=?').run(Math.min(m.sessions_left ?? 0, 0) - 1, m.id);
        }
        // A live unlimited subscription (not dead) still never decrements.
      }
      event = { kind: 'in', at: now.getTime() };
    }
    event.member = memberRowToDict(db, getMember(db, m.id));
  }
  return {
    event,
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
  };
}

// Manually close a member's open entry, e.g. when they left without swiping
// their tag at the exit reader. Behaves exactly like the "out" half of a real
// swipe — same exit_time write, same effect on Recent Exits and stats.
function forceExit(db, { params, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const open = db.prepare('SELECT * FROM entries WHERE member_id=? AND exit_time IS NULL').get(id);
  if (!open) throw new HttpError(400, 'Member is not currently inside');
  db.prepare('UPDATE entries SET exit_time=? WHERE id=?').run(iso(new Date()), open.id);
  logActivity(db, user.id, 'member.force_exit', m.name, `Manually marked ${m.name} as exited`);
  return {
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
  };
}

// Manually put a member on the floor without an RFID scan (e.g. a lost tag at
// reception). Mirrors the "in" half of a real swipe: opens an entry, burns a
// session on a metered plan, same effect on Currently Inside / stats.
function checkIn(db, { params, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const open = db.prepare('SELECT * FROM entries WHERE member_id=? AND exit_time IS NULL').get(id);
  if (open) throw new HttpError(400, 'Member is already inside');
  const now = new Date();
  db.prepare('INSERT INTO entries (member_id,entry_time,exit_time) VALUES (?,?,NULL)').run(id, iso(now));
  if (m.membership_type === 'subscription') {
    // Metered/unlimited-debt accounting mirrors a real swipe — see swipe() above.
    const dead = rowDaysLeft(m, now) <= 0;
    if (m.sessions_total != null) {
      const base = dead ? Math.min(m.sessions_left, 0) : m.sessions_left;
      db.prepare('UPDATE members SET sessions_left=? WHERE id=?').run(base - 1, id);
    } else if (dead) {
      db.prepare('UPDATE members SET sessions_left=? WHERE id=?').run(Math.min(m.sessions_left ?? 0, 0) - 1, id);
    }
  }
  logActivity(db, user.id, 'member.check_in', m.name, `Manually checked in ${m.name}`);
  return {
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
  };
}

function guestSession(db, { body, user }) {
  const now = new Date();
  const name = (body.name || '').trim() || 'Walk-in';
  const amount = Math.max(0, Math.round(Number(body.amount) || 0));
  // Bill it as a session (counts in today's session revenue + count, by-sport stats).
  // walk_in=1 marks it as an anonymous drop-in for the walk-in reports.
  const pay = db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,walk_in,created_by) VALUES (NULL,?,?,?,?,?,1,?)')
    .run(amount, 'session', 'GYM', 'Cash', iso(now), user.id);
  const expires = new Date(now.getTime() + 2 * 3600 * 1000);   // on the floor for 2 hours
  // Linked to its payment so voiding the charge (a mistake — wrong amount,
  // duplicate entry) can also clear this floor entry.
  db.prepare('INSERT INTO guest_sessions (name,amount,entry_time,expires_at,payment_id) VALUES (?,?,?,?,?)')
    .run(name, amount, iso(now), iso(expires), pay.lastInsertRowid);
  logActivity(db, user.id, 'session.free', name, `Session — ${name} (${amount} DZD)`);
  return {
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
  };
}

function removeGuestSession(db, { params, user }) {
  const id = Number(params[0]);
  const g = db.prepare('SELECT * FROM guest_sessions WHERE id=?').get(id);
  if (!g) throw new HttpError(404, 'Session not found');
  db.prepare('DELETE FROM guest_sessions WHERE id=?').run(id);
  logActivity(db, user.id, 'session.remove', g.name, `Removed session — ${g.name}`);
  return {
    members: allMembers(db),
    presence: presenceList(db),
    exits: exitsList(db),
    today: todayStats(db),
  };
}

function createMember(db, { body, user }) {
  const now = new Date();
  // sub_start/sub_end are calendar days, stored date-only (YYYY-MM-DD).
  const subStart = isoDate(body.subStart || now);
  const subEnd = isoDate(body.subEnd || new Date(ms(subStart) + (body.durationDays ?? 30) * 86400000));
  // Numeric tag UID. AUTOINCREMENT means MAX(id)+1 can reuse an id after the
  // highest member was deleted, which would derive a UID that already exists and
  // hit the UNIQUE constraint. Start from the sequence high-water mark and step
  // until the derived UID is free.
  let rfid = body.rfidUid;
  if (!rfid) {
    const seq = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='members'").get();
    let n = (seq ? seq.seq : 0) + 1;
    do { rfid = String(4200000000 + n * 13); n += 1; }
    while (db.prepare('SELECT 1 FROM members WHERE rfid_uid=?').get(rfid));
  }
  const sports = body.sports || ['GYM'];
  // sessions_total/left carry the quota: NULL ⇒ unlimited sub, a number ⇒ metered sub.
  const sessionsTotal = body.sessionsTotal ?? null;
  const sessionsLeft = body.sessionsLeft != null ? body.sessionsLeft : sessionsTotal;
  // Insurance is a 500 DZD/year fee: enrolling sets a one-year expiry + a payment.
  const insExpiry = body.insurance ? iso(new Date(now.getTime() + INSURANCE_DAYS * 86400000)) : null;
  // Partial payments: `amountPaid` is the cash collected now; `total` (when given)
  // is the full membership fee. Whatever is still owed becomes the member balance.
  const amount = Math.max(0, Math.round(Number(body.amountPaid) || 0));
  const total = body.total != null ? Math.max(0, Math.round(Number(body.total))) : amount;
  const balance = Math.max(0, total - amount);
  const info = db.prepare(
    `INSERT INTO members (rfid_uid,name,gender,dob,phone,blood_type,sports,membership_type,
       sub_start,sub_end,duration_days,sessions_total,sessions_left,
       insurance,insurance_expiry,balance,hue,join_date)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    rfid, body.name, body.gender ?? 'M', body.dob ?? null, body.phone ?? null, body.bloodType ?? null,
    JSON.stringify(sports), body.membershipType ?? 'subscription', subStart, subEnd, body.durationDays ?? 30,
    sessionsTotal, sessionsLeft, body.insurance ? 1 : 0, insExpiry, balance,
    body.hue != null ? body.hue : now.getMilliseconds() % 360, iso(now),
  );
  if (amount) {
    // Nothing existed before this member's own row, so "before" this payment
    // the full fee was owed and nothing was collected yet.
    const snap = JSON.stringify({ before: { balance: total }, after: { balance } });
    db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
      .run(info.lastInsertRowid, amount, 'subscription', sports[0], 'Cash', iso(now), user.id, snap);
  }
  if (body.insurance) {
    const snap = JSON.stringify({ before: { insurance: 0, insurance_expiry: null }, after: { insurance: 1, insurance_expiry: insExpiry } });
    db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
      .run(info.lastInsertRowid, getPricing(db).insurance, 'insurance', null, 'Cash', iso(now), user.id, snap);
  }
  if (body.photo) setMemberPhoto(db, info.lastInsertRowid, body.photo);   // optional portrait
  const plan = sessionsTotal != null ? `metered ${body.durationDays ?? 30}d / ${sessionsTotal} sessions` : `unlimited ${body.durationDays ?? 30}d`;
  logActivity(db, user.id, 'member.create', body.name,
    `Registered member ${body.name} — ${sports.join(', ')}, ${plan}`
    + (amount ? ` (${amount} DZD)` : '') + (balance ? ` — balance due ${balance} DZD` : ''));
  return memberRowToDict(db, getMember(db, info.lastInsertRowid));
}

function updateMember(db, { params, body, user }) {
  const id = Number(params[0]);
  const old = getMember(db, id);
  const now = new Date();
  const sessionsTotal = body.sessionsTotal ?? null;
  const sessionsLeft = body.sessionsLeft ?? null;
  // Enrolling charges 500 DZD for a year; dropping clears the expiry; an unchanged
  // enrollment keeps its expiry (yearly renewals go through /members/:id/insurance).
  const wasInsured = !!old.insurance;
  const nowInsured = !!body.insurance;
  const insExpiry = nowInsured
    ? (wasInsured ? old.insurance_expiry : iso(new Date(now.getTime() + INSURANCE_DAYS * 86400000)))
    : null;
  const changed = [];
  if (body.name !== old.name) changed.push('name');
  if (body.gender !== old.gender) changed.push('gender');
  if ((body.dob || null) !== old.dob) changed.push('date of birth');
  if ((body.phone || null) !== old.phone) changed.push('phone');
  if ((body.bloodType || null) !== old.blood_type) changed.push('blood type');
  if (JSON.stringify(body.sports) !== old.sports) changed.push('sports');
  if (body.membershipType !== old.membership_type) changed.push('membership type');
  if (body.durationDays !== old.duration_days) changed.push('duration');
  if (sessionsTotal !== old.sessions_total) changed.push('sessions');
  if (nowInsured !== wasInsured) changed.push(nowInsured ? 'insurance enrolled' : 'insurance dropped');
  if (body.rfidUid && body.rfidUid !== old.rfid_uid) changed.push('RFID tag');

  db.prepare(
    `UPDATE members SET name=?,gender=?,dob=?,phone=?,blood_type=?,sports=?,membership_type=?,
       sub_start=COALESCE(?,sub_start),sub_end=COALESCE(?,sub_end),duration_days=?,
       sessions_total=?,sessions_left=?,insurance=?,insurance_expiry=?,
       rfid_uid=COALESCE(?,rfid_uid)
     WHERE id=?`,
  ).run(
    body.name, body.gender, body.dob ?? null, body.phone ?? null, body.bloodType ?? null, JSON.stringify(body.sports),
    body.membershipType, body.subStart ? isoDate(body.subStart) : null, body.subEnd ? isoDate(body.subEnd) : null, body.durationDays,
    sessionsTotal, sessionsLeft, nowInsured ? 1 : 0, insExpiry,
    body.rfidUid ?? null, id,
  );
  if (nowInsured && !wasInsured) {
    const snap = JSON.stringify({ before: { insurance: 0, insurance_expiry: null }, after: { insurance: 1, insurance_expiry: insExpiry } });
    db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, getPricing(db).insurance, 'insurance', null, 'Cash', iso(now), user.id, snap);
  }
  // photo: a data URL replaces it, null clears it, undefined (omitted) leaves it.
  if (body.photo !== undefined) { setMemberPhoto(db, id, body.photo); changed.push(body.photo ? 'photo' : 'photo removed'); }
  const detail = changed.length ? `Edited member ${body.name} — ${changed.join(', ')}` : `Edited member ${body.name} — no changes`;
  logActivity(db, user.id, 'member.update', body.name, detail);
  return memberRowToDict(db, getMember(db, id));
}

// Pay the yearly 500 DZD insurance — enrols if needed, or renews once it has
// expired. You cannot pre-pay while it's still active (no stacking years).
function payInsurance(db, { params, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const now = new Date();
  if (m.insurance && m.insurance_expiry && ms(m.insurance_expiry) > now.getTime()) {
    throw new HttpError(400, 'Insurance is still active — renew only once it expires');
  }
  const expiry = iso(new Date(now.getTime() + INSURANCE_DAYS * 86400000));
  const insurancePrice = getPricing(db).insurance;
  const snap = JSON.stringify({
    before: { insurance: m.insurance ? 1 : 0, insurance_expiry: m.insurance_expiry },
    after: { insurance: 1, insurance_expiry: expiry },
  });
  db.prepare('UPDATE members SET insurance=1, insurance_expiry=? WHERE id=?').run(expiry, id);
  db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, insurancePrice, 'insurance', null, 'Cash', iso(now), user.id, snap);
  logActivity(db, user.id, 'member.insurance', m.name, `Insurance paid for ${m.name} — ${insurancePrice} DZD (valid to ${expiry.slice(0, 10)})`);
  return memberRowToDict(db, getMember(db, id));
}

function deleteMember(db, { params, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  db.prepare('DELETE FROM members WHERE id=?').run(id);
  logActivity(db, user.id, 'member.delete', m.name, `Deleted member ${m.name} (${m.rfid_uid})`);
  return { ok: true };
}

function renewMember(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const now = new Date();
  // Snapshot every field a renewal can touch, before any of it changes — this is
  // what lets a later void restore exactly, rather than guessing an inverse.
  const before = {
    sub_start: m.sub_start, sub_end: m.sub_end, duration_days: m.duration_days,
    sessions_total: m.sessions_total, sessions_left: m.sessions_left, balance: m.balance, sports: m.sports,
  };
  const after = { ...before };
  // A renewal can extend the date, top up sessions, or (for metered subs) both.
  const parts = [];
  // Renewal is also the moment a member can switch membership type (e.g. GYM ⇄
  // GYM + CARDIO) — only applied when it actually differs from the current one.
  if (body.sports) {
    const sportsJson = JSON.stringify(body.sports);
    if (sportsJson !== m.sports) {
      after.sports = sportsJson;
      db.prepare('UPDATE members SET sports=? WHERE id=?').run(sportsJson, id);
      parts.push(`type changed to ${body.sports.join(' + ')}`);
    }
  }
  if (body.days) {
    const base = Math.max(now.getTime(), ms(m.sub_end));
    // sub_start moves to the same anchor: it should read as "start of the
    // current paid period," not freeze at the member's very first subscription.
    after.sub_start = isoDate(new Date(base));
    after.sub_end = isoDate(new Date(base + body.days * 86400000));
    after.duration_days = body.days;
    db.prepare('UPDATE members SET sub_start=?, sub_end=?, duration_days=? WHERE id=?')
      .run(after.sub_start, after.sub_end, after.duration_days, id);
    parts.push(`+${body.days} days`);
  }
  if (body.applyPlan) {
    // Renew the weekly plan for the new period: set the quota outright (NULL ⇒ unlimited).
    // Carry forward any owed sessions (sessions_left went negative — the club let
    // the member train past their quota) by deducting the debt from the new block
    // instead of silently forgiving it. Going unlimited (total null) clears any
    // debt — an unlimited plan never meters sessions, so there'd be no way to
    // work it off.
    const planTotal = body.sessionsTotal ?? null;
    const owed = Math.min(0, m.sessions_left ?? 0);
    const newLeft = planTotal == null ? null : planTotal + owed;
    after.sessions_total = planTotal;
    after.sessions_left = newLeft;
    db.prepare('UPDATE members SET sessions_total=?, sessions_left=? WHERE id=?').run(planTotal, newLeft, id);
    parts.push(planTotal == null ? 'unlimited access' : `${planTotal} sessions`);
    if (owed) parts.push(`${-owed} owed session(s) carried over`);
  } else if (body.sessions) {
    after.sessions_total = (m.sessions_total || 0) + body.sessions;
    after.sessions_left = (m.sessions_left || 0) + body.sessions;
    db.prepare('UPDATE members SET sessions_total=COALESCE(sessions_total,0)+?, sessions_left=COALESCE(sessions_left,0)+? WHERE id=?')
      .run(body.sessions, body.sessions, id);
    parts.push(`+${body.sessions} sessions`);
  }
  if (!parts.length) throw new HttpError(400, 'Provide days or sessions');
  // Date extension ⇒ subscription revenue; sessions-only ⇒ pay-per-session.
  const kind = body.days ? 'subscription' : 'session';
  // Partial payment: `amount` is cash collected now; `total` (when given) is the
  // full renewal fee. Any shortfall is added to the member's running balance.
  const amount = Math.max(0, Math.round(Number(body.amount) || 0));
  const total = body.total != null ? Math.max(0, Math.round(Number(body.total))) : amount;
  const owedNow = Math.max(0, total - amount);
  if (owedNow) {
    after.balance = m.balance + owedNow;
    db.prepare('UPDATE members SET balance=balance+? WHERE id=?').run(owedNow, id);
    parts.push(`balance due ${owedNow} DZD`);
  }
  const detail = `Renewed ${m.name}: ${parts.join(', ')}`;
  if (amount) {
    const snap = JSON.stringify({ before, after });
    db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, amount, kind, JSON.parse(after.sports)[0], 'Cash', iso(now), user.id, snap);
  }
  logActivity(db, user.id, 'member.renew', m.name, detail + (amount ? ` (${amount} DZD)` : ''));
  return memberRowToDict(db, getMember(db, id));
}

// Collect (part of) an outstanding membership balance. Records the cash as
// subscription revenue and draws the member's balance down, never below zero.
function payBalance(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const now = new Date();
  if (!m.balance || m.balance <= 0) throw new HttpError(400, 'No outstanding balance to collect');
  // Default to clearing the whole balance; cap a larger amount at what is owed.
  const requested = body.amount != null ? Math.round(Number(body.amount)) : m.balance;
  const amount = Math.min(m.balance, Math.max(0, requested));
  if (!amount) throw new HttpError(400, 'Enter an amount greater than zero');
  const snap = JSON.stringify({ before: { balance: m.balance }, after: { balance: m.balance - amount } });
  db.prepare('UPDATE members SET balance=balance-? WHERE id=?').run(amount, id);
  db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,balance_payment,created_by,member_snapshot) VALUES (?,?,?,?,?,?,1,?,?)')
    .run(id, amount, 'subscription', JSON.parse(m.sports)[0], 'Cash', iso(now), user.id, snap);
  const left = m.balance - amount;
  logActivity(db, user.id, 'member.balance', m.name,
    `Collected ${amount} DZD from ${m.name}` + (left ? ` — ${left} DZD still owed` : ' — balance cleared'));
  return memberRowToDict(db, getMember(db, id));
}

// Collect (part of) a member's owed sessions (sessions_left negative — the club
// let them train past their quota) directly, without waiting for their next
// renewal. Staff types both the session count being settled and the price
// collected — a one-off reconciliation, not tied to any configured session rate.
function collectSessions(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = getMember(db, id);
  const owed = m.sessions_left < 0 ? -m.sessions_left : 0;
  if (!owed) throw new HttpError(400, 'No owed sessions to collect');
  // Default to clearing every owed session; cap a larger amount at what is owed.
  const requested = body.sessions != null ? Math.round(Number(body.sessions)) : owed;
  const sessions = Math.min(owed, Math.max(0, requested));
  if (!sessions) throw new HttpError(400, 'Enter a number of sessions greater than zero');
  const amount = Math.max(0, Math.round(Number(body.amount) || 0));
  db.prepare('UPDATE members SET sessions_left=sessions_left+? WHERE id=?').run(sessions, id);
  if (amount) {
    const snap = JSON.stringify({ before: { sessions_left: m.sessions_left }, after: { sessions_left: m.sessions_left + sessions } });
    db.prepare('INSERT INTO payments (member_id,amount,kind,sport,method,date,created_by,member_snapshot) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, amount, 'session', JSON.parse(m.sports)[0], 'Cash', iso(new Date()), user.id, snap);
  }
  const left = owed - sessions;
  logActivity(db, user.id, 'member.sessions', m.name,
    `Collected ${sessions} owed session(s) from ${m.name}`
    + (amount ? ` (${amount} DZD)` : '') + (left ? ` — ${left} session(s) still owed` : ' — session debt cleared'));
  return memberRowToDict(db, getMember(db, id));
}

function memberEntries(db, { params, query }) {
  const id = Number(params[0]);
  const limit = query && query.limit ? Number(query.limit) : 10;
  getMember(db, id);
  return db.prepare(
    'SELECT entry_time, exit_time FROM entries WHERE member_id=? AND exit_time IS NOT NULL ORDER BY entry_time DESC LIMIT ?',
  ).all(id, limit).map((r) => ({ entryTime: ms(r.entry_time), exitTime: ms(r.exit_time) }));
}

// A member's payment history — the surface staff correct mistakes from. Newest
// first; includes voided originals and their reversal rows so the ledger reads
// as a full audit trail, not just the net.
function memberPayments(db, { params }) {
  const id = Number(params[0]);
  getMember(db, id);
  return db.prepare('SELECT * FROM payments WHERE member_id=? ORDER BY date DESC, id DESC').all(id)
    .map((r) => paymentRowToDict(db, r));
}

// Void a payment: restores the member fields it touched (from its stored
// before/after snapshot) and posts an equal-and-opposite reversal row, so every
// report that sums `payments.amount` nets out correctly with no query changes.
// Refuses if something else has since changed the same member fields (a later
// renewal, session use, or balance collection) — restoring blindly would
// silently clobber that later, legitimate activity.
function voidPayment(db, { params, body, user }) {
  const id = Number(params[0]);
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) throw new HttpError(404, 'Payment not found');
  if (p.voided_at) throw new HttpError(400, 'This payment has already been voided');
  if (p.reverses_payment_id != null) throw new HttpError(400, 'Cannot void a reversal entry');
  const reason = (body.reason || '').trim();
  if (!reason) throw new HttpError(400, 'A reason is required');
  if (!canCorrect(db, user, p.date, p.created_by)) {
    const win = getCorrectionSettings(db).windowHours;
    throw new HttpError(403, p.created_by === user.id
      ? `This payment is more than ${win}h old — ask an administrator to void it`
      : 'Only an administrator can void a payment recorded by someone else');
  }

  let snap = null;
  if (p.member_snapshot) { try { snap = JSON.parse(p.member_snapshot); } catch { snap = null; } }
  let member = null;
  if (p.member_id != null) {
    member = db.prepare('SELECT * FROM members WHERE id=?').get(p.member_id);
    if (member && snap && snap.after) {
      const mismatch = Object.keys(snap.after).some((col) => String(member[col]) !== String(snap.after[col]));
      if (mismatch) {
        throw new HttpError(409, 'Something else has changed this member\'s account since this payment '
          + '(a later renewal, session use, or balance collection) — an administrator must make a manual adjustment instead');
      }
      const sets = Object.keys(snap.before).map((col) => `${col}=?`).join(',');
      db.prepare(`UPDATE members SET ${sets} WHERE id=?`).run(...Object.values(snap.before), p.member_id);
    }
  }

  const now = iso(new Date());
  db.prepare('UPDATE payments SET voided_at=? WHERE id=?').run(now, id);
  const reversal = db.prepare(
    `INSERT INTO payments (member_id,amount,kind,sport,method,date,walk_in,balance_payment,created_by,reverses_payment_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(p.member_id, -p.amount, p.kind, p.sport, p.method, now, p.walk_in, p.balance_payment, user.id, p.id);

  db.prepare(
    'INSERT INTO corrections (payment_id,action,reason,user_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(p.id, 'void', reason, user.id, snap ? JSON.stringify(snap.before) : null, snap ? JSON.stringify(snap.after) : null, now);

  // A voided walk-in charge shouldn't leave its guest still counted on the
  // floor for free — clear the linked entry (a no-op for member payments).
  db.prepare('DELETE FROM guest_sessions WHERE payment_id=?').run(p.id);

  const label = member ? member.name : `Payment #${p.id}`;
  logActivity(db, user.id, 'payment.void', label,
    `Voided ${p.amount} DZD ${p.kind} payment${member ? ` for ${member.name}` : ''} — ${reason}`);

  return {
    payment: paymentRowToDict(db, db.prepare('SELECT * FROM payments WHERE id=?').get(id)),
    reversal: paymentRowToDict(db, db.prepare('SELECT * FROM payments WHERE id=?').get(reversal.lastInsertRowid)),
    member: p.member_id != null ? memberRowToDict(db, getMember(db, p.member_id)) : null,
    presence: presenceList(db),
  };
}

// Revenue-by-category presentation + mapping, shared by the Statistics YTD view
// and the date-filtered dashboard panels. Subscriptions map to the member's
// category; sessions / walk-ins roll up into "Gym sessions".
const CAT_LABEL = {
  GYM: 'Gym', GYM_CARDIO: 'Gym + Cardio', CARDIO: 'Cardio',
  JUDO: 'Judo', WRESTLING: 'Wrestling', GYM_SESSIONS: 'Gym sessions',
};
// Deliberately well-separated hues so adjacent slices never read as "the same".
const CAT_COLOR = {
  GYM: '#22C55E', GYM_CARDIO: '#F59E0B', CARDIO: '#06B6D4',
  JUDO: '#6366F1', WRESTLING: '#A855F7', GYM_SESSIONS: '#EF4444',
};
const CAT_ORDER = ['GYM', 'GYM_CARDIO', 'CARDIO', 'JUDO', 'WRESTLING', 'GYM_SESSIONS'];
const catOf = (sportsJson) => {
  let arr = [];
  try { arr = JSON.parse(sportsJson) || []; } catch { arr = []; }
  const s = new Set(arr);
  if (s.has('JUDO')) return 'JUDO';
  if (s.has('WRESTLING')) return 'WRESTLING';
  if (s.has('GYM') && s.has('CARDIO')) return 'GYM_CARDIO';
  if (s.has('CARDIO')) return 'CARDIO';
  return 'GYM';
};
// Deleted members leave orphaned payments (m.sports NULL). Fall back to the sport
// recorded on the payment so subscription revenue keeps its category.
const sportCat = (sp) => (sp === 'JUDO' ? 'JUDO' : sp === 'WRESTLING' ? 'WRESTLING' : sp === 'CARDIO' ? 'CARDIO' : 'GYM');

function stats(db) {
  const now = new Date();
  const yearStart = iso(new Date(now.getFullYear(), 0, 1, 0, 0, 0));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const daily = (year, month) => {
    const nDays = new Date(year, month, 0).getDate();
    const rows = db.prepare(
      "SELECT CAST(strftime('%d', date) AS INT) d, SUM(amount) s FROM payments WHERE strftime('%Y-%m', date)=? GROUP BY d",
    ).all(`${year}-${pad(month)}`);
    const byDay = {};
    rows.forEach((r) => { byDay[r.d] = r.s; });
    return Array.from({ length: nDays }, (_, d) => byDay[d + 1] || 0);
  };

  let curDaily = daily(now.getFullYear(), now.getMonth() + 1);
  curDaily = curDaily.map((v, i) => (i < now.getDate() ? v : null));
  const prevY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const prevM = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevDaily = daily(prevY, prevM);

  const monthlyRows = db.prepare(
    "SELECT CAST(strftime('%m', date) AS INT) m, SUM(amount) s FROM payments WHERE strftime('%Y', date)=? GROUP BY m",
  ).all(String(now.getFullYear()));
  const byMonth = {};
  monthlyRows.forEach((r) => { byMonth[r.m] = r.s; });
  const revenueMonthly = months.map((mo, i) => ({ month: mo, value: byMonth[i + 1] || 0, tip: `${now.getFullYear()}-${pad(i + 1)}` }));

  // Revenue by membership category (YTD) — CAT_* mapping + catOf/sportCat are
  // module-level so the date-filtered /stats/panel endpoint reuses them.
  const catTotals = Object.fromEntries(CAT_ORDER.map((k) => [k, 0]));
  db.prepare(
    'SELECT p.kind kind, p.sport sport, m.sports msports, SUM(p.amount) s '
    + 'FROM payments p LEFT JOIN members m ON m.id = p.member_id '
    + "WHERE p.date>=? AND p.kind IN ('subscription','session') GROUP BY p.kind, p.sport, m.sports",
  ).all(yearStart).forEach((r) => {
    const cat = r.kind === 'session'
      ? 'GYM_SESSIONS'
      : (r.msports ? catOf(r.msports) : sportCat(r.sport));
    catTotals[cat] += r.s;
  });
  const revenueBySport = CAT_ORDER
    .filter((k) => catTotals[k] > 0)
    .map((k) => ({ label: CAT_LABEL[k], value: catTotals[k], color: CAT_COLOR[k] }));

  const split = {
    subscriptions: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='subscription' AND date>=?").get(yearStart).s,
    sessions: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='session' AND date>=?").get(yearStart).s,
  };

  // Cumulative member growth — running total of registered members at the end of
  // each month this year (Jan … current month). Resets axis with the calendar year.
  const memberGrowth = [];
  for (let mo = 0; mo <= now.getMonth(); mo++) {
    const monthEnd = iso(new Date(now.getFullYear(), mo + 1, 1, 0, 0, 0));
    const c = db.prepare('SELECT COUNT(*) c FROM members WHERE join_date < ?').get(monthEnd).c;
    memberGrowth.push({ month: months[mo], value: c });
  }

  // Revenue trend over the last 12 weeks — for the owner's day/week/month toggle.
  const revenueWeekly = [];
  for (let w = 11; w >= 0; w--) {
    const start = new Date(now.getTime() - (w + 1) * 7 * 86400000);
    const a = iso(start);
    const b = iso(new Date(now.getTime() - w * 7 * 86400000));
    const s = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE date>=? AND date<?').get(a, b).s;
    revenueWeekly.push({ week: `W${12 - w}`, value: s, tip: `${start.getFullYear()}-${pad(start.getMonth() + 1)} W${isoWeek(start)}` });
  }

  // Revenue per day over the last 30 days.
  const since30 = iso(new Date(now.getTime() - 30 * 86400000));
  const dayRows = db.prepare('SELECT date(date) d, SUM(amount) s FROM payments WHERE date>=? GROUP BY date(date)').all(since30);
  const byDate = {};
  dayRows.forEach((r) => { byDate[r.d] = r.s; });
  const revenueDaily30 = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const key = iso(day).slice(0, 10);
    revenueDaily30.push({ day: String(day.getDate()), value: byDate[key] || 0, date: key });
  }

  const totalMembers = db.prepare('SELECT COUNT(*) c FROM members').get().c || 1;
  const retention = [];
  for (let i = 0; i < 6; i++) {
    let mo = now.getMonth() + 1 - 5 + i;
    const yr = now.getFullYear() + Math.floor((mo - 1) / 12);
    mo = ((mo - 1) % 12 + 12) % 12 + 1;
    const renewed = db.prepare("SELECT COUNT(DISTINCT member_id) c FROM payments WHERE strftime('%Y-%m', date)=?")
      .get(`${yr}-${pad(mo)}`).c;
    retention.push({ month: months[mo - 1], renewed: Math.min(96, Math.round(renewed / totalMembers * 100)) });
  }

  // Heatmap hours run 08h–22h inclusive (15 columns).
  const heat = Array.from({ length: 7 }, () => new Array(15).fill(0));
  db.prepare('SELECT entry_time FROM entries WHERE entry_time>=?').all(iso(new Date(now.getTime() - 60 * 86400000)))
    .forEach((r) => {
      const dt = new Date(r.entry_time);
      const dow = dt.getDay();             // JS-style: Sunday = 0
      if (dt.getHours() >= 8 && dt.getHours() <= 22) heat[dow][dt.getHours() - 8] += 1;
    });

  const monthAgo = iso(new Date(now.getTime() - 30 * 86400000));
  const topRows = db.prepare(
    'SELECT member_id, COUNT(*) visits, '
    + "AVG((julianday(COALESCE(exit_time, datetime('now')))-julianday(entry_time))*1440) avg_min "
    + 'FROM entries WHERE entry_time>=? GROUP BY member_id ORDER BY visits DESC LIMIT 10',
  ).all(monthAgo);
  const topVisitors = topRows.map((r) => ({
    member: memberRowToDict(db, getMember(db, r.member_id)),
    visits: r.visits, avgMin: Math.round(r.avg_min || 0),
  }));
  const avgMin = db.prepare(
    'SELECT AVG((julianday(exit_time)-julianday(entry_time))*1440) a FROM entries WHERE exit_time IS NOT NULL AND entry_time>=?',
  ).get(monthAgo).a;

  const members = allMembers(db);

  // "Expiring soon" / "Sessions owed" use the centralized rule (helpers up top),
  // so the Statistics page and the live-floor cards never drift apart.
  const expiringSoon = members
    .map((m) => { const reason = expiringReason(m); return reason ? { ...m, reason, daysLeft: subDaysLeft(m) } : null; })
    .filter(Boolean);
  const owed = members.filter(isOwed);

  const inactive = members.filter((m) => (now.getTime() - ms(m.lastVisit)) / 86400000 > 90);

  return {
    revenueDaily: { current: curDaily, previous: prevDaily },
    revenueMonthly,
    revenueWeekly,
    revenueDaily30,
    revenueBySport,
    revenueSplit: split,
    memberGrowth,
    retention,
    heatmap: heat,
    topVisitors,
    avgSessionMin: Math.round(avgMin || 0),
    expiringSoon,
    owed,
    inactive,
    revenueYtd: split.subscriptions + split.sessions,
  };
}

// ── Date-filtered dashboard panels ────────────────────────────────────────────
// Each filterable Statistics panel carries its own before/after picker; this
// recomputes a single panel's dataset for an arbitrary [after, before] window.
// Bounds are optional 'YYYY-MM-DD' query params; payments/entries store
// 'YYYY-MM-DDThh:mm:ss', so a lexical day-boundary compare is exact (before
// includes its whole day). Omit both bounds for the all-time dataset.
function dayRange(query) {
  return {
    after: query.after ? `${query.after}T00:00:00` : null,
    before: query.before ? `${query.before}T23:59:59` : null,
  };
}
function whereRange(col, after, before, extra) {
  const parts = [];
  const args = [];
  if (after) { parts.push(`${col} >= ?`); args.push(after); }
  if (before) { parts.push(`${col} <= ?`); args.push(before); }
  if (extra) parts.push(extra);
  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', args };
}

// Revenue split by membership category over [after, before], plus the
// subscriptions/sessions totals for the same window (for the footer percentages).
function panelRevenueBySport(db, after, before) {
  const { clause, args } = whereRange('p.date', after, before, "p.kind IN ('subscription','session')");
  const catTotals = Object.fromEntries(CAT_ORDER.map((k) => [k, 0]));
  db.prepare(
    'SELECT p.kind kind, p.sport sport, m.sports msports, SUM(p.amount) s '
    + 'FROM payments p LEFT JOIN members m ON m.id = p.member_id '
    + `${clause} GROUP BY p.kind, p.sport, m.sports`,
  ).all(...args).forEach((r) => {
    const cat = r.kind === 'session' ? 'GYM_SESSIONS' : (r.msports ? catOf(r.msports) : sportCat(r.sport));
    catTotals[cat] += r.s;
  });
  const bySport = CAT_ORDER
    .filter((k) => catTotals[k] > 0)
    .map((k) => ({ label: CAT_LABEL[k], value: catTotals[k], color: CAT_COLOR[k] }));
  const sumKind = (kind) => {
    const w = whereRange('date', after, before, `kind='${kind}'`);
    return db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM payments ${w.clause}`).get(...w.args).s;
  };
  return { bySport, subscriptions: sumKind('subscription'), sessions: sumKind('session') };
}

// Cumulative registered-member total at each month-end in [after, before]
// (defaults to Jan 1 → today). Labels carry a 2-digit year when the span crosses years.
function panelMemberGrowth(db, after, before) {
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const now = new Date();
  const start = after ? new Date(after) : new Date(now.getFullYear(), 0, 1);
  const end = before ? new Date(before) : now;
  const spansYears = start.getFullYear() !== end.getFullYear();
  const out = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  // Cap at 120 buckets (10y) so a wild range can't loop unbounded.
  for (let i = 0; i < 120 && (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())); i++) {
    const monthEnd = iso(new Date(y, m + 1, 1, 0, 0, 0));
    const c = db.prepare('SELECT COUNT(*) c FROM members WHERE join_date < ?').get(monthEnd).c;
    out.push({ month: spansYears ? `${MON[m]} '${String(y).slice(2)}` : MON[m], value: c });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

// A single calendar day's revenue, broken down into the three payment kinds
// (not a full transaction list — too noisy for a busy day). Mirrors the
// unfiltered (all kinds) sum used by the "Revenue this day" KPI.
function panelRevenueByDay(db, day) {
  const d = day || iso(new Date()).slice(0, 10);
  const after = `${d}T00:00:00`;
  const before = `${d}T23:59:59`;
  const sumKind = (kind) => db.prepare(
    'SELECT COALESCE(SUM(amount),0) s FROM payments WHERE date>=? AND date<=? AND kind=?',
  ).get(after, before, kind).s;
  const sessions = sumKind('session');
  const subscriptions = sumKind('subscription');
  const insurance = sumKind('insurance');
  return { day: d, total: sessions + subscriptions + insurance, sessions, subscriptions, insurance };
}

// Entries-by-hour×day heatmap (08h–22h, 15 cols) over [after, before].
function panelHeatmap(db, after, before) {
  const { clause, args } = whereRange('entry_time', after, before);
  const heat = Array.from({ length: 7 }, () => new Array(15).fill(0));
  db.prepare(`SELECT entry_time FROM entries ${clause}`).all(...args).forEach((r) => {
    const dt = new Date(r.entry_time);
    if (dt.getHours() >= 8 && dt.getHours() <= 22) heat[dt.getDay()][dt.getHours() - 8] += 1;
  });
  return heat;
}

// Top 10 most frequent visitors (by entry count) within [after, before].
function panelTopVisitors(db, after, before) {
  const { clause, args } = whereRange('entry_time', after, before, 'member_id IS NOT NULL');
  return db.prepare(
    'SELECT member_id, COUNT(*) visits, '
    + "AVG((julianday(COALESCE(exit_time, datetime('now')))-julianday(entry_time))*1440) avg_min "
    + `FROM entries ${clause} GROUP BY member_id ORDER BY visits DESC LIMIT 10`,
  ).all(...args).map((r) => ({
    member: memberRowToDict(db, getMember(db, r.member_id)),
    visits: r.visits,
    avgMin: Math.round(r.avg_min || 0),
  }));
}

function statsPanel(db, { query = {} }) {
  const { after, before } = dayRange(query);
  switch (query.metric) {
    case 'revenueBySport': return { data: panelRevenueBySport(db, after, before) };
    case 'memberGrowth': return { data: panelMemberGrowth(db, after, before) };
    case 'revenueByDay': return { data: panelRevenueByDay(db, query.day) };
    case 'heatmap': return { data: panelHeatmap(db, after, before) };
    case 'topVisitors': return { data: panelTopVisitors(db, after, before) };
    default: throw new HttpError(400, 'Unknown metric');
  }
}

// Member reports — detailed session-revenue and insurance breakdowns. All money
// comes from the payments table (members only; stock never touches it).
function memberReports(db) {
  const now = new Date();
  const year = String(now.getFullYear());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yearStart = iso(new Date(now.getFullYear(), 0, 1, 0, 0, 0));
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0));
  const todayStart = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
  const nowIso = iso(now);

  // ── Walk-in session reports — the "+ Session" button only ─────────────────────
  // These are one-off, non-member drop-ins flagged at the till (walk_in=1). Using
  // the flag — not member_id IS NULL — means a deleted member's orphaned session
  // payments are never miscounted here as walk-ins.
  const SESS = "kind='session' AND walk_in=1";
  const sAgg = (clause, ...args) => db.prepare(
    `SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE ${SESS}${clause}`,
  ).get(...args);
  const sYtd = sAgg(' AND date>=?', yearStart);
  const sMonth = sAgg(' AND date>=?', monthStart);
  const sToday = sAgg(' AND date>=?', todayStart);
  const sAll = sAgg('');

  const sMonthRows = db.prepare(
    "SELECT CAST(strftime('%m', date) AS INT) m, COUNT(*) c, SUM(amount) s "
    + `FROM payments WHERE ${SESS} AND strftime('%Y', date)=? GROUP BY m`,
  ).all(year);
  const sByMonth = {};
  sMonthRows.forEach((r) => { sByMonth[r.m] = r; });
  const sessionMonthly = months.map((mo, i) => ({ month: mo, count: sByMonth[i + 1]?.c || 0, value: sByMonth[i + 1]?.s || 0 }));

  const since30 = iso(new Date(now.getTime() - 30 * 86400000));
  const sDayRows = db.prepare(
    `SELECT date(date) d, COUNT(*) c, SUM(amount) s FROM payments WHERE ${SESS} AND date>=? GROUP BY date(date)`,
  ).all(since30);
  const sByDate = {};
  sDayRows.forEach((r) => { sByDate[r.d] = r; });
  const sessionDaily = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now.getTime() - d * 86400000);
    const key = iso(day).slice(0, 10);
    sessionDaily.push({ day: String(day.getDate()), date: key, count: sByDate[key]?.c || 0, value: sByDate[key]?.s || 0 });
  }

  // ── Insurance reports (kind='insurance' revenue + member coverage) ────────────
  const totalMembers = db.prepare('SELECT COUNT(*) c FROM members').get().c;
  const insuredCount = db.prepare('SELECT COUNT(*) c FROM members WHERE insurance=1 AND insurance_expiry > ?').get(nowIso).c;
  const lapsedCount = db.prepare('SELECT COUNT(*) c FROM members WHERE insurance=1 AND (insurance_expiry IS NULL OR insurance_expiry <= ?)').get(nowIso).c;
  const in30 = iso(new Date(now.getTime() + 30 * 86400000));
  const expiringSoon = db.prepare('SELECT COUNT(*) c FROM members WHERE insurance=1 AND insurance_expiry > ? AND insurance_expiry <= ?').get(nowIso, in30).c;

  const iYtd = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE kind='insurance' AND date>=?").get(yearStart);
  const iAll = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount),0) s FROM payments WHERE kind='insurance'").get();
  const iMonth = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM payments WHERE kind='insurance' AND date>=?").get(monthStart).s;
  const iMonthRows = db.prepare(
    "SELECT CAST(strftime('%m', date) AS INT) m, COUNT(*) c, SUM(amount) s "
    + "FROM payments WHERE kind='insurance' AND strftime('%Y', date)=? GROUP BY m",
  ).all(year);
  const iByMonth = {};
  iMonthRows.forEach((r) => { iByMonth[r.m] = r; });
  const insuranceMonthly = months.map((mo, i) => ({ month: mo, count: iByMonth[i + 1]?.c || 0, value: iByMonth[i + 1]?.s || 0 }));

  return {
    sessions: {
      countYtd: sYtd.c, revenueYtd: sYtd.s,
      countMonth: sMonth.c, revenueMonth: sMonth.s,
      countToday: sToday.c, revenueToday: sToday.s,
      countAllTime: sAll.c, revenueAllTime: sAll.s,
      avgPrice: sYtd.c ? Math.round(sYtd.s / sYtd.c) : 0,
      monthly: sessionMonthly,
      daily: sessionDaily,
    },
    insurance: {
      feePerYear: getPricing(db).insurance,
      totalMembers,
      insuredCount,
      notInsuredCount: totalMembers - insuredCount,
      lapsedCount,
      expiringSoon,
      coverageRate: Math.round((insuredCount / Math.max(1, totalMembers)) * 100),
      revenueYtd: iYtd.s,
      countYtd: iYtd.c,
      revenueMonth: iMonth,
      revenueAllTime: iAll.s,
      countAllTime: iAll.c,
      monthly: insuranceMonthly,
    },
  };
}

// Distinct hue per stock category — shared by the category donut, the daily
// breakdown, and the date-filtered /reports/stock/panel endpoint.
const STOCK_CAT_COLOR = {
  Equipment: '#6366F1', Supplements: '#22C55E', Consumables: '#06B6D4',
  Merchandise: '#F59E0B', Maintenance: '#A855F7',
};

// Stock dashboard — sales / profit / loss for the current calendar month.
// Buy & sell prices come from the item (joined), so figures track the catalogue.
function stockDashboard(db) {
  const now = new Date();
  const year = String(now.getFullYear());
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0));
  const yearStart = iso(new Date(now.getFullYear(), 0, 1, 0, 0, 0));
  // Revenue of a sold row: the logged sale price, else fall back to qty × sell.
  const REV = 'COALESCE(sl.cost, sl.qty * si.sell)';
  const SOLD = 'FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id '
    + "WHERE sl.action='remove' AND sl.reason='Sold'";

  // Sold this month: revenue (logged sale price, else qty×sell), units, and COGS.
  // "units" counts a weight sale (sold by the gram) as one item, not its gram count,
  // so a 200 g scoop doesn't read as 200 units. Money columns stay gram-accurate
  // because buy/sell are per-gram for weight items (qty grams × per-gram price).
  const UNITS = "SUM(CASE WHEN si.unit='g' THEN 1 ELSE sl.qty END)";
  const sold = db.prepare(
    'SELECT COALESCE(SUM(COALESCE(sl.cost, sl.qty * si.sell)),0) rev, '
    + `COALESCE(${UNITS},0) units, COALESCE(SUM(sl.qty * si.buy),0) cogs `
    + 'FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id '
    + "WHERE sl.action='remove' AND sl.reason='Sold' AND sl.date>=?",
  ).get(monthStart);

  // Write-offs this month, valued at purchase cost.
  const loss = db.prepare(
    `SELECT COALESCE(SUM(sl.qty * si.buy),0) val, COALESCE(${UNITS},0) units `
    + 'FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id '
    + "WHERE sl.action='remove' AND sl.reason IN ('Damaged','Expired') AND sl.date>=?",
  ).get(monthStart);

  const revenue = sold.rev;
  const grossProfit = revenue - sold.cogs;
  // Current inventory value — at purchase cost (capital tied up) and at sale price
  // (what it's worth on the shelf); the gap is the unrealized markup.
  const stockValue = db.prepare('SELECT COALESCE(SUM(qty * buy),0) v FROM stock_items').get().v;
  const stockValueSale = db.prepare('SELECT COALESCE(SUM(qty * sell),0) v FROM stock_items').get().v;

  // Sales revenue by month (this year).
  const mRows = db.prepare(
    `SELECT CAST(strftime('%m', sl.date) AS INT) m, COALESCE(SUM(${REV}),0) s ${SOLD} AND strftime('%Y', sl.date)=? GROUP BY m`,
  ).all(year);
  const byMonth = {};
  mRows.forEach((r) => { byMonth[r.m] = r.s; });
  const monthly = months.map((mo, i) => ({ month: mo, value: byMonth[i + 1] || 0 }));

  // Sales revenue by day (last 30 days), with a per-category breakdown for the tooltip.
  const since30 = iso(new Date(now.getTime() - 30 * 86400000));
  const dRows = db.prepare(
    `SELECT date(sl.date) d, si.category cat, COALESCE(SUM(${REV}),0) s ${SOLD} AND sl.date>=? GROUP BY date(sl.date), si.category`,
  ).all(since30);
  const byDate = {};
  dRows.forEach((r) => {
    const e = byDate[r.d] || (byDate[r.d] = { total: 0, cats: {} });
    e.total += r.s;
    e.cats[r.cat] = (e.cats[r.cat] || 0) + r.s;
  });
  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86400000);
    const key = iso(day).slice(0, 10);
    const e = byDate[key];
    const breakdown = e
      ? Object.entries(e.cats).map(([cat, val]) => ({ label: cat, value: val, color: STOCK_CAT_COLOR[cat] || '#22C55E' }))
        .sort((a, b) => b.value - a.value)
      : [];
    daily.push({ day: String(day.getDate()), date: key, value: e ? e.total : 0, breakdown });
  }

  // Sales revenue by category (YTD).
  const cRows = db.prepare(`SELECT si.category cat, COALESCE(SUM(${REV}),0) s ${SOLD} AND sl.date>=? GROUP BY si.category ORDER BY s DESC`).all(yearStart);
  const byCategory = cRows.filter((r) => r.s > 0).map((r) => ({ label: r.cat, value: r.s, color: STOCK_CAT_COLOR[r.cat] || '#22C55E' }));

  // Current stock value by category (qty × buy) — where capital is tied up now.
  const vRows = db.prepare('SELECT category cat, COALESCE(SUM(qty * buy),0) v FROM stock_items GROUP BY category ORDER BY v DESC').all();
  const valueByCategory = vRows.filter((r) => r.v > 0).map((r) => ({ label: r.cat, value: r.v, color: STOCK_CAT_COLOR[r.cat] || '#22C55E' }));

  return {
    salesRevenueMonth: revenue,
    unitsSoldMonth: sold.units,
    grossProfitMonth: grossProfit,
    marginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0,
    lossesMonth: loss.val,
    lossUnitsMonth: loss.units,
    stockValue,
    stockValueSale,
    monthly,
    daily,
    byCategory,
    valueByCategory,
  };
}

// Stock KPI summary over an arbitrary [after, before] window — powers the Stock
// Dashboard's shared date filter across its top cards. Same money/units rules as
// stockDashboard() (weight sales count as one unit; buy/sell join the catalogue).
function stockSummary(db, { query = {} }) {
  const { after, before } = dayRange(query);
  const UNITS = "SUM(CASE WHEN si.unit='g' THEN 1 ELSE sl.qty END)";
  const JOIN = 'FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id ';
  const soldW = whereRange('sl.date', after, before, "sl.action='remove' AND sl.reason='Sold'");
  const sold = db.prepare(
    'SELECT COALESCE(SUM(COALESCE(sl.cost, sl.qty * si.sell)),0) rev, '
    + `COALESCE(${UNITS},0) units, COALESCE(SUM(sl.qty * si.buy),0) cogs `
    + JOIN + soldW.clause,
  ).get(...soldW.args);
  const lossW = whereRange('sl.date', after, before, "sl.action='remove' AND sl.reason IN ('Damaged','Expired')");
  const loss = db.prepare(
    `SELECT COALESCE(SUM(sl.qty * si.buy),0) val, COALESCE(${UNITS},0) units ` + JOIN + lossW.clause,
  ).get(...lossW.args);
  const grossProfit = sold.rev - sold.cogs;
  return {
    salesRevenue: sold.rev,
    unitsSold: sold.units,
    grossProfit,
    marginPct: sold.rev > 0 ? Math.round((grossProfit / sold.rev) * 100) : 0,
    losses: loss.val,
    lossUnits: loss.units,
  };
}

// A single Stock Dashboard panel recomputed for an arbitrary [after, before]
// window (its own before/after picker). Sales metrics are transactional, so they
// filter by the sale date on the stock log.
function stockPanel(db, { query = {} }) {
  const { after, before } = dayRange(query);
  if (query.metric === 'salesByCategory') {
    const w = whereRange('sl.date', after, before, "sl.action='remove' AND sl.reason='Sold'");
    const rows = db.prepare(
      'SELECT si.category cat, COALESCE(SUM(COALESCE(sl.cost, sl.qty * si.sell)),0) s '
      + 'FROM stock_log sl JOIN stock_items si ON si.id=sl.item_id '
      + `${w.clause} GROUP BY si.category ORDER BY s DESC`,
    ).all(...w.args);
    return { data: rows.filter((r) => r.s > 0).map((r) => ({ label: r.cat, value: r.s, color: STOCK_CAT_COLOR[r.cat] || '#22C55E' })) };
  }
  throw new HttpError(400, 'Unknown metric');
}

// Roster = every member who practises the sport, merged with their discipline
// profile row (belt, stats, …) when one exists, or defaults when it doesn't.
// Unioned with any orphan profile rows so seeded data is never dropped.
function judo(db) {
  const profiles = {};
  db.prepare('SELECT * FROM judo_students').all().forEach((r) => { profiles[r.member_id] = r; });
  const students = db.prepare('SELECT id, sports FROM members').all()
    .filter((m) => profiles[m.id] || JSON.parse(m.sports).includes('JUDO'))
    .map((m) => {
      const p = profiles[m.id];
      return {
        memberId: m.id,
        belt: p ? p.belt : 0,
        weightCat: p ? p.weight_cat : null,
        attendanceRate: p && p.attendance_rate != null ? p.attendance_rate : 0,
        notes: p ? p.notes : '',
        competitions: competitions(db, 'judo_competitions', m.id),
      };
    });
  const schedule = db.prepare("SELECT * FROM schedules WHERE sport='judo' ORDER BY id").all()
    .map((r) => ({ day: r.day, time: r.time, group: r.grp }));
  return { students, schedule };
}

function wrestling(db) {
  const profiles = {};
  db.prepare('SELECT * FROM wrestling_students').all().forEach((r) => { profiles[r.member_id] = r; });
  const students = db.prepare('SELECT id, sports FROM members').all()
    .filter((m) => profiles[m.id] || JSON.parse(m.sports).includes('WRESTLING'))
    .map((m) => {
      const p = profiles[m.id];
      return {
        memberId: m.id,
        category: p ? p.category : 0,
        style: p ? p.style : 'Freestyle',
        weightKg: p ? p.weight_kg : null,
        heightCm: p ? p.height_cm : null,
        attendanceRate: p && p.attendance_rate != null ? p.attendance_rate : 0,
        competitions: competitions(db, 'wrestling_competitions', m.id),
      };
    });
  const schedule = db.prepare("SELECT * FROM schedules WHERE sport='wrestling' ORDER BY id").all()
    .map((r) => ({ day: r.day, time: r.time, group: r.grp }));
  return { students, schedule };
}

// ── Judo record editing ────────────────────────────────────────────────────
// Upsert a student's judo profile (belt / weight category / notes). Attendance
// is left untouched. Creates the profile row on first save.
function updateJudoStudent(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) throw new HttpError(404, 'Member not found');
  const belt = Math.max(0, Math.min(7, Math.round(Number(body.belt) || 0)));
  const weightCat = body.weightCat ? String(body.weightCat) : null;
  const notes = body.notes ? String(body.notes) : null;
  db.prepare(
    `INSERT INTO judo_students (member_id, belt, weight_cat, attendance_rate, notes)
     VALUES (?,?,?,NULL,?)
     ON CONFLICT(member_id) DO UPDATE SET belt=excluded.belt, weight_cat=excluded.weight_cat, notes=excluded.notes`,
  ).run(id, belt, weightCat, notes);
  logActivity(db, user.id, 'judo.update', m.name, `Edited judo record for ${m.name}`);
  return judo(db);
}

function addJudoCompetition(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) throw new HttpError(404, 'Member not found');
  if (!body.event || !String(body.event).trim()) throw new HttpError(400, 'Event name is required');
  const date = body.date || iso(new Date()).slice(0, 10);
  const result = ['gold', 'silver', 'bronze', 'loss'].includes(body.result) ? body.result : 'loss';
  db.prepare('INSERT INTO judo_competitions (member_id,date,event,result) VALUES (?,?,?,?)')
    .run(id, date, String(body.event).trim(), result);
  logActivity(db, user.id, 'judo.competition.add', m.name, `Added judo competition for ${m.name}: ${String(body.event).trim()}`);
  return judo(db);
}

function deleteJudoCompetition(db, { params, user }) {
  const id = Number(params[0]);
  const row = db.prepare('SELECT * FROM judo_competitions WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Competition not found');
  db.prepare('DELETE FROM judo_competitions WHERE id=?').run(id);
  logActivity(db, user.id, 'judo.competition.delete', row.event, `Removed judo competition: ${row.event}`);
  return judo(db);
}

// Replace the whole judo weekly schedule with the supplied rows.
function setJudoSchedule(db, { body, user }) {
  const rows = Array.isArray(body.schedule) ? body.schedule : [];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM schedules WHERE sport='judo'").run();
    const ins = db.prepare("INSERT INTO schedules (sport,day,time,grp) VALUES ('judo',?,?,?)");
    rows.forEach((r) => ins.run(String(r.day || ''), String(r.time || ''), String(r.group || '')));
  });
  tx();
  logActivity(db, user.id, 'judo.schedule', 'judo', `Updated the judo weekly schedule (${rows.length} slots)`);
  return judo(db);
}

// ── Wrestling record editing (mirrors judo) ─────────────────────────────────
function updateWrestlingStudent(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) throw new HttpError(404, 'Member not found');
  const category = Math.max(0, Math.min(7, Math.round(Number(body.category) || 0)));
  const style = body.style === 'Greco-Roman' ? 'Greco-Roman' : 'Freestyle';
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
  db.prepare(
    `INSERT INTO wrestling_students (member_id, category, style, weight_kg, height_cm, attendance_rate)
     VALUES (?,?,?,?,?,NULL)
     ON CONFLICT(member_id) DO UPDATE SET category=excluded.category, style=excluded.style,
       weight_kg=excluded.weight_kg, height_cm=excluded.height_cm`,
  ).run(id, category, style, num(body.weightKg), num(body.heightCm));
  logActivity(db, user.id, 'wrestling.update', m.name, `Edited wrestling record for ${m.name}`);
  return wrestling(db);
}

function addWrestlingCompetition(db, { params, body, user }) {
  const id = Number(params[0]);
  const m = db.prepare('SELECT * FROM members WHERE id=?').get(id);
  if (!m) throw new HttpError(404, 'Member not found');
  if (!body.event || !String(body.event).trim()) throw new HttpError(400, 'Event name is required');
  const date = body.date || iso(new Date()).slice(0, 10);
  const result = ['gold', 'silver', 'bronze', 'loss'].includes(body.result) ? body.result : 'loss';
  db.prepare('INSERT INTO wrestling_competitions (member_id,date,event,result) VALUES (?,?,?,?)')
    .run(id, date, String(body.event).trim(), result);
  logActivity(db, user.id, 'wrestling.competition.add', m.name, `Added wrestling competition for ${m.name}: ${String(body.event).trim()}`);
  return wrestling(db);
}

function deleteWrestlingCompetition(db, { params, user }) {
  const id = Number(params[0]);
  const row = db.prepare('SELECT * FROM wrestling_competitions WHERE id=?').get(id);
  if (!row) throw new HttpError(404, 'Competition not found');
  db.prepare('DELETE FROM wrestling_competitions WHERE id=?').run(id);
  logActivity(db, user.id, 'wrestling.competition.delete', row.event, `Removed wrestling competition: ${row.event}`);
  return wrestling(db);
}

function setWrestlingSchedule(db, { body, user }) {
  const rows = Array.isArray(body.schedule) ? body.schedule : [];
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM schedules WHERE sport='wrestling'").run();
    const ins = db.prepare("INSERT INTO schedules (sport,day,time,grp) VALUES ('wrestling',?,?,?)");
    rows.forEach((r) => ins.run(String(r.day || ''), String(r.time || ''), String(r.group || '')));
  });
  tx();
  logActivity(db, user.id, 'wrestling.schedule', 'wrestling', `Updated the wrestling weekly schedule (${rows.length} slots)`);
  return wrestling(db);
}

// Normalise the weight-tracking fields from an incoming item body. A whole-unit
// item stores unit='unit' and null container/portions; a weight item stores
// unit='g', its container size in grams, and its scoop presets as JSON.
function weightFields(body) {
  if (body.unit !== 'g') return { unit: 'unit', containerSize: null, portions: null };
  const cs = Number(body.containerSize);
  const portions = Array.isArray(body.portions)
    ? body.portions
      .map((p) => ({ g: Math.round(Number(p.g)), price: Math.round(Number(p.price)) }))
      .filter((p) => p.g > 0 && p.price >= 0)
    : [];
  return {
    unit: 'g',
    containerSize: Number.isFinite(cs) && cs > 0 ? Math.round(cs) : null,
    portions: JSON.stringify(portions),
  };
}

function createStock(db, { body, user }) {
  const w = weightFields(body);
  db.prepare(
    'INSERT INTO stock_items (name,category,qty,min,buy,sell,supplier,expiry,last_restock,unit,container_size,portions)'
    + ' VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(body.name, body.category, body.qty ?? 0, body.min ?? 0, body.buy ?? null, body.sell ?? null,
    body.supplier ?? null, body.expiry ?? null, iso(new Date()).slice(0, 10), w.unit, w.containerSize, w.portions);
  logActivity(db, user.id, 'stock.create', body.name, `Created stock item ${body.name} (${body.category}, qty ${body.qty ?? 0})`);
  return stockPayload(db);
}

function updateStock(db, { params, body, user }) {
  const id = Number(params[0]);
  const old = db.prepare('SELECT * FROM stock_items WHERE id=?').get(id);
  if (!old) throw new HttpError(404, 'Stock item not found');
  const w = weightFields(body);
  const fields = [
    [body.name, 'name', 'name'], [body.category, 'category', 'category'],
    [body.qty, 'qty', 'qty'], [body.min, 'min', 'min'], [body.buy, 'buy', 'buy cost'],
    [body.sell, 'sell', 'sell price'], [body.supplier, 'supplier', 'supplier'], [body.expiry, 'expiry', 'expiry'],
    [w.unit, 'unit', 'sell mode'], [w.containerSize, 'container_size', 'container size'], [w.portions, 'portions', 'scoops'],
  ];
  const changed = fields.filter(([v, col]) => (v ?? null) !== old[col]).map(([, , label]) => label);
  db.prepare(
    'UPDATE stock_items SET name=?,category=?,qty=?,min=?,buy=?,sell=?,supplier=?,expiry=?,unit=?,container_size=?,portions=? WHERE id=?',
  ).run(body.name, body.category, body.qty, body.min, body.buy ?? null, body.sell ?? null,
    body.supplier ?? null, body.expiry ?? null, w.unit, w.containerSize, w.portions, id);
  const detail = changed.length ? `Edited stock item ${body.name} — ${changed.join(', ')}` : `Edited stock item ${body.name} — no changes`;
  logActivity(db, user.id, 'stock.update', body.name, detail);
  return stockPayload(db);
}

function deleteStock(db, { params, user }) {
  const id = Number(params[0]);
  const it = db.prepare('SELECT * FROM stock_items WHERE id=?').get(id);
  if (!it) throw new HttpError(404, 'Stock item not found');
  db.prepare('DELETE FROM stock_items WHERE id=?').run(id);
  logActivity(db, user.id, 'stock.delete', it.name, `Deleted stock item ${it.name}`);
  return stockPayload(db);
}

// Wipe the whole movement log (admin only). Stock quantities are untouched.
function clearStockLog(db, { user }) {
  const n = db.prepare('SELECT COUNT(*) c FROM stock_log').get().c;
  db.prepare('DELETE FROM stock_log').run();
  logActivity(db, user.id, 'stock.log.clear', 'stock_log', `Cleared the stock movement log (${n} entries)`);
  return stockPayload(db);
}

function stockOp(db, { params, body, user }) {
  const id = Number(params[0]);
  const it = db.prepare('SELECT * FROM stock_items WHERE id=?').get(id);
  if (!it) throw new HttpError(404, 'Stock item not found');
  let detail;
  if (body.action === 'add') {
    db.prepare('UPDATE stock_items SET qty=qty+?, last_restock=? WHERE id=?').run(body.qty, iso(new Date()).slice(0, 10), id);
    detail = `Restocked ${it.name}: +${body.qty}` + (body.cost ? ` (cost ${body.cost} DZD)` : '');
  } else {
    db.prepare('UPDATE stock_items SET qty=MAX(0, qty-?) WHERE id=?').run(body.qty, id);
    detail = `Removed ${body.qty} × ${it.name}` + (body.reason ? ` (${body.reason})` : '');
  }
  db.prepare('INSERT INTO stock_log (item_id,action,qty,reason,cost,date) VALUES (?,?,?,?,?,?)')
    .run(id, body.action, body.qty, body.reason ?? null, body.cost ?? null, iso(new Date()));
  logActivity(db, user.id, 'stock.op', it.name, detail);
  return stockPayload(db);
}

// ── user management (admin only) ──────────────────────────────────────────────
function getUser(db, id) {
  const r = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!r) throw new HttpError(404, 'User not found');
  return r;
}

function listUsers(db) {
  return db.prepare('SELECT * FROM users ORDER BY role DESC, full_name, username').all().map(userRowToDict);
}

function createUser(db, { body, user }) {
  if (!body.username || !body.username.trim()) throw new HttpError(400, 'Username is required');
  if (!body.password) throw new HttpError(400, 'Password is required');
  const username = body.username.trim();
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) {
    throw new HttpError(400, 'That username is already taken');
  }
  const { hash, salt } = hashPassword(body.password);
  const info = db.prepare(
    `INSERT INTO users (username,password_hash,password_salt,full_name,address,phone,role,color,created_at,active)
     VALUES (?,?,?,?,?,?,'coach',?,?,1)`,
  ).run(username, hash, salt, body.fullName ?? null, body.address ?? null, body.phone ?? null,
    body.color ?? '#10D98E', iso(new Date()));
  logActivity(db, user.id, 'user.create', body.fullName || username,
    `Created coach ${body.fullName || username} (username ${username})`);
  return userRowToDict(getUser(db, info.lastInsertRowid));
}

function updateUser(db, { params, body, user }) {
  const id = Number(params[0]);
  const u = getUser(db, id);
  const changes = [];
  const newUsername = (body.username || '').trim();
  if (newUsername && newUsername !== u.username) {
    if (db.prepare('SELECT 1 FROM users WHERE username=? AND id<>?').get(newUsername, id)) {
      throw new HttpError(400, 'That username is already taken');
    }
    db.prepare('UPDATE users SET username=? WHERE id=?').run(newUsername, id);
    changes.push('username');
  }
  if (body.password) {
    const { hash, salt } = hashPassword(body.password);
    db.prepare('UPDATE users SET password_hash=?, password_salt=? WHERE id=?').run(hash, salt, id);
    changes.push('password');
  }
  for (const [value, col, label] of [
    [body.fullName, 'full_name', 'name'], [body.address, 'address', 'address'],
    [body.phone, 'phone', 'phone'], [body.color, 'color', 'color'],
  ]) {
    if (value !== undefined && value !== u[col]) {
      db.prepare(`UPDATE users SET ${col}=? WHERE id=?`).run(value, id);
      changes.push(label);
    }
  }
  const name = body.fullName || u.full_name || u.username;
  const detail = changes.length ? `Edited user ${name} — ${changes.join(', ')}` : `Edited user ${name} — no changes`;
  logActivity(db, user.id, 'user.update', name, detail);
  return userRowToDict(getUser(db, id));
}

function deleteUser(db, { params, user }) {
  const id = Number(params[0]);
  const u = getUser(db, id);
  if (u.role === 'admin') throw new HttpError(400, 'The administrator account cannot be deleted');
  const name = u.full_name || u.username;
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  logActivity(db, user.id, 'user.delete', name, `Deleted coach ${name} (username ${u.username})`);
  return { ok: true };
}

function userActivity(db, { params }) {
  const id = Number(params[0]);
  getUser(db, id);
  const timeline = db.prepare(
    'SELECT action, target, detail, created_at FROM activity_log WHERE user_id=? ORDER BY created_at DESC, id DESC',
  ).all(id).map((r) => ({ action: r.action, target: r.target, detail: r.detail, createdAt: ms(r.created_at) }));
  const sessions = db.prepare(
    'SELECT login_at, logout_at FROM sessions WHERE user_id=? ORDER BY login_at DESC LIMIT 50',
  ).all(id).map((r) => ({ loginAt: ms(r.login_at), logoutAt: r.logout_at ? ms(r.logout_at) : null }));
  return { timeline, sessions };
}

// ── routing table ─────────────────────────────────────────────────────────────
const ROUTES = [
  { m: 'POST', re: /^\/login$/, fn: login },
  { m: 'POST', re: /^\/logout$/, auth: true, fn: logout },
  { m: 'GET', re: /^\/me$/, auth: true, fn: me },
  { m: 'PUT', re: /^\/me\/preferences$/, auth: true, fn: updatePreferences },
  { m: 'GET', re: /^\/bootstrap$/, fn: bootstrap },
  { m: 'GET', re: /^\/live\/subscribed-today$/, fn: liveSubscribedToday },
  { m: 'GET', re: /^\/live\/entries-today$/, fn: liveEntriesToday },
  { m: 'GET', re: /^\/live\/sessions-owed$/, fn: liveSessionsOwed },
  { m: 'GET', re: /^\/live\/expiring-soon$/, fn: liveExpiringSoon },
  { m: 'POST', re: /^\/swipe$/, auth: true, fn: swipe },
  { m: 'POST', re: /^\/members\/(\d+)\/force-exit$/, auth: true, fn: forceExit },
  { m: 'POST', re: /^\/members\/(\d+)\/check-in$/, auth: true, fn: checkIn },
  { m: 'POST', re: /^\/guest-session$/, auth: true, fn: guestSession },
  { m: 'DELETE', re: /^\/guest-session\/(\d+)$/, auth: true, fn: removeGuestSession },
  { m: 'POST', re: /^\/members$/, auth: true, fn: createMember },
  { m: 'PUT', re: /^\/members\/(\d+)$/, auth: true, fn: updateMember },
  { m: 'DELETE', re: /^\/members\/(\d+)$/, auth: true, fn: deleteMember },
  { m: 'POST', re: /^\/members\/(\d+)\/renew$/, auth: true, fn: renewMember },
  { m: 'POST', re: /^\/members\/(\d+)\/pay-balance$/, auth: true, fn: payBalance },
  { m: 'POST', re: /^\/members\/(\d+)\/collect-sessions$/, auth: true, fn: collectSessions },
  { m: 'POST', re: /^\/members\/(\d+)\/insurance$/, auth: true, fn: payInsurance },
  { m: 'GET', re: /^\/members\/(\d+)\/entries$/, fn: memberEntries },
  { m: 'GET', re: /^\/members\/(\d+)\/payments$/, auth: true, fn: memberPayments },
  { m: 'POST', re: /^\/payments\/(\d+)\/void$/, auth: true, fn: voidPayment },
  { m: 'GET', re: /^\/stats$/, fn: stats },
  { m: 'GET', re: /^\/stats\/panel$/, fn: statsPanel },
  { m: 'GET', re: /^\/reports\/members$/, fn: memberReports },
  { m: 'GET', re: /^\/reports\/stock$/, fn: stockDashboard },
  { m: 'GET', re: /^\/reports\/stock\/summary$/, fn: stockSummary },
  { m: 'GET', re: /^\/reports\/stock\/panel$/, fn: stockPanel },
  { m: 'GET', re: /^\/judo$/, fn: judo },
  { m: 'PUT', re: /^\/judo\/schedule$/, auth: true, fn: setJudoSchedule },
  { m: 'PUT', re: /^\/judo\/students\/(\d+)$/, auth: true, fn: updateJudoStudent },
  { m: 'POST', re: /^\/judo\/students\/(\d+)\/competitions$/, auth: true, fn: addJudoCompetition },
  { m: 'DELETE', re: /^\/judo\/competitions\/(\d+)$/, auth: true, fn: deleteJudoCompetition },
  { m: 'GET', re: /^\/wrestling$/, fn: wrestling },
  { m: 'PUT', re: /^\/wrestling\/schedule$/, auth: true, fn: setWrestlingSchedule },
  { m: 'PUT', re: /^\/wrestling\/students\/(\d+)$/, auth: true, fn: updateWrestlingStudent },
  { m: 'POST', re: /^\/wrestling\/students\/(\d+)\/competitions$/, auth: true, fn: addWrestlingCompetition },
  { m: 'DELETE', re: /^\/wrestling\/competitions\/(\d+)$/, auth: true, fn: deleteWrestlingCompetition },
  { m: 'GET', re: /^\/stock$/, fn: stockPayload },
  { m: 'POST', re: /^\/stock$/, auth: true, fn: createStock },
  { m: 'PUT', re: /^\/stock\/(\d+)$/, auth: true, fn: updateStock },
  { m: 'DELETE', re: /^\/stock\/(\d+)$/, auth: true, fn: deleteStock },
  { m: 'POST', re: /^\/stock\/(\d+)\/op$/, auth: true, fn: stockOp },
  { m: 'DELETE', re: /^\/stock\/log$/, admin: true, fn: clearStockLog },
  { m: 'GET', re: /^\/settings$/, auth: true, fn: getSettings },
  { m: 'PUT', re: /^\/settings$/, admin: true, fn: updateSettings },
  { m: 'GET', re: /^\/users$/, admin: true, fn: listUsers },
  { m: 'POST', re: /^\/users$/, admin: true, fn: createUser },
  { m: 'PUT', re: /^\/users\/(\d+)$/, admin: true, fn: updateUser },
  { m: 'DELETE', re: /^\/users\/(\d+)$/, admin: true, fn: deleteUser },
  { m: 'GET', re: /^\/users\/(\d+)\/activity$/, admin: true, fn: userActivity },
];

/** Dispatch a request. Returns { status, data } or { status, error }. Never throws. */
function handleRequest(db, { method, path, body = {}, token = null }) {
  try {
    const [rawPath, queryStr] = String(path).split('?');
    const query = {};
    if (queryStr) queryStr.split('&').forEach((pair) => { const [k, v] = pair.split('='); query[k] = decodeURIComponent(v ?? ''); });

    const route = ROUTES.find((r) => r.m === method && r.re.test(rawPath));
    if (!route) throw new HttpError(404, 'Not found');

    let user = null;
    if (route.auth || route.admin) {
      user = resolveUser(db, token);
      if (!user) throw new HttpError(401, 'Not authenticated');
      if (route.admin && user.role !== 'admin') throw new HttpError(403, 'Administrator access required');
      user.token = token;
    }

    const params = (route.re.exec(rawPath) || []).slice(1);
    const data = route.fn(db, { params, body, query, user });
    return { status: 200, data };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, error: e.detail };
    return { status: 500, error: e.message || 'Internal error' };
  }
}

module.exports = { handleRequest, HttpError };
