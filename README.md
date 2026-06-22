# Smolympic

Bold, sporty **offline desktop** gym management for a club in Algiers — live floor presence, full member CRUD, judo & wrestling modules, statistics, and stock management. **React (Vite) renderer + Electron**, with the data layer (SQLite via **better-sqlite3**) running in the Electron main process and reached over IPC — no server, no network, fully offline.

**Design**: emerald→teal gradient identity, light & dark themes (toggle in the top bar, persisted), italic heavyweight display type, mono for everything live. Charts are interactive Recharts components that follow the active theme.

## Quick start

Requires **Node 18+**. There is no separate backend process — the database is embedded in the app.

```bash
npm install            # also fetches the better-sqlite3 binary for Electron (postinstall)
npm run electron:dev   # launches the desktop app (Vite dev server + Electron)
```

On first launch the app **auto-seeds** a synthetic database (38 members, months of entries & payments, admin + coaches) into Electron's `userData` directory. Delete `smolympic.db` in that directory to reset to a fresh seed. **Upgrading from an older build?** The member identifier moved from `sim_id` to a numeric `rfid_uid`, so delete the existing `smolympic.db` once to let it reseed.

To package a distributable: `npm run dist` (electron-builder). If the native module ever needs re-fetching for Electron's ABI, run `npm run rebuild:sqlite`.

> Note: `npm run dev` (a plain browser tab) won't work on its own — the data layer lives in the Electron main process, so the app must run under Electron (`npm run electron:dev`).

**Sign in.** The app opens on a login screen. Seeded accounts:

| Username | Password | Role | Accent |
|----------|----------|------|--------|
| `smail`  | `smail`  | Administrator | emerald (the default look) |
| `karim`  | `karim`  | Coach | purple |
| `nadia`  | `nadia`  | Coach | blue |

Sign in as **smail** to manage users (the **Manage users** item appears in the sidebar for the admin only). Each user has a personal accent color that themes the whole app while they are signed in — Smail's is the original emerald, so the default look is unchanged.

## What the data layer does

Everything is real rows in SQLite — not canned JSON. The renderer calls `api(path, opts)` exactly as before; that now routes over IPC (`window.smolympic.api`) to a request router in the Electron main process (`electron/server/`), which mirrors the previous REST endpoints one-for-one. Tokens are passed through with each call (no HTTP headers).

- **`swipe`** owns all RFID edge cases: unknown tag, IN/OUT graceful toggling (already-inside swiping IN becomes an EXIT and vice-versa), per-entry session billing (300 DZD, 400 with cardio) with decrement **below zero** — negative balance means the club owes the member sessions. Members are keyed by a numeric **RFID tag UID** (`rfid_uid`).
- **`stats`** computes daily/monthly revenue from `payments`, the peak-hours heatmap and top-visitors from `entries`, retention, expiring-in-7-days and inactive-30+-days lists — all via SQL.
- Members CRUD + **`renew`** (records a payment), per-member entry history, stock CRUD with audited add/remove operations and a most-consumed ranking from the movement log.
- **Auth & audit**: `login` / `logout` / `me` with token-based sessions; passwords hashed with `crypto.pbkdf2_hmac` SHA-256 + per-user salt. Every mutation — login/logout, member create/edit/delete/renew, stock CRUD and add/remove ops, and all user management — writes a human-readable entry to `activity_log`. Admin-only user CRUD + per-user activity timeline; coaches get 403, the admin account can't be deleted.
- The database auto-seeds on first launch (admin **Smail** + two example coaches included); delete the `smolympic.db` file in `userData` to reset.

## Touring the app

- **Live status**: members inside with ticking HH:MM:SS timers, recent exits, today's till in the top bar.
- **RFID reader**: a USB RFID reader is an HID keyboard — it "types" the tag's numeric UID and presses Enter. The app captures this **globally** (no need to click into a field): a keyboard-wedge listener tells scanner bursts from human typing by speed, swallows the keystrokes so they never leak into a focused input, and pops a centered scan card. On a French **AZERTY** layout the unshifted number row sends `& é " ' ( - è _ ç à` instead of digits, so the listener maps those symbols back to `1234567890` — the UID resolves correctly whether or not CAPS LOCK is on. The card stays on screen until dismissed (×, click outside, or Esc) and shows membership type, sessions left (incl. owed), subscription end date and days remaining; back-to-back scans queue with a “+N waiting” counter.
- **Simulate a scan** (top-right **Test scan** button, or press **S** anywhere — even while a popup is open): emulates a real reader by dispatching a fast AZERTY keystroke burst through the same global capture path.
- **Window**: clicking the **maximize** button goes **true fullscreen** (taskbar hidden); **F11** toggles back to a normal window.
- **Members**: search/filters/sorts, profile drawer with entry history, renewal (recorded as a payment), add/edit with RFID tag UID.
- **Judo / Wrestling**: belt & weight-category distributions, schedules, competition records, coach notes / physical stats.
- **Statistics**: revenue lines (this vs last month), monthly bars, sport donut, splits, new members, retention, peak-hours heatmap, top-10 visitors, at-risk and inactive lists.
- **Stock**: inventory CRUD, low-stock & expiry alerts, restock/remove with full audit log, most-consumed ranking.
- **Manage users** (admin only): coach accounts with a name, address, phone and a personal accent color (native color picker + presets with a live preview); create / edit (password optional on edit) / delete with a confirm modal. Click any user to open a drawer with their full activity timeline — sign-ins, sign-outs and every action they took, newest first.

## Structure

```
electron/
  main.js            window + DB lifecycle + fullscreen + IPC (api:request, rfid swipe bridge)
  preload.js         exposes window.smolympic.api(...) and the rfid swipe channel
  server/
    db.js            better-sqlite3 schema, serializers, PBKDF2 hashing
    router.js        request router — swipe engine, CRUD, SQL-computed statistics
    seed.js          deterministic synthetic database generator
src/
  api.js             data client over IPC (token + 401 handling, same signature)
  auth.jsx           auth context: currentUser, token, login(), logout()
  accent.js          per-user accent color → CSS variable overrides
  theme.jsx          light/dark provider          utils.js   constants & formatters
  charts/Charts.jsx  Recharts line/bar/donut + grid heatmap, theme-aware
  components/        Sidebar, TopBar, SwipePopup, atoms
  pages/             Login, LiveStatus, Customers, Judo, Wrestling, Statistics, Stock, Users
  styles.css         dual-theme design system
```
