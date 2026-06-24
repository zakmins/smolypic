// Synthetic seed for Smolympic — Node port of the former backend/seed.py.
// Deterministic (seeded PRNG) and dense enough that every statistics query
// computes believable numbers from real rows. Seeds Smail (admin) + 2 coaches.
const { iso, isoDate, hashPassword } = require('./db.js');

// ── Seeded PRNG (mulberry32) + Python-random-style helpers ────────────────────
function makeRng(seed) {
  let a = seed >>> 0;
  const random = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const randint = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const choice = (arr) => arr[Math.floor(random() * arr.length)];
  const uniform = (lo, hi) => lo + random() * (hi - lo);
  const choices = (arr, weights) => {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = random() * total;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r < 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const sample = (arr, k) => {
    const pool = arr.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  };
  return { random, randint, choice, uniform, choices, sample };
}

const FIRST_M = ['Yacine','Amine','Sofiane','Walid','Riad','Mehdi','Nassim','Karim','Bilal','Zineddine','Adel','Farès','Islam','Hocine','Rayan','Anis','Samir','Lotfi','Oussama','Tarek'];
const FIRST_F = ['Lina','Amira','Sarah','Imène','Kahina','Nesrine','Yasmine','Meriem','Feriel','Dounia','Asma','Rania','Selma','Manel'];
const LAST = ['Benali','Khelifi','Bouzid','Hamidi','Cherif','Zerrouki','Saadi','Mansouri','Belkacem','Aouali','Guettaf','Brahimi','Touati','Meziane','Larbi','Haddad','Ferhat','Slimani','Bensalem','Djaballah'];
const SUB_PRICE = { 30: 2500, 90: 6500, 180: 12000, 365: 22000 };

const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
const atMidnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

// Clean production init: a single administrator account (admin/admin) and no
// demo data. Used for real deployments (e.g. the gym PC) — see initDb() in main.js.
function seedAdmin(db, { username = 'admin', password = 'admin', fullName = 'Administrator' } = {}) {
  const { hash, salt } = hashPassword(password);
  db.prepare(
    `INSERT INTO users (username,password_hash,password_salt,full_name,role,color,created_at,active)
     VALUES (?,?,?,?,'admin','#10D98E',?,1)`,
  ).run(username, hash, salt, fullName, iso(new Date()));
}

function seed(db) {
  const R = makeRng(20260611);
  const NOW = new Date();

  // Valid categories only — no arbitrary mixing (Gym, Gym+Cardio, Cardio, Judo, Wrestling).
  const pickSports = () => {
    const r = R.random();
    if (r < 0.40) return ['GYM'];
    if (r < 0.56) return ['GYM', 'CARDIO'];
    if (r < 0.68) return ['CARDIO'];
    if (r < 0.84) return ['JUDO'];
    return ['WRESTLING'];
  };
  const visitHour = () => {
    const r = R.random();
    if (r < 0.46) return R.randint(17, 20);
    if (r < 0.66) return R.randint(9, 11);
    return R.choice([6, 7, 8, 12, 13, 14, 15, 16, 21, 22]);
  };

  const run = (sql, ...params) => db.prepare(sql).run(...params);

  const tx = db.transaction(() => {
    // ── Users: Smail (admin) + coaches with distinct colors ──────────────────
    // Smail's color is the original emerald accent, so the default look is unchanged.
    const users = [
      ['smail', 'smail', 'Smail', 'Cité 1200 Logements, Algiers', '0550 12 34 56', 'admin', '#10D98E'],
      ['karim', 'karim', 'Karim Boudiaf', 'Bab Ezzouar, Algiers', '0661 22 33 44', 'coach', '#B07CFF'],
      ['nadia', 'nadia', 'Nadia Slimani', 'Hydra, Algiers', '0770 55 66 77', 'coach', '#4D9FFF'],
    ];
    for (const [username, pw, full, addr, phone, role, color] of users) {
      const { hash, salt } = hashPassword(pw);
      run(`INSERT INTO users (username,password_hash,password_salt,full_name,address,phone,role,color,created_at,active)
           VALUES (?,?,?,?,?,?,?,?,?,1)`,
        username, hash, salt, full, addr, phone, role, color, iso(NOW));
    }

    // ── Members ──────────────────────────────────────────────────────────────
    const memberIds = [];
    const usedNames = new Set();
    const lapsedIdx = new Set([31, 32, 33, 34, 35]);    // no visits in the last 35–80 days
    const expiringIdx = new Set([2, 9]);                // UNLIMITED subs ~1 day from expiry (date axis)
    const meteredLowIdx = new Set([17, 25]);            // METERED subs with 1 session left (sessions axis)
    const meteredIdx = new Set([3, 8, 14, 20, 27]);     // healthy METERED subs
    const expiredIdx = new Set([5, 13, 21, 29]);        // subscription already over (by date)
    const owedIdx = new Set([6, 22]);                   // pay-per-session, club owes sessions
    const insertMember = db.prepare(
      `INSERT INTO members (rfid_uid,name,gender,dob,phone,sports,membership_type,
         sub_start,sub_end,duration_days,sessions_total,sessions_left,
         insurance,insurance_expiry,hue,join_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    for (let i = 0; i < 38; i++) {
      const gender = R.random() < 0.7 ? 'M' : 'F';
      let name;
      do {
        name = `${R.choice(gender === 'M' ? FIRST_M : FIRST_F)} ${R.choice(LAST)}`;
      } while (usedNames.has(name));
      usedNames.add(name);

      // Session-metered / pay-per-session demos must be Gym/Cardio — Judo & Wrestling
      // are monthly-only with no session count; everyone else gets a real category.
      const needsSessions = owedIdx.has(i) || meteredLowIdx.has(i) || meteredIdx.has(i);
      const sports = needsSessions ? R.choice([['GYM'], ['GYM', 'CARDIO'], ['CARDIO']]) : pickSports();
      const gymFamily = sports.includes('GYM') || sports.includes('CARDIO');
      let mtype;
      if (owedIdx.has(i)) mtype = 'session';
      else if (expiringIdx.has(i) || meteredLowIdx.has(i) || meteredIdx.has(i) || expiredIdx.has(i)) mtype = 'subscription';
      else if (!gymFamily) mtype = 'subscription';   // Judo/Wrestling: monthly subscription only
      else mtype = R.random() < 0.6 ? 'subscription' : 'session';
      // Only Gym/Cardio subscriptions can be metered (a 2/3/4-per-week plan ⇒ 8/12/16).
      const metered = meteredLowIdx.has(i) || meteredIdx.has(i)
        || (mtype === 'subscription' && gymFamily && !expiringIdx.has(i) && R.random() < 0.35);
      const join = addDays(NOW, -R.randint(20, 420));
      const dur = R.choice([30, 30, 90, 90, 180, 365]);

      let subStart, subEnd, sessionsTotal = null, sessionsLeft = null;
      if (mtype === 'subscription') {
        if (expiringIdx.has(i)) {
          subEnd = addDays(NOW, 1);                       // lapses tomorrow ⇒ days_remaining 1 (< 2)
          subStart = addDays(subEnd, -dur);
        } else if (expiredIdx.has(i)) {
          subEnd = addDays(NOW, -R.randint(1, 18));
          subStart = addDays(subEnd, -dur);
        } else {
          subStart = addDays(NOW, -R.randint(0, dur - 3));
          subEnd = addDays(subStart, dur);
        }
        if (metered) {
          sessionsTotal = R.choice([8, 12, 16]);
          sessionsLeft = meteredLowIdx.has(i) ? 1 : R.randint(2, sessionsTotal);
        }
      } else {
        subStart = join;
        subEnd = addDays(join, 3650);                   // session packs don't expire
        sessionsTotal = R.choice([10, 12, 20]);
        sessionsLeft = owedIdx.has(i) ? R.choice([-1, -2]) : R.randint(0, sessionsTotal);
      }

      const insured = R.random() < 0.62;
      // Insurance runs on its own yearly cycle — a few are already overdue (negative).
      const insExpiry = insured ? iso(addDays(NOW, R.randint(-50, 330))) : null;
      const info = insertMember.run(
        String(4200000000 + i * 13), name, gender,    // 10-digit numeric tag UID
        `${NOW.getFullYear() - R.randint(16, 47)}-${pad(R.randint(1, 12))}-${pad(R.randint(1, 28))}`,
        `05${R.randint(40, 99)} ${R.randint(10, 99)} ${R.randint(10, 99)} ${R.randint(10, 99)}`,
        JSON.stringify(sports), mtype,
        isoDate(subStart), isoDate(subEnd), dur, sessionsTotal, sessionsLeft,
        insured ? 1 : 0, insExpiry, R.randint(0, 359), iso(join),
      );
      memberIds.push(info.lastInsertRowid);
    }

    const members = db.prepare('SELECT * FROM members').all();
    const insertPayment = db.prepare(
      'INSERT INTO payments (member_id,amount,kind,sport,method,date) VALUES (?,?,?,?,?,?)',
    );
    const insertEntry = db.prepare(
      'INSERT INTO entries (member_id,entry_time,exit_time) VALUES (?,?,?)',
    );

    // ── Payments: subscription renewals back through the year ─────────────────
    for (const m of members) {
      if (m.membership_type !== 'subscription') continue;
      const join = new Date(m.join_date);
      const sport = JSON.parse(m.sports)[0];
      const amount = SUB_PRICE[m.duration_days];
      let d = join;
      while (d < NOW) {
        const dd = new Date(d);
        dd.setHours(R.randint(9, 20), R.randint(0, 59), 0, 0);
        insertPayment.run(m.id, amount, 'subscription', sport, 'Cash', iso(dd));
        d = addDays(d, m.duration_days);
      }
    }

    // ── Insurance: a 500 DZD/year fee — one payment per insured member, dated
    // when their current year of cover began (expiry − 365 days). ─────────────
    for (const m of members) {
      if (!m.insurance || !m.insurance_expiry) continue;
      const paid = new Date(new Date(m.insurance_expiry).getTime() - 365 * 86400000);
      insertPayment.run(m.id, 500, 'insurance', null, 'Cash', iso(paid));
    }

    // ── Walk-in sessions: one-off drop-ins added via "+ Session" (no member).
    // Recorded as payments with member_id = NULL so they feed the Reports page
    // without ever counting as member revenue. ~150 days of history. ───────────
    {
      let d = addDays(NOW, -150);
      while (atMidnight(d) <= atMidnight(NOW)) {
        const n = R.randint(0, 3);   // 0–3 walk-ins on a given day
        for (let k = 0; k < n; k++) {
          const when = new Date(d);
          when.setHours(visitHour(), R.randint(0, 59), 0, 0);
          if (when > NOW) continue;
          insertPayment.run(null, R.random() < 0.75 ? 300 : 400, 'session', 'GYM', 'Cash', iso(when));
        }
        d = addDays(d, 1);
      }
    }

    // ── Entries: ~150 days of visits, hour-weighted for the heatmap ───────────
    const lapsedIds = new Set([...lapsedIdx].filter((i) => i < memberIds.length).map((i) => memberIds[i]));
    for (const m of members) {
      const perWeek = R.uniform(1.2, 4.8);
      const sports = JSON.parse(m.sports);
      const sessionPrice = m.membership_type === 'session' ? (sports.includes('CARDIO') ? 400 : 300) : null;
      const stop = lapsedIds.has(m.id) ? addDays(NOW, -R.randint(35, 80)) : NOW;
      let day = new Date(Math.max(new Date(m.join_date).getTime(), addDays(NOW, -150).getTime()));
      while (atMidnight(day) < atMidnight(stop)) {
        if (R.random() < perWeek / 7) {
          const start = new Date(day);
          start.setHours(visitHour(), R.randint(0, 59), R.randint(0, 59), 0);
          const end = new Date(start.getTime() + R.randint(35, 130) * 60000);
          insertEntry.run(m.id, iso(start), iso(end));
          if (sessionPrice) insertPayment.run(m.id, sessionPrice, 'session', sports[0], 'Cash', iso(start));
        }
        day = addDays(day, 1);
      }
    }

    // ── Today: a busy floor — closed visits, plus ~8 members still inside ─────
    const todayPool = memberIds.filter((mid) => !lapsedIds.has(mid));
    const todayVisitors = R.sample(todayPool, Math.min(26, todayPool.length));
    const inside = new Set(R.sample(todayVisitors, 8));
    for (const mid of todayVisitors) {
      let start;
      let h = visitHour();
      if (h >= NOW.getHours()) h = Math.max(6, NOW.getHours() - R.randint(1, 4));
      if (inside.has(mid)) {
        start = new Date(NOW.getTime() - R.randint(4, 115) * 60000);
        insertEntry.run(mid, iso(start), null);
      } else {
        start = new Date(NOW);
        start.setHours(h, R.randint(0, 59), R.randint(0, 59), 0);
        const end = new Date(Math.min(start.getTime() + R.randint(35, 125) * 60000,
          NOW.getTime() - R.randint(2, 30) * 60000));
        if (end > start) insertEntry.run(mid, iso(start), iso(end));
      }
      const row = db.prepare('SELECT * FROM members WHERE id=?').get(mid);
      if (row.membership_type === 'session') {
        const sports = JSON.parse(row.sports);
        insertPayment.run(mid, sports.includes('CARDIO') ? 400 : 300, 'session', sports[0], 'Cash', iso(start));
      }
    }

    // Plus a couple of subscription renewals over the counter today.
    for (let i = 0; i < 3; i++) {
      const m = db.prepare("SELECT * FROM members WHERE membership_type='subscription' ORDER BY RANDOM() LIMIT 1").get();
      insertPayment.run(m.id, SUB_PRICE[m.duration_days], 'subscription', JSON.parse(m.sports)[0],
        'Cash', iso(new Date(NOW.getTime() - R.randint(0, 9) * 3600000)));
    }

    // ── Judo module ────────────────────────────────────────────────────────────
    const judoNotes = [
      'Strong uchi-mata, needs work on newaza transitions.',
      'Excellent grip fighting. Build stamina for golden score.',
      'Promote candidate next grading — consistent attendance.',
      'Returning from shoulder injury, limit randori intensity.',
      'Fast kumi-kata; foot sweeps improving every week.',
    ];
    for (const m of members) {
      if (!JSON.parse(m.sports).includes('JUDO')) continue;
      run('INSERT INTO judo_students (member_id,belt,weight_cat,attendance_rate,notes) VALUES (?,?,?,?,?)',
        m.id, R.randint(0, 6), R.choice(['-60 kg', '-66 kg', '-73 kg', '-81 kg', '-90 kg', '+90 kg']),
        R.randint(58, 97), R.choice(judoNotes));
      for (let k = 0; k < R.randint(0, 4); k++) {
        run('INSERT INTO judo_competitions (member_id,date,event,result) VALUES (?,?,?,?)',
          m.id, iso(addDays(NOW, -R.randint(20, 400))).slice(0, 10),
          R.choice(['Algiers Open', 'Wilaya Championship', 'National Cup', 'Club Friendly', 'Maghreb Trophy']),
          R.choice(['gold', 'silver', 'bronze', 'loss', 'loss']));
      }
    }

    // ── Wrestling module ───────────────────────────────────────────────────────
    for (const m of members) {
      if (!JSON.parse(m.sports).includes('WRESTLING')) continue;
      run(`INSERT INTO wrestling_students (member_id,category,style,weight_kg,height_cm,attendance_rate)
           VALUES (?,?,?,?,?,?)`,
        m.id, R.randint(0, 7), R.choice(['Freestyle', 'Greco-Roman', 'Both']),
        R.randint(57, 118), R.randint(162, 196), R.randint(55, 96));
      for (let k = 0; k < R.randint(0, 3); k++) {
        run('INSERT INTO wrestling_competitions (member_id,date,event,result) VALUES (?,?,?,?)',
          m.id, iso(addDays(NOW, -R.randint(15, 380))).slice(0, 10),
          R.choice(['Regional Trials', 'National League R2', 'Club Duel Meet', 'Algiers Grand Prix']),
          R.choice(['gold', 'silver', 'bronze', 'loss', 'loss']));
      }
    }

    for (const [day, time, grp] of [['Sunday', '17:30 – 19:00', 'Juniors'], ['Monday', '19:00 – 20:30', 'Seniors'],
      ['Wednesday', '17:30 – 19:00', 'Juniors'], ['Thursday', '19:00 – 20:30', 'Seniors'],
      ['Saturday', '10:00 – 12:00', 'Competition team']]) {
      run("INSERT INTO schedules (sport,day,time,grp) VALUES ('judo',?,?,?)", day, time, grp);
    }
    for (const [day, time, grp] of [['Sunday', '19:00 – 20:30', 'Freestyle'], ['Tuesday', '19:00 – 20:30', 'Greco-Roman'],
      ['Friday', '15:00 – 17:00', 'Open mat']]) {
      run("INSERT INTO schedules (sport,day,time,grp) VALUES ('wrestling',?,?,?)", day, time, grp);
    }

    // ── Stock ──────────────────────────────────────────────────────────────────
    const items = [
      ['Olympic barbell 20 kg', 'Equipment', 6, 4, 18000, null, 'AtlasFit DZ', null],
      ['Rubber plates 20 kg (pair)', 'Equipment', 14, 8, 9500, null, 'AtlasFit DZ', null],
      ['Judo tatami mat 2×1 m', 'Equipment', 38, 30, 7200, null, 'Tatami Algérie', null],
      ['Adjustable bench', 'Equipment', 5, 3, 22000, null, 'AtlasFit DZ', null],
      ['Whey protein 2 kg', 'Supplements', 9, 6, 5200, 7500, 'NutriMaghreb', 52],
      ['Creatine monohydrate 500 g', 'Supplements', 4, 6, 2100, 3200, 'NutriMaghreb', 24],
      ['Pre-workout 300 g', 'Supplements', 7, 5, 2800, 4200, 'NutriMaghreb', 140],
      ['Gym towel', 'Consumables', 26, 20, 350, 600, 'Textile Bab Ezzouar', null],
      ['Lifting chalk block', 'Consumables', 3, 10, 180, 350, 'AtlasFit DZ', null],
      ['Resistance band set', 'Consumables', 11, 6, 1400, 2400, 'AtlasFit DZ', null],
      ['Athletic tape roll', 'Consumables', 18, 12, 220, 450, 'PharmaSport', null],
      ['Smolympic T-shirt', 'Merchandise', 23, 10, 900, 1800, 'Textile Bab Ezzouar', null],
      ['Smolympic hoodie', 'Merchandise', 6, 8, 2400, 4500, 'Textile Bab Ezzouar', null],
      ['Mat disinfectant 5 L', 'Maintenance', 2, 4, 1600, null, 'HygiPro Alger', null],
      ['Cable pulley spare', 'Maintenance', 5, 2, 800, null, 'AtlasFit DZ', null],
    ];
    const itemIds = {};
    const insertItem = db.prepare(
      'INSERT INTO stock_items (name,category,qty,min,buy,sell,supplier,expiry,last_restock) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    for (const [name, cat, qty, mn, buy, sell, sup, expDays] of items) {
      const info = insertItem.run(name, cat, qty, mn, buy, sell, sup,
        expDays ? iso(addDays(NOW, expDays)).slice(0, 10) : null,
        iso(addDays(NOW, -R.randint(3, 60))).slice(0, 10));
      itemIds[name] = info.lastInsertRowid;
    }

    // 60 days of stock movement — sales & usage feed the most-consumed ranking.
    const sellable = ['Gym towel', 'Whey protein 2 kg', 'Lifting chalk block', 'Smolympic T-shirt',
      'Athletic tape roll', 'Creatine monohydrate 500 g', 'Pre-workout 300 g',
      'Resistance band set', 'Smolympic hoodie'];
    const weights = [10, 6, 5, 4, 4, 3, 3, 2, 2];
    const insertLog = db.prepare(
      'INSERT INTO stock_log (item_id,action,qty,reason,cost,date) VALUES (?,?,?,?,?,?)',
    );
    for (let d = 60; d > 0; d--) {
      const date = new Date(addDays(NOW, -d).getTime() - R.randint(0, 9) * 3600000);
      for (let k = 0; k < R.randint(0, 3); k++) {
        const name = R.choices(sellable, weights);
        insertLog.run(itemIds[name], 'remove', R.randint(1, 3), 'Sold', null, iso(date));
      }
      if (R.random() < 0.12) {
        const name = R.choice(sellable);
        const qty = R.randint(8, 15);
        const buy = db.prepare('SELECT buy FROM stock_items WHERE id=?').get(itemIds[name]).buy;
        insertLog.run(itemIds[name], 'add', qty, 'Restock', qty * (buy || 0), iso(date));
      }
      if (R.random() < 0.08) {
        insertLog.run(itemIds['Mat disinfectant 5 L'], 'remove', 1, 'Used — weekly mat cleaning', null, iso(date));
      }
      // Occasional shrinkage: a damaged or expired write-off feeds the loss KPI.
      if (R.random() < 0.07) {
        const name = R.choice(sellable);
        insertLog.run(itemIds[name], 'remove', R.randint(1, 2), R.random() < 0.5 ? 'Damaged' : 'Expired', null, iso(date));
      }
    }

    // Flag the synthetic walk-ins (the only member-less session rows) so the
    // walk-in reports match — mirrors the migration backfill in openDb.
    run("UPDATE payments SET walk_in=1 WHERE member_id IS NULL AND kind='session'");

    return memberIds.length;
  });

  const count = tx();
  return count;
}

module.exports = { seed, seedAdmin };
