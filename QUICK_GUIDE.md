# 🎓 Mandara Talenta - Quick Reference Guide

## 📋 Table of Contents
1. [System Requirements](#system-requirements)
2. [Installation Steps](#installation-steps)
3. [User Roles & Access](#user-roles--access)
4. [Feature Matrix](#feature-matrix)
5. [Workflow Diagrams](#workflow-diagrams)
6. [Troubleshooting](#troubleshooting)

---

## 🖥️ System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Windows 10 / Linux / macOS | Windows 11 / Ubuntu 22.04 |
| RAM | 4GB | 8GB+ |
| Storage | 10GB | 50GB SSD |
| Node.js | 16.x | 18.x LTS |
| PostgreSQL | 14 | 16+ (installer EDB sudah termasuk pgAdmin 4) |
| Browser | Chrome 100+ | Latest Chrome/Firefox |

---

## 📦 Installation Steps

### 1. Install Prerequisites
```bash
# 1. Install Node.js (https://nodejs.org)
node -v  # Should show v16.x or higher

# 2. Install PostgreSQL (https://www.postgresql.org/download/)
# Windows: pakai installer EDB, ingat password user `postgres`
# Verifikasi: pg_isready  (harusnya: accepting connections)

# 3. Verify npm
npm -v  # Should show 8.x or higher
```

### 2. Database Setup
```bash
# Otomatis: buat database + impor skema (disarankan)
cd backend
npm install
npm run db:setup
```
```sql
-- Atau manual:
-- 1. Buat database ipt_school (pgAdmin: klik kanan Databases -> Create,
--    atau terminal: createdb -U postgres ipt_school)
-- 2. Impor skema:
--    psql -U postgres -d ipt_school -f backend/database/skema.sql
--
-- Baru pakai pgAdmin? Lihat panduan klik-per-klik di REQUIREMENTS.md (Step 4).
```

### 3. Backend Setup
```bash
cd backend
npm install
copy .env.example .env
# Edit .env: DB_PASSWORD, JWT_SECRET, SUPERADMIN_SETUP_PASSWORD,
# HCAPTCHA_SITE_KEY, dan HCAPTCHA_SECRET_KEY
# (lihat backend/.env.example untuk daftar lengkap)
npm run db:setup   # bila database ipt_school belum ada
npm start
```

### 4. Frontend Setup
```bash
cd frontend
npm install
copy .env.example .env
# Isi REACT_APP_HCAPTCHA_SITE_KEY (sitekey yang sama dengan backend) di .env
npm start
```

### 5. Access Application
- URL: http://localhost:3000
- Login pertama: ADMIN001 + nilai `SUPERADMIN_SETUP_PASSWORD` dari `.env`
  (password otomatis di-hash; segera ganti lewat Profile lalu hapus variabel itu)

> hCaptcha menolak hostname `localhost`/`127.0.0.1`. Untuk development lokal,
> gunakan hosts alias (mis. `127.0.0.1 test.mydomain.com`), daftarkan hostname
> itu pada sitekey, lalu buka `http://test.mydomain.com:3000`. Test key resmi
> hCaptcha boleh dipakai untuk automated test, tetapi jangan di production.

---

## 👤 User Roles & Access

### 🔴 Superadmin (Full Access)
```
Login: ADMIN001 / (setup password pertama, lalu password sendiri)
├── Kelola Akun (CRUD all users)
├── Wali Kelas Management
├── Approvals V2 (All approvals)
├── Input Access Control
├── Laporan & Cetak (Reports)
├── System Logs
└── Profile Settings
```

### 🔵 Guru (Input Data)
```
Login: NIP / (dibuat superadmin)
├── Dashboard (Statistik & Peringkat)
├── Input Prestasi (Achievements)
├── Input Organisasi (Organizations)
├── Input Kepanitiaan (Committee)
├── Input Event (School events)
├── Input Pelanggaran (Violations, bila diberi izin)
├── Input Perilaku (Behavior, bila diberi izin)
├── Notifikasi (Status pengajuan)
├── Wali Kelas Panel (bila ditunjuk)
├── Laporan & Cetak (bila wali kelas)
└── Profile
```

### 🟢 Siswa (View Only)
```
Login: NIS / (dibuat superadmin)
├── Dashboard (Skor IPT sendiri)
├── Peringkat (Top 20 per kategori)
├── Riwayat IPT
├── Notifications
└── Profile (biodata, foto, edit terbatas)
```

---

## 📊 Feature Matrix

| Feature | Superadmin | Guru | Siswa |
|---------|:----------:|:----:|:-----:|
| Create Users | ✅ | ❌ | ❌ |
| Delete Users | ✅ | ❌ | ❌ |
| Manage Permissions | ✅ | ❌ | ❌ |
| Input Prestasi | ✅ | ✅* | ❌ |
| Input Organisasi | ✅ | ✅* | ❌ |
| Input Kepanitiaan | ✅ | ✅* | ❌ |
| Input Event | ✅ | ✅* | ❌ |
| Input Pelanggaran | ✅ | ✅* | ❌ |
| Input Perilaku | ✅ | ✅* | ❌ |
| Approve Data | ✅ | ❌ | ❌ |
| Lihat Peringkat | ✅ | ✅ | ✅ |
| View Own IPT | ✅ | ✅ | ✅ |
| Edit Profil Terbatas | ✅ | ✅ | ✅ |
| Export Reports | ✅ | ✅** | ❌ |
| View Logs | ✅ | ❌ | ❌ |

\* Guru: hanya bila diberi izin superadmin (menu Izin Akun)

\*\* Guru: hanya bila menjadi wali kelas

---

## 🔄 Workflow Diagrams

### A. Login Flow
```
┌─────────────┐
│  User Login │
└──────┬──────┘
       │
       ▼
┌──────────────┐
│  Enter       │
│  Credentials │
└──────┬───────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  Validate    │────▶│  JWT Token   │
│  JWT Secret  │     │  Generated   │
└──────┬───────┘     └──────┬───────┘
       │                    │
       ▼                    ▼
┌──────────────┐     ┌──────────────┐
│  Invalid     │     │  Store in    │
│  Error       │     │  localStorage│
└──────────────┘     └──────┬───────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Redirect to │
                     │  Dashboard   │
                     └──────────────┘
```

### B. Data Input Flow
```
┌─────────────┐
│  Select     │
│  Input Type │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Select     │
│  Student    │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Fill Form  │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Upload     │
│  Bukti      │
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌─────────────┐
│   Submit    │────▶│   Pending   │
└─────────────┘     └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Approved │ │ Rejected │ │ Need     │
        │          │ │          │ │ Review   │
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │            │            │
             ▼            ▼            └────────┐
        ┌──────────┐ ┌──────────┐               │
        │ IPT      │ │ Notify   │               │
        │ Updated  │ │ Reason   │               │
        └──────────┘ └──────────┘               │
                                                ▼
                                          ┌──────────┐
                                          │ Back to  │
                                          │ Input    │
                                          └──────────┘
```

### C. IPT Calculation
```
         ┌──────────┐
         │  Start   │
         │  IPT=80  │
         └────┬─────┘
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐
│+Points│ │-Points│ │  No   │
│Inputs │ │Inputs │ │Change │
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    └────┬────┴────┬────┘
         │         │
         ▼         ▼
    ┌─────────────────┐
    │   Calculate     │
    │   Total IPT     │
    └────────┬────────┘
             │
             ▼
    ┌─────────────────┐
    │   Range Check   │
    │   0 <= IPT <= 100│
    └────────┬────────┘
             │
    ┌────────┴────────┐
    ▼                 ▼
┌─────────┐     ┌─────────┐
│ IPT < 0 │     │ IPT > 100│
│ Set = 0 │     │ Set = 100│
└────┬────┘     └────┬────┘
     │               │
     └───────┬───────┘
             │
             ▼
    ┌─────────────────┐
    │  Save & Log     │
    └─────────────────┘
```

### D. Approval System (2-Level)
```
                    ┌──────────────┐
                    │  Data Input  │
                    │ (Guru/Siswa) │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   PENDING    │
                    │ (menunggu    │
                    │  superadmin) │
                    └──────┬───────┘
                           │
                           ▼
                 ┌──────────────────┐
                 │   Superadmin     │
                 │   (menu          │
                 │   Approvals)     │
                 └────────┬─────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
              ▼                       ▼
     ┌────────────────┐    ┌────────────────┐
     │  APPROVED      │    │  REJECTED      │
     │  IPT terupdate │    │  (wajib alasan)│
     └────────┬───────┘    └────────┬───────┘
              │                     │
              ▼                     ▼
     ┌────────────────┐    ┌────────────────┐
     │ Notifikasi     │    │ Notifikasi     │
     │ sukses ke user │    │ + alasan       │
     └────────────────┘    └────────────────┘

Catatan: input langsung superadmin otomatis approved tanpa antrean.
```

---

## 🔧 Troubleshooting

### Common Issues

#### 1. Database Connection Error
```
Error: password authentication failed for user "postgres"
   atau: connection refused / database "ipt_school" does not exist
```
**Solution:**
- Check PostgreSQL is running (`pg_isready`; Windows: *Services* → `postgresql-x64-*`)
- Verify .env DB_PASSWORD matches the `postgres` user password
- Kalau database belum ada, buat otomatis: `cd backend && npm run db:setup`
- Ganti password bila lupa (via SQL Shell / psql):
  `ALTER USER postgres PASSWORD 'password_baru';`

#### 2. Port Already in Use
```
Error: Port 5000 is already in use
```
**Solution:**
```bash
# Windows
netstat -ano | findstr :5000
taskkill /PID <PID> /F

# Or change port
PORT=5001 npm start
```

#### 3. CORS Error
```
Error: No 'Access-Control-Allow-Origin' header
```
**Solution:**
- Check backend server.js CORS configuration
- Verify ALLOWED_ORIGINS in .env matches frontend URL

#### 4. Module Not Found
```
Error: Cannot find module 'xyz'
```
**Solution:**
```bash
cd backend  # or frontend
rm -rf node_modules
npm install
```

#### 5. Avatar Not Loading
```
Error: ERR_BLOCKED_BY_RESPONSE
```
**Solution:**
- Check backend/uploads folder exists
- Verify CORS headers in server.js
- Check file permissions

---

## 📞 Support

### Documentation Files
- **DOCUMENTATION.md** - Full system documentation
- **REQUIREMENTS.md** - Installation requirements
- **FLOWCHART.html** - Visual diagrams (open in browser, print to PDF)
- **SECURITY.md** - Security features & best practices

### Default Credentials
| Role | Username | Password |
|------|----------|----------|
| Superadmin | ADMIN001 | `SUPERADMIN_SETUP_PASSWORD` (login pertama saja) |
| Guru | (NIP) | (dibuat superadmin) |
| Siswa | (NIS) | (dibuat superadmin) |

---

## 🎯 Quick Commands

### Development
```bash
# Start backend
cd backend && npm start

# Start frontend  
cd frontend && npm start

# Install packages
cd backend && npm install
cd frontend && npm install
```

### Database
```bash
# Setup awal (buat DB + impor skema)
cd backend && npm run db:setup

# Backup (Windows: jalankan dari folder bin PostgreSQL atau tambahkan ke PATH)
pg_dump -U postgres ipt_school > backup.sql

# Restore
psql -U postgres -d ipt_school < backup.sql
```

### Logs
```bash
# View logs
tail -f logs/activity.log

# Clear logs
> logs/activity.log
```

---

**Version**: 2.0  
**Last Updated**: September 27, 2026  
**System**: Mandara Talenta v0.2

---

*Untuk dokumentasi lengkap, lihat file DOCUMENTATION.md*
