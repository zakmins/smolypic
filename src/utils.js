// Shared UI constants & formatting helpers. All data now comes from the API.

export const SPORTS = ['GYM', 'JUDO', 'WRESTLING', 'CARDIO'];
export const SPORT_COLOR = {
  GYM: 'var(--accent)',
  JUDO: 'var(--judo)',
  WRESTLING: 'var(--wrestling)',
  CARDIO: 'var(--cardio)',
};

export const BELTS = ['White','Yellow','Orange','Green','Blue','Brown','Black 1st Dan','Black 2nd Dan'];
export const BELT_COLOR = ['#E8E6E0','#F5C518','#FF8C2E','#37B36B','#3D8BFF','#8B5A2B','#444B52','#444B52'];
export const WEIGHT_CATS = ['Flyweight','Bantamweight','Featherweight','Lightweight','Welterweight','Middleweight','Heavyweight','Super Heavyweight'];
export const STOCK_CATEGORIES = ['Equipment','Supplements','Consumables','Merchandise','Maintenance'];

// sub_end is the renewal day (exclusive) and is stored date-only (YYYY-MM-DD): a
// 30-day sub paid on the 25th runs through the 24th next month and lapses on the
// 25th — exactly 30 days. Parse as local time (a bare date string reads as UTC
// otherwise). Mirrors subDaysLeft in electron/server/router.js.
export const daysRemaining = (m) => {
  const end = new Date(`${String(m.subEnd).slice(0, 10)}T00:00:00`).getTime();
  return Math.ceil((end - Date.now()) / 86400000);
};

// A subscription is either UNLIMITED (date-window only) or METERED (date + a
// session quota). The quota is encoded in sessionsTotal/sessionsLeft:
//   NULL ⇒ unlimited, a number ⇒ metered. Pay-per-session is its own type.
export const isSubscription = (m) => m.membershipType === 'subscription';
export const isUnlimitedSub = (m) => isSubscription(m) && m.sessionsTotal == null;
export const isMeteredSub = (m) => isSubscription(m) && m.sessionsTotal != null;
// Members whose entries burn a session: pay-per-session or metered subs.
export const usesSessionQuota = (m) => m.membershipType === 'session' || isMeteredSub(m);

export const memberStatus = (m) => {
  if (m.membershipType === 'session') {
    return m.sessionsLeft > 0 ? 'session' : 'expired';
  }
  // Subscription: expires on date; metered subs also expire when sessions run out.
  const dateOk = daysRemaining(m) > 0;
  const sessionsOk = m.sessionsTotal == null || m.sessionsLeft > 0;
  return dateOk && sessionsOk ? 'active' : 'expired';
};

// The "remaining" figure shown in lists/rows: "Unlimited" for unlimited subs,
// a session count for metered subs and pay-per-session members.
export const remainingLabel = (m) =>
  isUnlimitedSub(m) ? 'Unlimited' : `${m.sessionsLeft} sess.`;

// Negative quota ⇒ the club is carrying the member (owes sessions). Unlimited subs
// have no quota (sessionsLeft NULL) so they never qualify.
export const isSessionsOwed = (m) => m.sessionsLeft != null && m.sessionsLeft < 0;

// A subscription about to lapse (excluding the already-expired). Returns the
// triggering axis 'date' | 'sessions' | 'both', or null. Unlimited subs trip on
// the date axis only; metered subs on either axis. Must match the server rule in
// electron/server/router.js (same < 2 thresholds, same ceil day count).
export const expiringReason = (m) => {
  if (!isSubscription(m)) return null;
  const dr = daysRemaining(m);
  const metered = isMeteredSub(m);
  if (dr <= 0 || (metered && m.sessionsLeft <= 0)) return null;   // already expired
  const dateAxis = dr < 2;
  const sessionsAxis = metered && m.sessionsLeft < 2;
  if (!dateAxis && !sessionsAxis) return null;
  return dateAxis && sessionsAxis ? 'both' : dateAxis ? 'date' : 'sessions';
};

// Compact page-number list with ellipses (1 … 4 5 6 … 20) for pagers.
export function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

// Local YYYY-MM-DD for a timestamp — matches an <input type="date"> value.
export const dayKey = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Insurance: a yearly fee. 500 DZD is only the fallback shown before the price
// book loads — the live amount comes from the API (pricing.insurance).
export const INSURANCE_PRICE = 500;

// ── Price-book resolvers (pricing object comes from the API via AppCtx) ─────────
// The default per-session rate — the first configured session price. Matches the
// server rule in electron/server/db.js (sessionPriceFor).
export const defaultSessionPrice = (pricing) =>
  (pricing && pricing.sessions && pricing.sessions[0] ? pricing.sessions[0].price : 0);
// Monthly subscription price for a membership category + weekly-plan tier.
// Judo/Wrestling are flat monthly (the access tier is ignored).
export const monthlySubPrice = (pricing, category, access) => {
  const subs = pricing && pricing.subscriptions && pricing.subscriptions[category];
  if (!subs) return 0;
  if (subs.monthly != null) return subs.monthly;
  return subs[access] != null ? subs[access] : (subs.unlimited ?? 0);
};
export const insuranceStatus = (m) => {
  if (!m.insurance) return 'none';
  if (!m.insuranceExpiry) return 'active';                       // enrolled, legacy without an expiry
  return new Date(m.insuranceExpiry) >= new Date() ? 'active' : 'expired';
};
export const insuranceDaysLeft = (m) =>
  m.insuranceExpiry ? Math.ceil((new Date(m.insuranceExpiry) - Date.now()) / 86400000) : null;

export const dzd = (n) => `${Number(n).toLocaleString('en-US')} DZD`;

// ── Sell-by-weight supplements ────────────────────────────────────────────────
// Weight items track stock in grams (item.unit === 'g') and are sold as scoops.
// fmtWeight shows grams under 1 kg and kg above, trimming trailing zeros
// ("250 g", "12 kg", "4.5 kg"). fmtStockQty picks the right unit for any item.
export const isWeightItem = (it) => it?.unit === 'g';
export const fmtWeight = (grams) => {
  const g = Math.round(Number(grams) || 0);
  if (Math.abs(g) < 1000) return `${g} g`;
  const kg = g / 1000;
  return `${Number(kg.toFixed(2))} kg`;   // toFixed→Number drops trailing zeros (12.00→12)
};
export const fmtStockQty = (it) => (isWeightItem(it) ? fmtWeight(it.qty) : String(it.qty));
// Per-gram buy cost → DZD per kg, for display (weight items store buy per gram).
export const buyPerKg = (it) => Math.round((Number(it.buy) || 0) * 1000);
export const initials = (name) => name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const fmtTime = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const age = (dob) => Math.floor((Date.now() - new Date(dob)) / (365.25 * 86400000));
export const hhmmss = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
};
export const durationLabel = (ms) => {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
};
