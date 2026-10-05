// Selective backup: users + configuration tables only (no student records,
// approvals, logs, notifications or history).
//
// Usage:
//   cd backend && node scripts/backupUsersConfig.js [--out=path] [--dbname=NAME]
//
// Reads the connection from backend/.env (DATABASE_URL or DB_* vars, same as
// config/database.js). Writes a timestamped custom-format dump under logs/:
//   logs/backup-users-config-YYYYMMDD-HHmmss.dump
//
// Needs pg_dump on PATH; otherwise set PGBIN or pass
// --pg-bin="C:\Program Files\PostgreSQL\16\bin".
// Run it on the database server itself if this machine has no pg tools.
//
// Reads the connection from backend/.env (DATABASE_URL or DB_* vars, same as
// config/database.js). Writes a timestamped custom-format dump under logs/:
//   logs/backup-users-config-YYYYMMDD-HHmmss.dump
//
// Restore with: node scripts/restoreUsersConfig.js <dumpfile> --db=<dbname>
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { spawnSync } = require('child_process');

const TABLES = [
  // Users & access
  'users',
  'permissions',
  'approval_scopes',
  'wali_kelas_assignment',
  // Configuration
  'school_config',
  'ipt_config',
  'ipt_organisasi',
  'ipt_perilaku_karakter',
  'ipt_perilaku_tingkat',
  'ipt_pelanggaran_level',
  'ipt_pelanggaran_detail',
  'input_access_control'
];

function parseArgs() {
  const out = { out: null, dbname: null, pgBin: process.env.PGBIN || null };
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    else if (a.startsWith('--dbname=')) out.dbname = a.slice('--dbname='.length);
    else if (a.startsWith('--pg-bin=')) out.pgBin = a.slice('--pg-bin='.length);
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function connectionArgs(dbName) {
  // Returns { args, env } fragments. Prefers DATABASE_URL when set
  // (it already contains the database), otherwise DB_HOST/PORT/USER.
  const env = { ...process.env };
  const args = [];
  if (process.env.DATABASE_URL) {
    args.push('-d', process.env.DATABASE_URL);
    return { args, env };
  }
  if (process.env.DB_HOST) args.push('-h', process.env.DB_HOST);
  if (process.env.DB_PORT) args.push('-p', String(process.env.DB_PORT));
  if (process.env.DB_USER) args.push('-U', process.env.DB_USER);
  if (process.env.DB_PASSWORD !== undefined) env.PGPASSWORD = process.env.DB_PASSWORD;
  args.push('-d', dbName);
  return { args, env };
}

(function main() {
  const { out, dbname, pgBin } = parseArgs();
  const pgDump = pgBin ? path.join(pgBin, 'pg_dump') : 'pg_dump';
  const dbName = dbname || process.env.DB_NAME || 'ipt_school';
  const { args: connArgs, env } = connectionArgs(dbName);

  const logsDir = path.join(__dirname, '..', '..', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const dumpPath = out || path.join(logsDir, `backup-users-config-${stamp()}.dump`);

  const dumpArgs = [...connArgs, '-F', 'c', '-f', dumpPath];
  for (const t of TABLES) dumpArgs.push('-t', t);

  console.log(`Backing up ${TABLES.length} tables from "${dbName}" ...`);
  const res = spawnSync(pgDump, dumpArgs, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error) {
    console.error(`Failed to run pg_dump: ${res.error.message}`);
    console.error('PostgreSQL client tools not found. Either add them to PATH,');
    console.error('set PGBIN to their folder, or pass --pg-bin="C:\\Program Files\\PostgreSQL\\16\\bin".');
    console.error('Run this script on the database server itself if needed.');
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`pg_dump exited with code ${res.status}`);
    process.exit(1);
  }

  const sizeKb = Math.max(1, Math.round(fs.statSync(dumpPath).size / 1024));
  console.log(`\nDone: ${dumpPath} (${sizeKb} KB, tables: ${TABLES.join(', ')})`);
  console.log('NOTE: this file contains bcrypt password hashes — treat it as a secret.');
  console.log(`Verify/restore with: node scripts/restoreUsersConfig.js "${dumpPath}" --db=ipt_restore_test --create`);
})();
