// Smolympic — Electron main process.
// Owns the SQLite database (better-sqlite3) and answers the renderer's data
// requests over IPC — there is no HTTP server. Also exposes an RFID-reader channel:
// a real RFID reader would forward events via win.webContents.send('rfid:swipe', uid).

const { app, BrowserWindow, ipcMain, Menu, protocol, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { openDb } = require('./server/db.js');
const { seed, seedAdmin } = require('./server/seed.js');
const { handleRequest } = require('./server/router.js');

let win = null;
let db = null;

// Member portraits are served on demand via smolphoto://photo/<id> — bytes stay
// out of the data payloads. Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'smolphoto', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// The database lives in userData (writable in a packaged app). It is seeded with
// the synthetic dataset the first time the app runs. Delete this file to reset.
function initDb() {
  const dbPath = path.join(app.getPath('userData'), 'smolympic.db');
  const fresh = !fs.existsSync(dbPath);
  db = openDb(dbPath);
  if (fresh) {
    // Packaged builds (the real deployment, e.g. the gym PC) start clean: just an
    // admin/admin account, no demo data. Dev runs get the full synthetic dataset
    // so the UI has something to show. Force demo in a packaged build with
    // SMOLYMPIC_SEED_DEMO=1 if you ever need it.
    if (app.isPackaged && process.env.SMOLYMPIC_SEED_DEMO !== '1') {
      seedAdmin(db);
      console.log(`[smolympic] initialized a clean database (admin only) at ${dbPath}`);
    } else {
      const n = seed(db);
      console.log(`[smolympic] seeded a fresh demo database (${n} members) at ${dbPath}`);
    }
  } else {
    console.log(`[smolympic] using database at ${dbPath}`);
  }
}

function createWindow() {
  // No default application menu: it hijacks F11 (its built-in "Toggle Full
  // Screen" accelerator), which would fight the window-mode handling below.
  Menu.setApplicationMenu(null);

  win = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0B0D11',
    autoHideMenuBar: true,
    title: 'SMOLYMPIC',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // ── Window mode ───────────────────────────────────────────────────────────
  // Maximize button ⇒ true fullscreen (taskbar hidden). F11 ⇒ back to a window.
  // We unmaximize *before* entering fullscreen, so the state Electron restores
  // when leaving fullscreen is a normal window (not a maximized frame). That's
  // what makes F11 land cleanly on windowed mode instead of bouncing back into
  // fullscreen. `switching` swallows the extra 'maximize' Windows emits while we
  // drive the transition.
  let switching = false;
  win.on('maximize', () => {
    if (switching) return;
    switching = true;
    win.unmaximize();
    win.setFullScreen(true);
    setTimeout(() => { switching = false; }, 250);
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  win.on('closed', () => { win = null; });
}

// All renderer data access funnels through this one channel; the router maps
// { method, path, body, token } to a handler exactly as the REST API used to.
ipcMain.handle('api:request', (_evt, payload) => handleRequest(db, payload || {}));

// Renderer can ask the main process to emit a swipe (used by the demo
// simulator); a real RFID reader integration would call the same send().
ipcMain.on('rfid:simulate', (_evt, rfidUid) => {
  if (win) win.webContents.send('rfid:swipe', rfidUid);
});

app.whenReady().then(() => {
  initDb();

  // Serve member portraits: smolphoto://photo/<id> → the stored JPEG (404 if none).
  protocol.handle('smolphoto', (req) => {
    let id = 0;
    try { id = Number(new URL(req.url).pathname.replace(/\D/g, '')); } catch { /* bad url */ }
    let row = null;
    try { if (db && id) row = db.prepare('SELECT photo FROM member_photos WHERE member_id=?').get(id); } catch { /* db gone */ }
    if (!row || !row.photo) return new Response('', { status: 404 });
    return new Response(row.photo, {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' },
    });
  });

  // Grant camera access to our own content so getUserMedia works (it fails
  // silently otherwise). We only ever request 'media' from the webcam UI.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) { db.close(); db = null; }
  if (process.platform !== 'darwin') app.quit();
});
