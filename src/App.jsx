import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { daysRemaining, memberStatus } from './utils.js';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import SwipePopup from './components/SwipePopup.jsx';
import ZoomViewport from './components/ZoomViewport.jsx';
import LiveStatus from './pages/LiveStatus.jsx';
import Customers from './pages/Customers.jsx';
import Judo from './pages/Judo.jsx';
import Wrestling from './pages/Wrestling.jsx';
import Statistics from './pages/Statistics.jsx';
import MembersReports from './pages/Reports.jsx';
import StockDashboard from './pages/StockDashboard.jsx';
import { StockManagement, StockInventory } from './pages/Stock.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import { ThemeProvider, useTheme } from './theme.jsx';
import { LanguageProvider, useLanguage, useT } from './i18n.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import { applyAccent, clearAccent } from './accent.js';

export const AppCtx = React.createContext(null);


// ── RFID keyboard layout maps ────────────────────────────────────────────────
// A USB RFID reader is an HID keyboard: it "types" the tag's numeric UID and
// presses Enter. On a French AZERTY layout the unshifted number row produces
// symbols, not digits, so unless CAPS LOCK is on the reader sends & é " ' … —
// we translate those back to digits. AZERTY_TO_DIGIT decodes captured keys;
// DIGIT_TO_AZERTY lets the demo simulator emulate the same symbols.
const AZERTY_TO_DIGIT = { '&': '1', 'é': '2', '"': '3', "'": '4', '(': '5', '-': '6', 'è': '7', '_': '8', 'ç': '9', 'à': '0' };
const DIGIT_TO_AZERTY = Object.fromEntries(Object.entries(AZERTY_TO_DIGIT).map(([k, v]) => [v, k]));
// A single keystroke → its digit (real digit row, numpad, or AZERTY symbol), else null.
const keyToDigit = (key) => (key.length === 1 ? (/[0-9]/.test(key) ? key : (AZERTY_TO_DIGIT[key] ?? null)) : null);

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

// Gate: the login screen shows until there's a valid session; the active user's
// accent color themes the whole app and follows light/dark theme changes.
function Root() {
  const { currentUser, ready } = useAuth();
  const { theme, setTheme } = useTheme();
  const { setLanguage } = useLanguage();
  const t = useT();

  useEffect(() => {
    if (currentUser?.color) applyAccent(currentUser.color, theme);
    else clearAccent();
  }, [currentUser?.color, theme]);

  // Apply each user's saved theme + language when their session loads.
  useEffect(() => {
    if (!currentUser) return;
    if (currentUser.theme) setTheme(currentUser.theme);
    if (currentUser.language) setLanguage(currentUser.language);
  }, [currentUser?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return <div className="login-screen"><div className="app-loader" role="status" aria-label={t('Loading…')} /></div>;
  }
  if (!currentUser) return <Login />;
  return <Dashboard />;
}

function Dashboard() {
  const { currentUser } = useAuth();
  const { setTheme } = useTheme();
  const { setLanguage } = useLanguage();
  const t = useT();
  const [route, setRoute] = useState('live');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [members, setMembers] = useState([]);
  const [presence, setPresence] = useState([]);
  const [exits, setExits] = useState([]);
  const [today, setToday] = useState({ entries: 0, sessionRevenue: 0, subscriptionRevenue: 0, sessionCount: 0, subscriptionCount: 0 });
  const [stock, setStock] = useState([]);
  const [stockLog, setStockLog] = useState([]);
  const [consumed, setConsumed] = useState([]);
  const [pricing, setPricing] = useState(null);   // editable price book (from /bootstrap)
  const [toast, setToast] = useState(null);
  // Cross-page focus: set a member id here, switch to the Members page, and
  // Customers.jsx opens that member's drawer (then clears it).
  const [focusMemberId, setFocusMemberId] = useState(null);

  // ── Swipe popup queue: stays until the operator dismisses it ──
  const [popupQueue, setPopupQueue] = useState([]);
  const dismissPopup = useCallback(() => setPopupQueue((q) => q.slice(1)), []);

  // Callers pass an English key (+ optional {placeholder} vars); the toast is
  // shown in the active language.
  // One shared timer: a new toast cancels the previous one's dismissal so back-to-
  // back toasts each get their full window (and the timer is cleared on unmount).
  const toastTimer = useRef(null);
  const showToast = useCallback((msg, vars) => {
    setToast(t(msg, vars));
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, [t]);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const applyStock = useCallback((p) => {
    setStock(p.stock); setStockLog(p.stockLog); setConsumed(p.consumed);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const d = await api('/bootstrap');
      setMembers(d.members); setPresence(d.presence); setExits(d.exits); setToday(d.today);
      setPricing(d.pricing);
      applyStock(d);
    } catch (e) {
      setLoadError(e.message || 'Could not reach the API');
    } finally {
      setLoading(false);
    }
  }, [applyStock]);

  useEffect(() => { load(); }, [load]);

  // ── RFID swipe: the backend owns the IN/OUT logic and all edge cases ──
  const handleSwipe = useCallback(async (rfidUid) => {
    try {
      const d = await api('/swipe', { method: 'POST', body: { rfidUid } });
      setMembers(d.members); setPresence(d.presence); setExits(d.exits); setToday(d.today);
      setPopupQueue((q) => [...q, d.event]);
    } catch (e) {
      showToast('Swipe failed: {msg}', { msg: e.message });
    }
  }, [showToast]);

  // Hardware bridge: real reader events arrive through Electron's preload.
  useEffect(() => {
    if (window.smolympic?.onSwipe) return window.smolympic.onSwipe(handleSwipe);
    return undefined;
  }, [handleSwipe]);

  // ── Free session: a walk-in paid visit (not a member) added to the floor ──
  const addGuestSession = useCallback(async (name, amount) => {
    try {
      const d = await api('/guest-session', { method: 'POST', body: { name, amount } });
      setMembers(d.members); setPresence(d.presence); setExits(d.exits); setToday(d.today);
      showToast('Session added — {name}', { name: name?.trim() || 'Walk-in' });
    } catch (e) {
      showToast('Could not add session: {msg}', { msg: e.message });
    }
  }, [showToast]);

  // Remove a walk-in from the floor through the backend so presence stays consistent.
  const removeGuestSession = useCallback(async (guestId) => {
    try {
      const d = await api(`/guest-session/${guestId}`, { method: 'DELETE' });
      setMembers(d.members); setPresence(d.presence); setExits(d.exits); setToday(d.today);
      showToast('Session removed');   // key translated in showToast
    } catch (e) {
      showToast('Could not remove session: {msg}', { msg: e.message });
    }
  }, [showToast]);

  // Demo simulator — picks a random member (occasionally an unknown tag) and
  // *emulates a real reader*: it "types" the UID as a fast burst of AZERTY
  // keystrokes (CAPS LOCK off) ending in Enter, exactly like the HID hardware.
  // That exercises the global capture + symbol→digit mapping end to end instead
  // of shortcutting straight to handleSwipe.
  const simulateSwipe = useCallback(() => {
    const unknown = Math.random() < 0.08;
    const uid = unknown || members.length === 0
      ? '9999999999'                                   // not registered ⇒ "unknown tag"
      : members[Math.floor(Math.random() * members.length)].rfidUid;
    for (const ch of String(uid)) {
      const key = DIGIT_TO_AZERTY[ch] ?? ch;
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, [members]);

  // ── Global RFID capture (keyboard wedge) ──────────────────────────────────
  // The reader emits keystrokes anywhere, so the operator never has to click
  // into a field. We tell scanner input apart from human typing by speed: the
  // reader fires keys <THRESHOLD ms apart and finishes with Enter. AZERTY
  // symbols are mapped back to digits so the UID is always numeric regardless
  // of CAPS LOCK. Captured keystrokes are swallowed so they never leak into a
  // focused input.
  useEffect(() => {
    const THRESHOLD = 35;     // ms — max gap between two scanner keystrokes
    const MIN_LEN = 4;        // shortest plausible UID
    const IDLE_FLUSH = 120;   // ms — flush a burst even if no Enter arrives
    let buf = '';
    let last = 0;
    let idleTimer = null;

    const flush = () => {
      const uid = buf;
      buf = '';
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (uid.length < MIN_LEN) return;
      // If an RFID-capture field is focused (assigning a tag to a member), drop the
      // UID into it — this is tag *assignment*, not an entrance: no IN/OUT, no
      // session change. Otherwise it's a normal entrance swipe.
      const el = document.activeElement;
      if (el && el.matches && el.matches('input[data-rfid-capture]')) {
        const setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setVal.call(el, uid);                                  // React-friendly: set then fire input
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      handleSwipe(uid);
    };

    const onKey = (e) => {
      if (e.key === 'Enter') {
        if (buf.length >= MIN_LEN) { e.preventDefault(); e.stopPropagation(); flush(); }
        else buf = '';
        return;
      }
      const digit = keyToDigit(e.key);
      if (digit == null) return;          // not part of a UID — leave normal typing alone
      const now = Date.now();
      if (now - last > THRESHOLD) buf = '';   // gap too long ⇒ start a fresh burst
      last = now;
      buf += digit;
      // Once a fast burst is underway, keep the digits out of any focused field.
      if (buf.length > 1) { e.preventDefault(); e.stopPropagation(); }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(flush, IDLE_FLUSH);
    };

    window.addEventListener('keydown', onKey, true);   // capture phase: beat the inputs
    return () => { window.removeEventListener('keydown', onKey, true); if (idleTimer) clearTimeout(idleTimer); };
  }, [handleSwipe]);

  // 'S' fires a simulated swipe even while a popup is open — exactly how a
  // hardware reader would keep emitting events. (Ignored while typing.)
  // Dev-only: disabled in production so it can't trigger accidental fake scans.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const onKey = (e) => {
      if (e.key.toLowerCase() !== 's' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      simulateSwipe();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [simulateSwipe]);

  // ── Member CRUD ──
  const saveMember = useCallback(async (m) => {
    try {
      const exists = m.id != null && members.some((x) => x.id === m.id);
      const saved = exists
        ? await api(`/members/${m.id}`, { method: 'PUT', body: m })
        : await api('/members', { method: 'POST', body: m });
      setMembers((ms) => (exists ? ms.map((x) => (x.id === saved.id ? saved : x)) : [...ms, saved]));
      if (!exists) setToday(await api('/bootstrap').then((d) => d.today).catch(() => today));
      showToast('{name} saved', { name: saved.name });
      return saved;
    } catch (e) {
      showToast('Save failed: {msg}', { msg: e.message });
      return null;
    }
  }, [members, showToast, today]);

  const renewMember = useCallback(async (id, payload) => {
    try {
      const saved = await api(`/members/${id}/renew`, { method: 'POST', body: payload });
      setMembers((ms) => ms.map((x) => (x.id === saved.id ? saved : x)));
      const d = await api('/bootstrap');
      setToday(d.today);
      showToast('Membership renewed');   // key translated in showToast
      return saved;
    } catch (e) {
      showToast('Renewal failed: {msg}', { msg: e.message });
      return null;
    }
  }, [showToast]);

  const payBalance = useCallback(async (id, amount) => {
    try {
      const saved = await api(`/members/${id}/pay-balance`, { method: 'POST', body: { amount } });
      setMembers((ms) => ms.map((x) => (x.id === saved.id ? saved : x)));
      const d = await api('/bootstrap');
      setToday(d.today);
      showToast('Payment collected — {name}', { name: saved.name });
      return saved;
    } catch (e) {
      showToast('Payment failed: {msg}', { msg: e.message });
      return null;
    }
  }, [showToast]);

  const payInsurance = useCallback(async (id) => {
    try {
      const saved = await api(`/members/${id}/insurance`, { method: 'POST' });
      setMembers((ms) => ms.map((x) => (x.id === saved.id ? saved : x)));
      const d = await api('/bootstrap');
      setToday(d.today);
      showToast('Insurance paid — {name}', { name: saved.name });
      return saved;
    } catch (e) {
      showToast('Insurance failed: {msg}', { msg: e.message });
      return null;
    }
  }, [showToast]);

  const deleteMember = useCallback(async (id) => {
    try {
      await api(`/members/${id}`, { method: 'DELETE' });
      setMembers((ms) => ms.filter((m) => m.id !== id));
      setPresence((ps) => ps.filter((p) => p.memberId !== id));
      showToast('Member deleted');   // key translated in showToast
    } catch (e) {
      showToast('Delete failed: {msg}', { msg: e.message });
    }
  }, [showToast]);

  // ── Stock CRUD + audited operations ──
  const saveStockItem = useCallback(async (it) => {
    try {
      const exists = it.id != null && stock.some((x) => x.id === it.id);
      const p = exists
        ? await api(`/stock/${it.id}`, { method: 'PUT', body: it })
        : await api('/stock', { method: 'POST', body: it });
      applyStock(p);
      showToast('{name} saved', { name: it.name });
    } catch (e) {
      showToast('Save failed: {msg}', { msg: e.message });
    }
  }, [stock, applyStock, showToast]);

  const stockOperation = useCallback(async (itemId, action, qty, reason, cost = null) => {
    try {
      const p = await api(`/stock/${itemId}/op`, { method: 'POST', body: { action, qty, reason, cost } });
      applyStock(p);
      showToast(action === 'add' ? '+{qty} added to stock' : '−{qty} removed from stock', { qty });
    } catch (e) {
      showToast('Operation failed: {msg}', { msg: e.message });
    }
  }, [applyStock, showToast]);

  const deleteStockItem = useCallback(async (id) => {
    try {
      applyStock(await api(`/stock/${id}`, { method: 'DELETE' }));
      showToast('Item deleted');   // key translated in showToast
    } catch (e) {
      showToast('Delete failed: {msg}', { msg: e.message });
    }
  }, [applyStock, showToast]);

  // Admin-only: wipe the stock movement log (quantities are untouched).
  const clearStockLog = useCallback(async () => {
    try {
      applyStock(await api('/stock/log', { method: 'DELETE' }));
      showToast('Movement log cleared');
    } catch (e) {
      showToast('Could not clear log: {msg}', { msg: e.message });
    }
  }, [applyStock, showToast]);

  // ── Per-user UI preferences (theme + language) ──
  // Applied locally at once (optimistic) and persisted to the user's account.
  const savePreferences = useCallback(async (patch) => {
    if (patch.theme) setTheme(patch.theme);
    if (patch.language) setLanguage(patch.language);
    try {
      await api('/me/preferences', { method: 'PUT', body: patch });
    } catch (e) {
      showToast('Could not save preference: {msg}', { msg: e.message });
    }
  }, [setTheme, setLanguage, showToast]);

  // ── Price book (Settings) ──
  const savePricing = useCallback(async (next) => {
    try {
      const { pricing: saved } = await api('/settings', { method: 'PUT', body: { pricing: next } });
      setPricing(saved);
      showToast('Prices saved');   // key translated in showToast
      return saved;
    } catch (e) {
      showToast('Could not save prices: {msg}', { msg: e.message });
      return null;
    }
  }, [showToast]);

  const ctx = useMemo(() => ({
    members, presence, exits, today, stock, stockLog, consumed, pricing,
    saveMember, renewMember, payInsurance, payBalance, deleteMember, saveStockItem, stockOperation, deleteStockItem, clearStockLog, savePricing,
    savePreferences, simulateSwipe, handleSwipe, addGuestSession, removeGuestSession, showToast,
    daysRemaining, memberStatus, setRoute, focusMemberId, setFocusMemberId,
  }), [members, presence, exits, today, stock, stockLog, consumed, pricing, saveMember, renewMember, payInsurance, payBalance,
       deleteMember, saveStockItem, stockOperation, deleteStockItem, clearStockLog, savePricing, savePreferences, simulateSwipe, handleSwipe,
       addGuestSession, removeGuestSession, showToast, focusMemberId]);

  const pages = {
    live: LiveStatus, customers: Customers, judo: Judo, wrestling: Wrestling,
    stats: Statistics, stock: StockManagement, 'stock-inventory': StockInventory,
    'members-reports': MembersReports, 'stock-dashboard': StockDashboard,
    settings: Settings,
  };
  if (currentUser.role === 'admin') pages.users = Users;     // Manage users is admin-only
  const Page = pages[route] || LiveStatus;                   // never render a gated page to a coach

  return (
    <AppCtx.Provider value={ctx}>
      <ZoomViewport>
      <div className="shell">
        <Sidebar route={route} setRoute={setRoute} />
        <div className="main">
          <TopBar />
          <div className="page">
            {loading ? (
              <div className="empty-state" style={{ paddingTop: 120 }}>{t('Loading the Smolympic database…')}</div>
            ) : loadError ? (
              <div className="empty-state" style={{ paddingTop: 100 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--red)', marginBottom: 8 }}>
                  {t('Couldn\'t load data — {msg}', { msg: loadError })}
                </div>
                <div style={{ marginBottom: 16 }}>
                  {t('Run the desktop app with')} <code className="mono" style={{ fontFamily: 'var(--mono)' }}>npm run electron:dev</code>.
                </div>
                <button className="btn primary" onClick={load}>{t('Retry')}</button>
              </div>
            ) : (
              <Page />
            )}
          </div>
        </div>
      </div>
      </ZoomViewport>
      {popupQueue.length > 0 && (
        <SwipePopup event={popupQueue[0]} queued={popupQueue.length - 1} onDismiss={dismissPopup} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </AppCtx.Provider>
  );
}
