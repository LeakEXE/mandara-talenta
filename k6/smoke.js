import http from 'k6/http';
import { check, sleep } from 'k6';

// ---------------------------------------------------------------------------
// Smoke test 1 VU, prod-safe. Verifies wiring + baseline latency.
// Run:  k6 run k6/smoke.js
// Prod: k6 run -e BASE_URL=http://YOUR_PROD_IP:5000 -e USERNAME=guru_test -e PASSWORD=secret k6/smoke.js
// ---------------------------------------------------------------------------

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const USERNAME = __ENV.USERNAME || '';
const PASSWORD = __ENV.PASSWORD || '';

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
    checks: ['rate>0.99'],
  },
};

function failEarly(msg) {
  console.error(`SMOKE ABORT: ${msg}`);
}

export default function () {
  // 1. Public endpoint (no auth) login page branding fetch.
  const pub = http.get(`${BASE_URL}/api/school-config/public`);
  check(pub, { 'public 200': (r) => r.status === 200 });

  // 2. Login (cookie-based). Token is Set-Cookie only, k6 jar keeps it per VU.
  if (!USERNAME || !PASSWORD) {
    failEarly('Set -e USERNAME=... -e PASSWORD=... (dedicated test account, never ADMIN001)');
    sleep(5);
    return;
  }
  const login = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: USERNAME, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  const okLogin = check(login, {
    'login 200': (r) => r.status === 200,
    'no must_change_credentials block': (r) => {
      try {
        return r.json().user?.must_change_credentials !== true;
      } catch {
        return r.status === 200;
      }
    },
  });
  if (!okLogin) {
    if (login.status === 429) failEarly('login rate-limited (5 fails/15min). Stop k6 and wait 15 min from last 429.');
    if (login.status === 403) failEarly(`blocked: ${login.body}`);
    if (login.status === 400) failEarly(`bad creds (use username column, NOT NIS/NIP): ${login.body}`);
    sleep(30);
    return;
  }

  // 3. Heaviest endpoint 11 parallel aggregation queries.
  const stats = http.get(`${BASE_URL}/api/dashboard/stats`);
  check(stats, { 'dashboard/stats 200': (r) => r.status === 200 });

  // 4. Typical read mix.
  const profile = http.get(`${BASE_URL}/api/profile`);
  check(profile, { 'profile 200': (r) => r.status === 200 });

  const search = http.get(`${BASE_URL}/api/search/students?query=a`);
  check(search, { 'search 200|400': (r) => r.status === 200 || r.status === 400 });

  const board = http.get(`${BASE_URL}/api/search/leaderboard/category/prestasi`);
  check(board, { 'leaderboard 200': (r) => r.status === 200 });

  sleep(2);
}
