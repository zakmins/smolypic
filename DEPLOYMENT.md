# Deployment & Updates — SMOLYMPIC (gym PC)

How to install the app on the gym PC, ship bug-fix updates, and build new
version installers. The gym's data is **never** at risk during an update — see
[Why your data is safe](#why-your-data-is-safe).

---

## Where things live

| What | Location |
|------|----------|
| Installed program files | `%LOCALAPPDATA%\Programs\smolympic` |
| Database (members, payments, users, …) | `%APPDATA%\Roaming\SMOLYMPIC\smolympic.db` |
| Built installer (on your dev machine) | `release\SMOLYMPIC Setup <version>.exe` |

The database is in a **separate folder** from the program files. Installing or
reinstalling the app only replaces the program files — it never touches the
database folder.

---

## First-time install (clean gym PC)

The packaged build starts **clean**: no demo data, just one administrator account.

1. On your machine, build the installer (see [Build a new version installer](#build-a-new-version-installer)).
2. Copy `SMOLYMPIC Setup <version>.exe` to the gym PC (USB stick or network share).
   Nothing else is needed — Node, SQLite, and the database engine are all bundled.
3. Run the installer. It installs per-user and creates a desktop / Start-menu
   shortcut named **SMOLYMPIC**.
   - Windows SmartScreen may show *"Windows protected your PC"* because the app
     is unsigned → click **More info → Run anyway**. This is expected.
4. Launch the app. On this very first run it creates a fresh, empty database at
   `%APPDATA%\Roaming\SMOLYMPIC\smolympic.db`.
5. Sign in with the default administrator account:
   - **Username:** `admin`
   - **Password:** `admin`
6. **Immediately** go to **Settings → Users** and change the admin password.
   Also review the price book under **Settings**.

---

## Update an existing install (ship a bug fix)

Use this when the app is already installed on the gym PC and you have fixed bugs
on your machine. All gym data is preserved.

**On your machine:**

1. Make and save your bug fixes.
2. Build a new installer with a bumped version (see below) →
   e.g. `release\SMOLYMPIC Setup 0.1.1.exe`.

**On the gym PC:**

3. *(Recommended)* Back up the database first — copy this file somewhere safe:
   ```
   copy "%APPDATA%\Roaming\SMOLYMPIC\smolympic.db" "%USERPROFILE%\Desktop\smolympic-backup.db"
   ```
4. Close the SMOLYMPIC app if it's running.
5. Run the new `SMOLYMPIC Setup <version>.exe`. The installer detects the
   existing install, replaces the old program files, and leaves the database
   folder untouched.
6. Launch and sign in as usual — same `admin` account and all data intact.

---

## Build a new version installer

This is the only thing that differs between releases: bump the version, then run
one build command.

1. Make sure all your fixes are saved in the project folder.
2. Bump the version in **`package.json`**:
   ```json
   "version": "0.1.1",
   ```
   The output filename uses this value → `SMOLYMPIC Setup 0.1.1.exe`.
3. From the project folder, build:
   ```
   npm run dist
   ```
   This runs:
   - `vite build` — bundles the React frontend into `dist/`
   - `electron-builder` — packages Electron + your code + the native SQLite
     binary into the NSIS installer.

   Takes ~1–2 minutes. If a GitHub download times out, it auto-retries — that's
   normal.
4. Collect the result:
   ```
   release\SMOLYMPIC Setup 0.1.1.exe
   ```
   That single `.exe` is everything the gym PC needs.

> If the native SQLite module ever needs re-fetching for Electron's ABI, run
> `npm run rebuild:sqlite` and build again.

---

## Why your data is safe

- The database lives in `%APPDATA%\Roaming\SMOLYMPIC\`, **not** in the program
  folder the installer manages — so reinstalling never deletes it.
- The app only seeds/initializes a database when the file is **missing**
  (`initDb()` in `electron/main.js`). On an update the file already exists, so it
  just opens the existing data as-is — no seeding, no overwrite.
- Schema changes are handled automatically on open: `CREATE TABLE IF NOT EXISTS`
  adds any new tables and `ensureColumn()` adds new columns to existing tables.
  This covers **additive** changes transparently. Renaming/dropping columns or
  transforming existing rows would require an explicit migration in `openDb()`.

---

## Reset the gym PC to a clean state (rarely needed)

To wipe all data and start over with just the `admin`/`admin` account:

1. Close the app.
2. Delete the database file:
   ```
   del "%APPDATA%\Roaming\SMOLYMPIC\smolympic.db"
   ```
3. Relaunch — it recreates a fresh, empty database with only the admin account.

> Note: if the gym PC ever ran a **dev/demo** build, that demo database is
> already on disk and won't be overwritten by an install. Delete the `.db` file
> as above before the first real launch to get a clean start.
