const { Pool, types } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// DATE (OID 1082) has no time component: keep the 'YYYY-MM-DD' string
// instead of pg's default local-midnight Date, which shifts a day back
// when serialized to UTC on +07/+08 servers (e.g. tanggal_pelaksanaan).
types.setTypeParser(1082, (v) => v);

// Support both DATABASE_URL and individual DB_* vars.
// Defaults are PostgreSQL-oriented (previous MySQL defaults root/3306 no longer apply).
const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30000,
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'postgres',
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
        database: process.env.DB_NAME || 'ipt_school',
        max: 10,
        idleTimeoutMillis: 30000,
    });

pool.on('error', (err) => {
    console.error('Unexpected pg pool error:', err.message);
});

// Convert MySQL-style `?` placeholders to Postgres `$1, $2, ...`.
// - Array params expand inline WITHOUT adding parens, so callers keep
//   writing `IN (?)` which becomes `IN ($1, $2)`.
// - String literals ('...', "...", E'...') are left untouched so `?` inside them
//   is not treated as a placeholder.
// - Postgres standard strings: only '' escapes a quote (backslash is literal).
//   Only E'...' strings treat backslash escapes (\', \\) specially.
const toPostgresParams = (sql, params) => {
    if (!params || params.length === 0) {
        return { text: sql, values: [] };
    }

    const values = [];
    let pgSql = '';
    let paramIdx = 0;
    let placeholderNum = 1;
    let inString = false;
    let stringChar = null;
    let isEscapeString = false;
    let i = 0;

    while (i < sql.length) {
        const ch = sql[i];

        if (inString) {
            // Doubled quote ('', "") is an escaped quote in any string.
            if (ch === stringChar && sql[i + 1] === stringChar) {
                pgSql += ch + sql[i + 1];
                i += 2;
                continue;
            }
            // Backslash escapes only apply in E'...' strings.
            if (isEscapeString && ch === '\\' && i + 1 < sql.length) {
                pgSql += ch;
                pgSql += sql[i + 1];
                i += 2;
                continue;
            }
            pgSql += ch;
            if (ch === stringChar) {
                inString = false;
                stringChar = null;
                isEscapeString = false;
            }
            i++;
            continue;
        }

        // Detect E'...' escape-string prefix (case-insensitive E directly before quote).
        if ((ch === 'E' || ch === 'e') && (sql[i + 1] === "'" || sql[i + 1] === '"')) {
            inString = true;
            stringChar = sql[i + 1];
            isEscapeString = stringChar === "'";
            pgSql += ch;
            pgSql += sql[i + 1];
            i += 2;
            continue;
        }

        if (ch === "'" || ch === '"') {
            inString = true;
            stringChar = ch;
            isEscapeString = false;
            pgSql += ch;
            i++;
            continue;
        }

        if (ch === '?') {
            const param = params[paramIdx];
            paramIdx++;

            if (Array.isArray(param)) {
                if (param.length === 0) {
                    pgSql += 'NULL';
                } else {
                    const expanded = param.map(() => `$${placeholderNum++}`);
                    values.push(...param);
                    pgSql += expanded.join(', ');
                }
            } else {
                values.push(param);
                pgSql += `$${placeholderNum++}`;
            }
            i++;
            continue;
        }

        pgSql += ch;
        i++;
    }

    return { text: pgSql, values };
};

const isSelectLikeQuery = (sql) => {
    const trimmed = sql.trim().toLowerCase();
    return trimmed.startsWith('select') ||
           trimmed.startsWith('show') ||
           trimmed.startsWith('describe') ||
           trimmed.startsWith('with') ||
           trimmed.startsWith('explain');
};

const isInsertQuery = (sql) => {
    return sql.trim().toLowerCase().startsWith('insert');
};

const hasReturning = (sql) => {
    return /returning\s+/i.test(sql);
};

const runQuery = async (executor, sql, params) => {
    const { text: convertedSql, values } = toPostgresParams(sql, params);

    let finalSql = convertedSql;
    if (isInsertQuery(sql) && !hasReturning(convertedSql)) {
        finalSql = `${convertedSql} RETURNING id`;
    }

    const result = await executor(finalSql, values);

    if (isSelectLikeQuery(sql)) {
        // Normalize COUNT(*) results: pg returns bigint as string, mysql returned number.
        // Coerce pure-integer strings for `count`/`total` aliases so callers keep working.
        const rows = (result.rows || []).map((row) => {
            if (row && typeof row === 'object' && !Array.isArray(row)) {
                const copy = { ...row };
                for (const key of ['count', 'total', 'total_siswa', 'total_prestasi', 'total_point']) {
                    if (typeof copy[key] === 'string' && /^-?\d+$/.test(copy[key])) {
                        const n = Number(copy[key]);
                        if (Number.isSafeInteger(n)) copy[key] = n;
                    }
                }
                // pg booleans come back as true/false already; mysql gave 0/1.
                // Callers handle both, so no conversion needed.
                return copy;
            }
            return row;
        });
        return [rows, result.fields || []];
    }

    const mockResult = {
        affectedRows: result.rowCount || 0,
    };

    if (isInsertQuery(sql)) {
        mockResult.insertId = result.rows.length > 0 ? result.rows[0].id : undefined;
    }

    return [mockResult, result.fields || []];
};

const query = async (sql, params) => {
    return runQuery((text, values) => pool.query(text, values), sql, params);
};

// MySQL-compat transaction helper: db.getConnection() -> { query, beginTransaction, commit, rollback, release }
const getConnection = async () => {
    const client = await pool.connect();
    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            client.release();
        }
    };
    return {
        query: (sql, params) => runQuery((text, values) => client.query(text, values), sql, params),
        beginTransaction: () => client.query('BEGIN'),
        commit: () => client.query('COMMIT'),
        rollback: () => client.query('ROLLBACK'),
        release,
        // pg-native escape hatch
        getClient: () => client,
    };
};

module.exports = {
    query,
    getConnection,
    // pg-native escape hatches (useful for future refactors / scripts)
    getClient: () => pool.connect(),
    getPool: () => pool,
    pool,
    end: () => pool.end(),
};
