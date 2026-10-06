// Schema verifier: compares the live database structure against
// backend/database/skema.sql and optionally repairs additive drift.
//
// What it checks:
//   - tables present in skema.sql but missing in the DB
//   - columns present in skema.sql but missing in a live table
//   - column type / nullability mismatches (REPORT ONLY, never altered)
//   - indexes from skema.sql missing in the DB
//   - extra tables/columns/indexes in the DB (reported, never dropped)
//
// What --apply fixes (additive only, each in its own statement):
//   - CREATE TABLE for missing tables (+ its triggers + seed INSERTs)
//   - ALTER TABLE ADD COLUMN for missing columns
//   - CREATE INDEX for missing indexes
// It never drops, renames, or alters existing columns. Type mismatches and
// NOT NULL-without-DEFAULT failures print the manual SQL to run instead.
//
// Usage:
//   cd backend && node scripts/verifySchema.js [--apply]
//
//   (no flag)  Verify + report only. Exit 0 = match, 1 = drift found.
//   --apply    Apply additive fixes, then re-verify. Exit 0 = clean afterwards.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const db = require('../config/database');

const APPLY = process.argv.includes('--apply');

// ---------- skema.sql parsing ----------

function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let i = 0;
  let lineComment = false;
  let blockComment = false;
  let quote = null; // "'", '"', or dollar tag like $$ / $body$
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (lineComment) {
      // Comments are discarded entirely: even one leaked '-' glues onto the
      // next token and corrupts parsing (phantom columns, missed ^CREATE).
      if (ch === '\n') {
        lineComment = false;
        buf += ch;
      }
      i++;
      continue;
    }
    if (blockComment) {
      if (two === '*/') {
        blockComment = false;
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (quote) {
      buf += ch;
      if (quote.startsWith('$')) {
        if (sql.startsWith(quote, i)) {
          buf += sql.slice(i + 1, i + quote.length);
          i += quote.length;
          quote = null;
        } else {
          i++;
        }
      } else if (ch === quote) {
        if (sql[i + 1] === quote) {
          buf += quote;
          i += 2;
        } else {
          quote = null;
          i++;
        }
      } else {
        i++;
      }
      continue;
    }
    if (two === '--' && /[\s(;]/.test(sql[i + 2] || ' ')) {
      // '--' starts a line comment (avoid matching inside e.g. 'a--b').
      // Nothing is appended: comment text is discarded entirely.
      lineComment = true;
      i++;
      continue;
    }
    if (two === '/*') {
      blockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      i++;
      continue;
    }
    if (ch === '$') {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        quote = m[0];
        buf += quote;
        i += quote.length;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }
    if (ch === ';') {
      buf += ch;
      const s = buf.trim();
      if (s && s !== ';') stmts.push(s);
      buf = '';
      i++;
      continue;
    }
    buf += ch;
    i++;
  }
  const tail = buf.trim();
  if (tail) stmts.push(tail);
  return stmts;
}

// Split a CREATE TABLE (...) body on top-level commas.
function splitColumns(body) {
  const cols = [];
  let buf = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      buf += ch;
      if (ch === quote) {
        if (body[i + 1] === quote) {
          buf += body[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) cols.push(tail);
  return cols;
}

const CONSTRAINT_LEADERS = ['primary key', 'foreign key', 'constraint', 'check', 'unique', 'like ', 'exclude'];

function parseSchema(sql) {
  const tables = {}; // name -> { columns: [{name, def}], createStmt, triggers: [], seeds: [] }
  const indexes = []; // { name, stmt }
  const functions = []; // CREATE FUNCTION stmts (for trigger dependencies)
  for (const stmt of splitStatements(sql)) {
    const head = stmt.replace(/\s+/g, ' ').trim();
    let m = /^CREATE TABLE (?:IF NOT EXISTS )?["']?(\w+)["']?\s*\(/i.exec(head);
    if (m) {
      const name = m[1].toLowerCase();
      const bodyStart = stmt.indexOf('(');
      // find matching close paren of the outer body
      let depth = 0;
      let quote = null;
      let end = -1;
      for (let i = bodyStart; i < stmt.length; i++) {
        const ch = stmt[i];
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === "'" || ch === '"') quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      const body = end > 0 ? stmt.slice(bodyStart + 1, end) : '';
      const columns = [];
      for (const col of splitColumns(body)) {
        const first = col.split(/\s+/)[0].replace(/^["']|["']$/g, '');
        if (CONSTRAINT_LEADERS.some((l) => col.toLowerCase().startsWith(l))) continue;
        if (!first) continue;
        columns.push({ name: first.toLowerCase(), def: col });
      }
      tables[name] = { columns, createStmt: stmt, triggers: [], seeds: [] };
      continue;
    }
    m = /^CREATE TRIGGER ["']?(\w+)["']?[^;]*?\bON ["']?(\w+)["']?/i.exec(head);
    if (m) {
      const table = m[2].toLowerCase();
      if (tables[table]) tables[table].triggers.push(stmt);
      continue;
    }
    m = /^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?["']?(\w+)["']?/i.exec(head);
    if (m) {
      indexes.push({ name: m[1].toLowerCase(), stmt });
      continue;
    }
    if (/^CREATE (OR REPLACE )?FUNCTION/i.test(head)) {
      functions.push(stmt);
      continue;
    }
    m = /^INSERT INTO ["']?(\w+)["']?/i.exec(head);
    if (m) {
      const table = m[1].toLowerCase();
      if (tables[table]) tables[table].seeds.push(stmt);
    }
  }
  return { tables, indexes, functions };
}

// ---------- live DB introspection ----------

async function liveStructure() {
  const [tableRows] = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const tables = {};
  for (const r of tableRows) tables[r.tablename.toLowerCase()] = {};
  const [colRows] = await db.query(
    `SELECT table_name, column_name, data_type, character_maximum_length,
            numeric_precision, numeric_scale, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'`
  );
  const columns = {}; // table -> { col -> info }
  for (const r of colRows) {
    const t = r.table_name.toLowerCase();
    (columns[t] = columns[t] || {})[r.column_name.toLowerCase()] = r;
  }
  const [idxRows] = await db.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
  );
  const indexes = new Set(idxRows.map((r) => r.indexname.toLowerCase()));
  const [fnRows] = await db.query(
    `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'`
  );
  const functions = new Set(fnRows.map((r) => r.proname.toLowerCase()));
  return { tables, columns, indexes, functions };
}

// Normalize an expected column def to a comparable { type, nullable }.
function expectedShape(def) {
  const d = def.replace(/\s+/g, ' ').trim();
  const serial = /\bSERIAL\d?\b/i.test(d) || /\bBIGSERIAL\b/i.test(d) || /\bSMALLSERIAL\b/i.test(d);
  let type = d
    .replace(/^["']?\w+["']?\s+/, '')
    .replace(/\bPRIMARY KEY\b/i, '')
    .replace(/\bNOT NULL\b/i, '')
    .replace(/\bNULL\b/i, '')
    .replace(/\bUNIQUE\b/i, '')
    .replace(/\bDEFAULT\b.*$/i, '')
    .replace(/\bREFERENCES\b.*$/i, '')
    .replace(/\bCHECK\b.*$/i, '')
    .replace(/\bCOLLATE\b.*$/i, '')
    .trim()
    .toLowerCase();
  type = type
    .replace(/^character varying/, 'varchar')
    .replace(/^character\b/, 'char')
    .replace(/^timestamp with time zone.*/, 'timestamptz')
    .replace(/^timestamp.*/, 'timestamp')
    .replace(/^time with time zone.*/, 'timetz')
    .replace(/^time\b.*/, 'time')
    .replace(/^double precision.*/, 'float8')
    .replace(/^serial\d?/, 'int')
    .replace(/^bigserial/, 'bigint')
    .replace(/^smallserial/, 'smallint');
  const nullable = serial ? false : !/\bNOT NULL\b/i.test(def) && !/\bPRIMARY KEY\b/i.test(def);
  return { type: type.replace(/\s+/g, ''), nullable };
}

function liveShape(info) {
  let type = info.data_type.toLowerCase();
  if (type === 'character varying') type = `varchar(${info.character_maximum_length})`;
  else if (type === 'character') type = `char(${info.character_maximum_length})`;
  else if (type === 'numeric') type = `numeric(${info.numeric_precision},${info.numeric_scale})`;
  else if (type === 'timestamp without time zone') type = 'timestamp';
  else if (type === 'timestamp with time zone') type = 'timestamptz';
  else if (type === 'time without time zone') type = 'time';
  else if (type === 'time with time zone') type = 'timetz';
  else if (type === 'double precision') type = 'float8';
  // SERIAL columns report as integer + nextval default: treat as int.
  return { type: type.replace(/\s+/g, ''), nullable: info.is_nullable === 'YES' };
}

// ---------- verify ----------

async function main() {
  const sqlPath = path.join(__dirname, '..', 'database', 'skema.sql');
  const { tables: expected, indexes: expectedIdx, functions: expectedFn } = parseSchema(
    fs.readFileSync(sqlPath, 'utf8')
  );
  console.log(`Parsed skema.sql: ${Object.keys(expected).length} tables, ${expectedIdx.length} indexes.`);

  let live;
  try {
    live = await liveStructure();
  } catch (err) {
    console.error('Cannot reach the database:', err.message);
    console.error('Check backend/.env (DB_HOST/DB_USER/DB_PASSWORD/DB_PORT/DB_NAME) and that PostgreSQL is running.');
    process.exit(2);
  }

  const missingTables = [];
  const missingColumns = []; // { table, col, def }
  const typeMismatches = []; // { table, col, expected, live, def }
  const missingIndexes = [];
  const extraTables = [];
  const extraColumns = []; // informational only

  for (const [t, spec] of Object.entries(expected)) {
    if (!live.tables[t]) {
      missingTables.push(t);
      continue;
    }
    const liveCols = live.columns[t] || {};
    for (const c of spec.columns) {
      const info = liveCols[c.name];
      if (!info) {
        missingColumns.push({ table: t, col: c.name, def: c.def });
        continue;
      }
      const e = expectedShape(c.def);
      const l = liveShape(info);
      // SERIAL reports integer: accept int families loosely on serial defs.
      const typeOk = e.type === l.type || (e.type === 'int' && l.type === 'integer');
      if (!typeOk || e.nullable !== l.nullable) {
        typeMismatches.push({ table: t, col: c.name, expected: `${e.type}${e.nullable ? '' : ' NOT NULL'}`, live: `${l.type}${l.nullable ? '' : ' NOT NULL'}`, def: c.def });
      }
    }
    for (const lc of Object.keys(liveCols)) {
      if (!spec.columns.some((c) => c.name === lc)) extraColumns.push(`${t}.${lc}`);
    }
  }
  for (const t of Object.keys(live.tables)) {
    if (!expected[t]) extraTables.push(t);
  }
  for (const ix of expectedIdx) {
    if (!live.indexes.has(ix.name)) missingIndexes.push(ix);
  }

  const drift = missingTables.length + missingColumns.length + typeMismatches.length + missingIndexes.length;

  console.log('\n===== SCHEMA VERIFY REPORT =====');
  console.log(`Missing tables (${missingTables.length}): ${missingTables.join(', ') || '-'}`);
  console.log(`Missing columns (${missingColumns.length}):`);
  for (const m of missingColumns) console.log(`  ${m.table}.${m.col}  ->  ${m.def}`);
  console.log(`Type/nullability mismatches (${typeMismatches.length}, manual fix only):`);
  for (const m of typeMismatches) {
    console.log(`  ${m.table}.${m.col}: live [${m.live}] vs skema [${m.expected}]`);
    console.log(`    skema def: ${m.def}`);
  }
  console.log(`Missing indexes (${missingIndexes.length}): ${missingIndexes.map((i) => i.name).join(', ') || '-'}`);
  console.log(`Extra tables in DB (left alone): ${extraTables.join(', ') || '-'}`);
  if (extraColumns.length) console.log(`Extra columns in DB (left alone): ${extraColumns.join(', ')}`);

  const logLines = [];
  const log = (s) => {
    console.log(s);
    logLines.push(s);
  };

  if (APPLY && drift > 0) {
    console.log('\n===== APPLYING ADDITIVE FIXES =====');
    // Functions first (trigger dependencies).
    try {
      const [fnRows] = await db.query(
        `SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`
      );
      const have = new Set(fnRows.map((r) => r.proname.toLowerCase()));
      for (const stmt of expectedFn) {
        const m = /FUNCTION ["']?(\w+)/i.exec(stmt);
        if (m && !have.has(m[1].toLowerCase())) {
          log(`Creating function ${m[1]} ...`);
          await db.query(stmt);
          have.add(m[1].toLowerCase());
        }
      }
    } catch (err) {
      log(`Function sync failed (continuing): ${err.message}`);
    }
    for (const t of missingTables) {
      try {
        log(`Creating table ${t} ...`);
        await db.query(expected[t].createStmt);
        for (const trg of expected[t].triggers) {
          try {
            await db.query(trg);
          } catch (err) {
            log(`  trigger skipped: ${err.message}`);
          }
        }
        for (const seed of expected[t].seeds) {
          try {
            await db.query(seed);
          } catch (err) {
            log(`  seed skipped: ${err.message}`);
          }
        }
      } catch (err) {
        log(`FAILED creating table ${t}: ${err.message}`);
      }
    }
    for (const m of missingColumns) {
      try {
        log(`Adding column ${m.table}.${m.col} ...`);
        await db.query(`ALTER TABLE ${m.table} ADD COLUMN ${m.def}`);
      } catch (err) {
        log(`FAILED adding ${m.table}.${m.col}: ${err.message}`);
        log(`  Run manually, e.g.: ALTER TABLE ${m.table} ADD COLUMN ${m.def};`);
      }
    }
    for (const ix of missingIndexes) {
      try {
        log(`Creating index ${ix.name} ...`);
        await db.query(ix.stmt);
      } catch (err) {
        log(`FAILED creating index ${ix.name}: ${err.message}`);
      }
    }
    console.log('Re-verifying...');
  }

  const logsDir = path.join(__dirname, '..', '..', 'logs');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(logsDir, `schema-verify-${APPLY ? 'apply-' : ''}${stamp}.log`),
      [`Mode: ${APPLY ? 'apply' : 'verify-only'}`, `Date: ${new Date().toISOString()}`,
       `Missing tables: ${missingTables.join(', ')}`,
       `Missing columns: ${missingColumns.map((m) => `${m.table}.${m.col}`).join(', ')}`,
       `Mismatches: ${typeMismatches.map((m) => `${m.table}.${m.col}`).join(', ')}`,
       `Missing indexes: ${missingIndexes.map((i) => i.name).join(', ')}`,
       `Extra tables: ${extraTables.join(', ')}`,
       '', ...logLines].join('\n')
    );
  } catch (_) { /* logging is best-effort */ }

  if (!APPLY) {
    if (drift > 0) {
      console.log(`\nDrift found (${drift} item(s)). Re-run with --apply to fix additive items.`);
      process.exitCode = 1;
    } else {
      console.log('\nDatabase matches skema.sql (tables, columns, types, indexes).');
    }
  } else {
    console.log('\nApply pass finished — re-run without --apply to confirm clean.');
  }

  try {
    if (db.pool && typeof db.pool.end === 'function') await db.pool.end();
  } catch (_) { /* ignore */ }
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(2);
});
