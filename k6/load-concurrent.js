import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Concurrent-users load test read-only user journey.
// Models: login once per VU -> loop: dashboard/stats, profile, search,
// leaderboard, prestasi/teachers. Think-time between steps.
//
// Rate-limit reality (backend/middleware/security.js):
//   apiLimiter   = 500 req/min per IP  (~8.3 rps from one machine)
//   loginLimiter = 5 FAILED logins / 15 min (successes don't count)
// So from ONE k6 IP you WILL see 429s above ~10 VUs. That's expected and
// tracked separately (rate_limited), not counted as failure.
//
// Usage staging/high VU (recommended for capacity):
//   k6 run -e BASE_URL=http://localhost:5000 -e USERNAME=guru_test -e PASSWORD=secret k6/load-concurrent.js
// Usage prod (keep it gentle, 5 VUs):
//   k6 run -e BASE_URL=http://YOUR_PROD_IP:5000 -e USERNAME=guru_test -e PASSWORD=secret -e MAX_VUS=5 k6/load-concurrent.js
// Multiple accounts (spreads approval/permission paths, same IP budget):
//   k6 run -e BASE_URL=... -e USER_POOL="guru1:pw1,guru2:pw2,siswa1:pw3" k6/load-concurrent.js
// Save JSON for later graphing:
//   k6 run --summary-export k6/results/summary.json --out json=k6/results/raw.json k6/load-concurrent.js
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const MAX_VUS = parseInt(__ENV.MAX_VUS || '20', 10);

// Single-user or pool: USER_POOL="u1:p1,u2:p2" takes precedence.
function pickCreds() {
  const pool = (__ENV.USER_POOL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (pool.length > 0) {
    const entry = pool[(__VU - 1) % pool.length];
    const idx = entry.indexOf(':');
    return { username: entry.slice(0, idx), password: entry.slice(idx + 1) };
  }
  return { username: __ENV.USERNAME || '', password: __ENV.PASSWORD || '' };
}

const rateLimited = new Rate('rate_limited');
const serverErrors = new Rate('server_errors');
const authBlocked = new Rate('auth_blocked');
const mustChangeBlocked = new Counter('must_change_credentials_blocks');
const status401 = new Counter('status_401');
const status403 = new Counter('status_403');
const status400 = new Counter('status_400');
const status404 = new Counter('status_404');
const dashboardTrend = new Trend('dashboard_stats_duration', true);
const searchTrend = new Trend('search_duration', true);

export const options = {
  scenarios: {
    concurrent_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: Math.min(5, MAX_VUS) }, // warm-up
        { duration: '3m', target: MAX_VUS }, // ramp to concurrent users
        { duration: '5m', target: MAX_VUS }, // sustain
        { duration: '1m', target: 0 }, // ramp-down
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // 5xx budget is tight; 429s are tracked in rate_limited, not here.
    server_errors: ['rate<0.01'],
    rate_limited: ['rate<0.30'],
    auth_blocked: ['rate<0.01'], // alert if >30% of requests are 429 (means IP budget hit)
    dashboard_stats_duration: ['p(95)<2000'],
    search_duration: ['p(95)<1500'],
    // NOTE: 429s from the single-IP rate limiter count as http_req_failed in
    // k6. Real failures are tracked via server_errors + checks; this threshold
    // just caps the limiter share so a flood of 429s still alerts.
    http_req_failed: ['rate<0.15'],
    checks: ['rate>0.95'],
  },
};

let loggedIn = false;
let loginFailures = 0;
let diagLogged = 0;
let authToken = ''; // per-VU JWT extracted from login Set-Cookie, sent as Bearer

function authHeaders() {
  const h = {};
  if (authToken) h['Authorization'] = 'Bearer ' + authToken;
  return h;
}

function storeTokenFromLogin(res) {
  try {
    const setCookie = res.headers['Set-Cookie'] || res.headers['set-cookie'] || '';
    const m = String(setCookie).match(/(?:^|,\s*)token=([^;]+)/);
    if (m && m[1] && m[1] !== 'deleted' && m[1] !== '%22deleted%22') {
      authToken = decodeURIComponent(m[1]);
      return true;
    }
  } catch (e) {
    // fall through to jar-only auth
  }
  return false;
}

function recordCommon(res) {
  rateLimited.add(res.status === 429);
  serverErrors.add(res.status >= 500);
  authBlocked.add(res.status === 401 || res.status === 403);
  if (res.status === 401) status401.add(1);
  if (res.status === 403) status403.add(1);
  if (res.status === 400) status400.add(1);
  if (res.status === 404) status404.add(1);
  let mustChange = false;
  try {
    mustChange = res.status === 403 && res.json().mustChangeCredentials === true;
  } catch (e) {
    mustChange = false;
  }
  if (mustChange) mustChangeBlocked.add(1);
  if (res.status !== 200 && res.status !== 429 && diagLogged < 5) {
    diagLogged += 1;
    let sentAuth = false;
    try {
      const jar = http.cookieJar().cookiesForURL(BASE_URL);
      sentAuth = !!jar['token'];
    } catch (e) {
      sentAuth = false;
    }
    console.error('DIAG VU=' + __VU + ' status=' + res.status + ' mustChange=' + mustChange + ' bearer=' + (!!authToken) + ' jarToken=' + sentAuth + ' body=' + String(res.body || '').slice(0, 300));
  }
  return res.status === 200 || res.status === 429;
}

function doLogin() {
  // Fail fast: bad creds (400) must NOT be retried hot loginLimiter locks
  // the whole IP after 5 FAILED logins / 15 min and successes don't reset it.
  // After 2 bad attempts this VU parks itself to stop the lockout spiral.
  if (loginFailures >= 2) {
    sleep(120);
    return false;
  }
  const { username, password } = pickCreds();
  if (!username || !password) {
    console.error('Set -e USERNAME/-e PASSWORD or -e USER_POOL="u1:p1,u2:p2". Aborting VU.');
    loginFailures += 1;
    sleep(60);
    return false;
  }
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } }
  );
  if (res.status === 200) {
    loggedIn = true;
    loginFailures = 0;
    if (!storeTokenFromLogin(res)) {
      console.error('LOGIN VU=' + __VU + ' 200 but no token cookie found - falling back to jar');
    }
    return true;
  }
  loginFailures += 1;
  if (res.status === 400) {
    // Wrong username/password (or NIS/NIP used as username). Do NOT retry fast.
    console.error(
      `Login 400 VU=${__VU} - bad username/password, backing off 60s. body=${res.body?.slice(0, 200)}`
    );
    sleep(60);
    return false;
  }
  if (res.status === 429) {
    // IP is now locked for ~15 min. Park this VU instead of hammering.
    console.error(`Login 429 VU=${__VU} - IP locked, parking 120s.`);
    sleep(120);
    return false;
  }
  // Don't hammer on other failures either.
  console.error(`Login failed VU=${__VU} status=${res.status} body=${res.body?.slice(0, 200)}`);
  sleep(30);
  return false;
}

export default function () {
  if (!loggedIn && !doLogin()) {
    return; // back off, avoid lockout loop
  }

  // 1. Dashboard - heaviest query (11 aggregations). Core of the test.
  let r = http.get(`${BASE_URL}/api/dashboard/stats`, {
    headers: authHeaders(),
    tags: { name: 'GET /api/dashboard/stats' },
  });
  dashboardTrend.add(r.timings.duration);
  check(r, { 'stats ok|limited': (res) => recordCommon(res) });
  if (r.status === 401) {
    loggedIn = false;
    authToken = '';
    return;
  } // token missing/invalid, re-login next loop
  sleep(1 + Math.random() * 2); // think-time keeps RPS realistic

  // 2. Profile (own biodata + wali-kelas joins).
  r = http.get(`${BASE_URL}/api/profile`, { headers: authHeaders(), tags: { name: 'GET /api/profile' } });
  check(r, { 'profile ok|limited': (res) => recordCommon(res) });
  sleep(1 + Math.random() * 2);

  // 3. Search students (ILIKE + prestasi subquery, LIMIT 20).
  const q = ['a', 'putra', 'dewa', 'siswa'][Math.floor(Math.random() * 4)];
  r = http.get(`${BASE_URL}/api/search/students?query=${encodeURIComponent(q)}`, {
    headers: authHeaders(),
    tags: { name: 'GET /api/search/students' },
  });
  searchTrend.add(r.timings.duration);
  check(r, { 'search ok|limited': (res) => recordCommon(res) });
  sleep(1 + Math.random() * 2);

  // 4. Leaderboard (GROUP BY + SUM, LIMIT 20).
  r = http.get(`${BASE_URL}/api/search/leaderboard/category/prestasi`, {
    headers: authHeaders(),
    tags: { name: 'GET /api/search/leaderboard' },
  });
  check(r, { 'leaderboard ok|limited': (res) => recordCommon(res) });
  sleep(1 + Math.random() * 2);

  // 5. Light list (teacher dropdown source).
  r = http.get(`${BASE_URL}/api/prestasi/teachers`, {
    headers: authHeaders(),
    tags: { name: 'GET /api/prestasi/teachers' },
  });
  check(r, { 'teachers ok|limited': (res) => recordCommon(res) });
  sleep(2 + Math.random() * 2);
}
