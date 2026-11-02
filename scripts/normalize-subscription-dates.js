const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function usage() {
  console.log(`Normalize member subscription dates to YYYY-MM-DD.

Usage:
  npm run db:normalize-dates -- [--db <path>] [--dry-run]
  npm run db:normalize-dates -- --repair-member <id> --start-date YYYY-MM-DD [--db <path>]

Defaults to sm/smolympic.db. A timestamped SQLite backup is created before
the database is changed.`);
}

function parseArgs(args) {
  const options = { dbPath: path.resolve('sm', 'smolympic.db'), dryRun: false, repairMember: null, startDate: null };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--help' || args[i] === '-h') {
      usage();
      process.exit(0);
    } else if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--repair-member' && args[i + 1]) {
      options.repairMember = Number(args[++i]);
      if (!Number.isSafeInteger(options.repairMember) || options.repairMember <= 0) {
        throw new Error('--repair-member must be a positive integer');
      }
    } else if (args[i] === '--start-date' && args[i + 1]) {
      options.startDate = args[++i];
    } else if (args[i] === '--db' && args[i + 1]) {
      options.dbPath = path.resolve(args[++i]);
    } else {
      throw new Error(`Unknown or incomplete option: ${args[i]}`);
    }
  }
  if ((options.repairMember == null) !== (options.startDate == null)) {
    throw new Error('--repair-member and --start-date must be provided together');
  }
  if (options.repairMember != null && options.dryRun) {
    throw new Error('--dry-run cannot be combined with a member repair');
  }
  return options;
}

function normalizeDate(value, memberId, field) {
  if (value == null) return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (!match) throw new Error(`Member ${memberId} has an unsupported ${field} value: ${value}`);

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  const y = +year;
  const m = +month;
  const d = +day;
  const daysInMonth = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (!daysInMonth || d < 1 || d > daysInMonth
      || +hour > 23 || +minute > 59 || +second > 59) {
    throw new Error(`Member ${memberId} has an invalid ${field} value: ${value}`);
  }
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, days) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    + `-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
}

async function main() {
  const { dbPath, dryRun, repairMember, startDate } = parseArgs(process.argv.slice(2));
  const repairedStartDate = startDate == null ? null : normalizeDate(startDate, repairMember, 'start date');
  if (startDate != null && repairedStartDate !== startDate) {
    throw new Error('--start-date must use YYYY-MM-DD format');
  }
  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { timeout: 5000 });
  try {
    const rows = db.prepare('SELECT id, sub_start, sub_end, duration_days FROM members ORDER BY id').all();
    const target = repairMember == null ? null : rows.find((row) => row.id === repairMember);
    if (repairMember != null && !target) throw new Error(`Member ${repairMember} not found`);
    if (target && (target.sub_start !== 'NaN-NaN-NaN' || target.sub_end !== 'NaN-NaN-NaN')) {
      throw new Error(`Member ${repairMember} does not have NaN-NaN-NaN in both subscription dates`);
    }
    if (target && (!Number.isSafeInteger(target.duration_days) || target.duration_days <= 0)) {
      throw new Error(`Member ${repairMember} has no valid positive duration_days`);
    }

    const updates = rows.map((row) => {
      const repair = row.id === repairMember;
      return {
        id: row.id,
        oldStart: row.sub_start,
        oldEnd: row.sub_end,
        subStart: repair ? repairedStartDate : normalizeDate(row.sub_start, row.id, 'sub_start'),
        subEnd: repair ? addDays(repairedStartDate, row.duration_days)
          : normalizeDate(row.sub_end, row.id, 'sub_end'),
      };
    }).filter((row) => row.subStart !== row.oldStart || row.subEnd !== row.oldEnd);
    const changedStarts = updates.filter((row) => row.subStart !== row.oldStart).length;
    const changedEnds = updates.filter((row) => row.subEnd !== row.oldEnd).length;

    console.log(`Database: ${dbPath}`);
    console.log(`Members to normalize: ${updates.length} (${changedStarts} start dates, ${changedEnds} end dates)`);
    if (target) {
      console.log(`Repair member ${target.id}: ${target.sub_start} / ${target.sub_end} -> `
        + `${repairedStartDate} / ${addDays(repairedStartDate, target.duration_days)} `
        + `(${target.duration_days} days)`);
    }
    if (!updates.length) {
      console.log('No changes needed.');
      return;
    }
    if (dryRun) {
      console.log('Dry run only; database was not changed.');
      return;
    }

    const backupPath = `${dbPath}.backup-${timestamp()}`;
    if (fs.existsSync(backupPath)) throw new Error(`Backup already exists: ${backupPath}`);
    await db.backup(backupPath);

    const updateMember = db.prepare('UPDATE members SET sub_start=?, sub_end=? WHERE id=?');
    const migrate = db.transaction(() => {
      for (const row of updates) updateMember.run(row.subStart, row.subEnd, row.id);

      const migrated = db.prepare('SELECT id, sub_start, sub_end FROM members ORDER BY id').all();
      for (const row of migrated) {
        if (normalizeDate(row.sub_start, row.id, 'sub_start') !== row.sub_start
            || normalizeDate(row.sub_end, row.id, 'sub_end') !== row.sub_end) {
          throw new Error(`Date normalization verification failed for member ${row.id}`);
        }
      }
    });
    migrate();

    console.log(`Normalized ${updates.length} member(s).`);
    console.log(`Backup: ${backupPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(`Date normalization failed: ${error.message}`);
  process.exitCode = 1;
});
