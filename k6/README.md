# k6 Load Testing - Mandara Talenta (Express :5000 + Postgres)

Read-only, k6-CLI-first. No Grafana required. Run later whenever ready.

## 0. Install (once)

```bash
# Windows (winget) or download from https://grafana.com/docs/k6/
winget install k6 --source winget
k6 version
```

## 1. Safety checklist (do this before touching prod)

1. Backup DB: `pg_dump -U postgres -d ipt_school -F c -f ipt_school_backup.dump`
2. Test off-hours. Tell users.
3. Create dedicated test accounts (Guru + Siswa) via Kelola Akun. Confirm they can
   log in once in the browser and are NOT stuck on setup-akun
   (`must_change_credentials` must be false).
4. Never use `ADMIN001`, never test `POST /forgot-password` (spams superadmin),
   never `POST` prestasi/organisasi/event/uploads (creates approval queue + files).
5. Stop criteria - abort the run if any is true:
   `5xx > 1%` · `p95 dashboard/stats > 2s sustained` · real users complain.

Rate-limit math (single k6 machine = single IP):
`apiLimiter` 500 req/min ≈ 8.3 rps. 10 VUs with ~3s think-time ≈ 3 rps
→ expect some `429`. The script tracks these as `rate_limited`, not failures.
If `rate_limited > 30%`, your IP budget is saturated - lower VUs or use staging.

## 2. Configure (never commit passwords)

```bash
# staging / local
set BASE_URL=http://localhost:5000
set USERNAME=guru_test
set PASSWORD=your_test_password

# OR a pool (rotates per VU):
# set USER_POOL=guru1:pw1,guru2:pw2,siswa1:pw3
```

PowerShell equivalent: `$env:BASE_URL="http://localhost:5000"` etc.
k6 reads them via `-e`: values below are examples, substitute your own.

## 3. Run smoke first (1 VU, ~1 min, prod-safe)

```bash
k6 run -e BASE_URL=%BASE_URL% -e USERNAME=%USERNAME% -e PASSWORD=%PASSWORD% k6/smoke.js
```

Pass = `checks 100%`, `p95 < 2s`, login 200. If login is `400` → wrong creds
(stop 5 fails/15min locks the IP). If `403 mustChangeCredentials` → log in
via browser once and complete setup-akun.

## 4. Run concurrent users

```bash
# Staging / local real capacity test:
k6 run -e BASE_URL=%BASE_URL% -e USERNAME=%USERNAME% -e PASSWORD=%PASSWORD% -e MAX_VUS=20 k6/load-concurrent.js

# Prod keep gentle (5 VUs):
k6 run -e BASE_URL=http://YOUR_PROD_IP:5000 -e USERNAME=%USERNAME% -e PASSWORD=%PASSWORD% -e MAX_VUS=5 k6/load-concurrent.js

# With results files for later graphing:
k6 run --summary-export k6/results/summary.json --out json=k6/results/raw.json -e BASE_URL=%BASE_URL% -e USERNAME=%USERNAME% -e PASSWORD=%PASSWORD% -e MAX_VUS=20 k6/load-concurrent.js
```

Stages: 1m warm-up → 3m ramp → 5m sustain → 1m down (~10 min total).
Journey per iteration: `dashboard/stats` → `profile` → `search/students` →
`leaderboard` → `prestasi/teachers`, with 1–4s think-time.

## 5. Read the output

| Signal | Healthy | Action if bad |
|---|---|---|
| `checks` | > 95% | Look at which URL failed (401 = session, 5xx = server) |
| `dashboard_stats_duration p95` | < 2000ms | Add index / cache this is the 11-query aggregation |
| `search_duration p95` | < 1500ms | Check `ILIKE %..%` full scans on `users` |
| `server_errors` | < 1% | Stop, check `logs/` + `SELECT * FROM activity_logs ORDER BY id DESC LIMIT 20` |
| `rate_limited (429)` | < 30% | Expected under load from one IP; lower VUs or whitelist k6 IP |

Useful server-side while running:

```bash
# backend request errors
# (second terminal, backend dir)
node backend/server.js
# Postgres: what's slow right now
# psql -U postgres -d ipt_school -c "SELECT pid, now()-query_start AS dur, left(query,120) FROM pg_stat_activity WHERE state='active' ORDER BY dur DESC;"
# Prometheus scrape (if METRICS_TOKEN set in backend/.env):
# curl -H "Authorization: Bearer <METRICS_TOKEN>" http://localhost:5000/metrics
```

## 6. What the scripts do NOT cover (by design)

- Writes/uploads, approvals, login brute-force, `forgot-password`, `/metrics` scraping.
- True 50–100 concurrent from one IP on prod (rate limiter forbids it).
  For that, clone prod → staging and raise `-e MAX_VUS=50` there.

## 7. Later: Grafana

Scripts already emit `dashboard_stats_duration`, `search_duration`,
`rate_limited`, `server_errors` trends. When your Grafana is ready:
`k6 run --out experimental-prometheus-rw k6/load-concurrent.js`
and point it at Prometheus, or import `k6/results/summary.json`.
Backend already exposes `GET /metrics` for the same Prometheus.
