// Restore + verify a backupUsersConfig.js dump.
//
// Usage:
//   cd backend && node scripts/restoreUsersConfig.js <dumpfile> --db=<dbname> [--create] [--force-live]
//
//   --db        Target database (required).
//   --create    Run createdb first (target must not exist).
//   --force-live Required when --db equals the live DB_NAME from .env.
//               Without it the script refuses to touch the live database.
//               Even with it, restoring over tables that already hold rows
//               will raise duplicate-key errors — reconcile/truncate first.
//
// After restoring, the script prints row counts per table so you can compare
// them against the live database.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { spawnSync } = require('child_process');

const TABLES = [
  'users',
  'permissions',
  'approval_scopes',
  'wali_kelas_assignment',
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
  const out = { file: null, db: null, create: false, forceLive: false, pgBin: process.env.PGBIN || null };
  for (const a of process.argv.slice(2)) {
    if (a === '--create') out.create = true;
    else if (a === '--force-live') out.forceLive = true;
    else if (a.startsWith('--db=')) out.db = a.slice('--db='.length);
    else if (a.startsWith('--pg-bin=')) out.pgBin = a.slice('--pg-bin='.length);
    else if (!a.startsWith('--') && !out.file) out.file = a;
    else {
      console.error(`Unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!out.file || !out.db) {
    console.error('Usage: node scripts/restoreUsersConfig.js <dumpfile> --db=<dbname> [--create] [--force-live] [--pg-bin=...]');
    process.exit(2);
  }
  return out;
}

function tool(name, pgBin) {
  return pgBin ? path.join(pgBin, name) : name;
}

function baseArgs() {
  const env = { ...process.env };
  const args = [];
  if (process.env.DB_HOST) args.push('-h', process.env.DB_HOST);
  if (process.env.DB_PORT) args.push('-p', String(process.env.DB_PORT));
  if (process.env.DB_USER) args.push('-U', process.env.DB_USER);
  if (process.env.DB_PASSWORD !== undefined) env.PGPASSWORD = process.env.DB_PASSWORD;
  return { args, env };
}

function connectionArgs(dbName) {
  const { args, env } = baseArgs();
  // NOTE: DATABASE_URL (live DB) is intentionally not used here — restores
  // always address an explicit --db host/database, never the live URL.
  args.push('-d', dbName);
  return { args, env };
}

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, { env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.error) {
    console.error(`Failed to run ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`${cmd} exited with code ${res.status}`);
    process.exit(1);
  }
}

function countRows(dbName, table, pgBin) {
  const { args, env } = connectionArgs(dbName);
  const res = spawnSync(tool('psql', pgBin), [...args, '-t', '-A', '-c', `SELECT COUNT(*) FROM "${table}"`], {
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  if (res.error || res.status !== 0) return 'ERR';
  return (res.stdout || '').trim();
}

(function main() {
  const { file, db, create, forceLive, pgBin } = parseArgs();
  if (!fs.existsSync(file)) {
    console.error(`Dump file not found: ${file}`);
    process.exit(1);
  }

  const liveDb = process.env.DB_NAME || 'ipt_school';
  if (db === liveDb && !forceLive) {
    console.error(`Refusing to restore over the live database "${liveDb}" without --force-live.`);
    console.error(`Restore into a scratch DB instead: --db=ipt_restore_test --create`);
    process.exit(1);
  }

  const { args, env } = connectionArgs(db);
  if (create) {
    console.log(`Creating database "${db}" ...`);
    const srv = baseArgs();
    run(tool('createdb', pgBin), [...srv.args, db], srv.env);
  }

  console.log(`Restoring "${file}" into "${db}" ...`);
  run(tool('pg_restore', pgBin), [...args, '--clean', '--if-exists', file], env);

  console.log('\nRow counts in restored DB:');
  for (const t of TABLES) {
    console.log(`  ${t}: ${countRows(db, t, pgBin)}`);
  }
  console.log('\nCompare against live with e.g.:');
  console.log(`  node scripts/restoreUsersConfig.js counts are printed per table — run`);
  console.log(`  psql -U postgres -d ${liveDb} -c "SELECT COUNT(*) FROM users;" for a spot check.`);
})();
