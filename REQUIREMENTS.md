# 📦 Mandara Talenta - Requirements

## 🖥️ System Requirements

### Minimum Requirements
```
OS: Windows 10/11, macOS, or Linux
RAM: 4GB
Storage: 10GB free space
CPU: Dual-core processor
Network: Internet connection for CDN resources
```

### Recommended Requirements
```
RAM: 8GB+
Storage: 50GB SSD
CPU: Quad-core processor
Browser: Latest Chrome/Firefox/Edge
```

---

## 🛠️ Software Requirements

### Required Software
1. **Node.js** (v16.x or higher)
   - Download: https://nodejs.org/
   - Verify: `node -v`

2. **PostgreSQL** (v14 or higher)
   - Download (Windows): https://www.postgresql.org/download/windows/
     (installer resmi EDB - sudah termasuk server + pgAdmin 4)
   - macOS: https://www.postgresql.org/download/macosx/ atau `brew install postgresql`
   - Linux (Ubuntu/Debian): `sudo apt install postgresql postgresql-contrib`
   - Saat instalasi, catat password user `postgres` (dibutuhkan untuk .env)

3. **npm** (v8.x or higher)
   - Included with Node.js
   - Verify: `npm -v`

4. **Git** (optional, for cloning)
   - Download: https://git-scm.com/

---

## 📋 Installation Steps

### Step 1: Install Node.js
1. Download dari https://nodejs.org/ (LTS version)
2. Install dengan default settings
3. Verify: Buka CMD, ketik:
   ```
   node -v
   npm -v
   ```

### Step 2: Install PostgreSQL
**Option A: Installer Resmi EDB (Recommended untuk pemula - Windows)**
1. Download installer dari https://www.postgresql.org/download/windows/
2. Jalankan installer, ikuti wizard dengan default settings
3. Saat diminta password user `postgres`, isi dan **ingat password ini!**
   (password ini dipakai sebagai `DB_PASSWORD` di file .env)
4. Port default: `5432` (jangan diubah kecuali bentrok)
5. Centang untuk install **pgAdmin 4** (GUI untuk mengelola database)
6. Setelah selesai, verifikasi server berjalan:
   - Buka **SQL Shell (psql)** dari Start Menu, tekan Enter untuk semua
     prompt (host/db/port/username default), lalu masukkan password
   - Atau jalankan di CMD: `pg_isready` (harusnya menjawab `accepting connections`)

**Option B: Linux (Ubuntu/Debian)**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
# Set password user postgres:
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"
```

**Option C: macOS (Homebrew)**
```bash
brew install postgresql@16
brew services start postgresql@16
psql postgres -c "ALTER USER $(whoami) PASSWORD 'postgres';"
# (sesuaikan DB_USER di .env dengan username macOS Anda)
```

### Step 3: Install Backend & Atur .env Dulu
```bash
# Buka CMD/Terminal
cd backend

# Install semua dependencies
npm install

# Copy environment file
copy .env.example .env    (Windows)
cp .env.example .env      (Linux/Mac)

# Edit .env file dengan notepad:
# - DB_PASSWORD: password user postgres yang dibuat saat instalasi
# - JWT_SECRET: random string panjang
```

### Step 4: Setup Database
**Cara mudah (otomatis) - cukup satu perintah** (jalankan setelah Step 3,
karena `db:setup` membaca password dari file `.env`):
```bash
cd backend
npm run db:setup
```
Perintah `db:setup` akan membuat database `ipt_school` (jika belum ada)
dan mengimpor seluruh tabel + data awal dari `database/skema.sql`.

**Cara manual (kalau ingin lewat pgAdmin / psql):**
1. Buka pgAdmin 4 → klik kanan *Databases* → *Create* → beri nama `ipt_school`
2. Klik kanan database `ipt_school` → *Query Tool* → buka file
   `backend/database/skema.sql` → jalankan (F5)
   (Panduan klik-per-klik lengkap ada di bawah: *Panduan pgAdmin 4 di Windows*)
3. Atau lewat terminal:
   ```bash
   createdb -U postgres ipt_school
   psql -U postgres -d ipt_school -f backend/database/skema.sql
   ```
   (Windows: jalankan dari folder instalasi PostgreSQL `bin`,
   atau tambahkan folder `bin` ke PATH agar `psql`/`createdb` dikenal CMD)
4. Selesai! Verifikasi tabel sudah ada:
   ```bash
   psql -U postgres -d ipt_school -c "\dt"
   ```

#### Panduan pgAdmin 4 di Windows (langkah demi langkah untuk pemula)

pgAdmin 4 adalah aplikasi GUI bawaan installer PostgreSQL - fungsinya mirip
phpMyAdmin, tapi berjalan sebagai aplikasi desktop + dibuka di browser.

**1. Buka pgAdmin dan konek ke server lokal**
1. Buka **pgAdmin 4** dari Start Menu (pertama kali dibuka, Anda diminta
   membuat *master password* - ini password khusus aplikasi pgAdmin saja,
   boleh beda dengan password database. Ingat password ini).
2. Di panel kiri: buka **Servers → PostgreSQL 16** (angka versi menyesuaikan
   yang Anda install) → klik server tersebut.
3. Masukkan password user `postgres` yang Anda buat saat instalasi →
   centang **Save password** → OK.
4. Kalau muncul error *connection failed / server not running*:
   buka *Services* (Win+R → `services.msc`) → cari `postgresql-x64-16` →
   klik kanan → *Start*.

**2. Buat database `ipt_school`**
1. Klik kanan **Databases** → **Create → Database...**
2. Isi *Database name*: `ipt_school` → klik **Save**.
3. Database baru muncul di daftar. (Kalau belum muncul, klik kanan
   *Databases* → *Refresh*.)

**3. Impor skema (`skema.sql`)**
1. Klik kanan database **`ipt_school`** → **Query Tool**.
2. Di toolbar Query Tool, klik ikon **Open File** (folder) → arahkan ke
   `backend/database/skema.sql` di folder project → **Select**.
3. Klik tombol **Execute** (▶, atau tekan **F5**), tunggu sampai muncul
   pesan hijau *Query returned successfully*.
4. Kalau ada error merah, baca pesannya - umumnya karena database
   `ipt_school` belum dipilih (pastikan dropdown database di Query Tool
   menunjukkan `ipt_school`, bukan `postgres`).

**4. Verifikasi tabel sudah ada**
1. Di panel kiri: **Databases → ipt_school → Schemas → public → Tables**.
2. Klik kanan *Tables* → *Refresh* - Anda harus melihat tabel-tabel seperti
   `users`, `prestasi`, `organisasi`, `event`, `pelanggaran`, `perilaku`,
   `ipt_config`, dll.

**5. Melihat / memeriksa data**
- Klik kanan nama tabel (mis. `users`) → **View/Edit Data → All Rows**
  untuk melihat isinya dalam bentuk tabel spreadsheet.
- Untuk query bebas: klik kanan database → **Query Tool**, ketik SQL,
  mis. `SELECT id, nama, role FROM users;` → F5.

**6. Ganti password user `postgres` (kalau lupa / ingin diganti)**
1. Buka **Query Tool** di database mana saja (mis. `postgres`).
2. Jalankan:
   ```sql
   ALTER USER postgres PASSWORD 'password_baru_anda';
   ```
3. Sesuaikan `DB_PASSWORD` di `backend/.env` dengan password baru,
   lalu restart backend (`npm start`).

**7. Reset total (mulai dari nol)**
- Cara GUI: klik kanan `ipt_school` → **Delete/Drop** → buat lagi +
  impor ulang `skema.sql` seperti langkah 2–3.
- Cara cepat: `cd backend && npm run db:setup` (aman dijalankan ulang).

### Step 5: Jalankan Backend
```bash
# Masih di folder backend (setelah Step 3-4 selesai)
npm start
```

### Step 6: Install Frontend
```bash
# Buka CMD/Terminal baru (jangan tutup backend)
cd frontend

# Install dependencies
npm install

# Jalankan aplikasi
npm start
```

### Step 7: Akses Aplikasi
1. Buka browser: http://localhost:3000
2. Login pertama dengan akun default:
   - Username: ADMIN001
   - Password: nilai `SUPERADMIN_SETUP_PASSWORD` dari `backend/.env`
   (password otomatis di-hash; segera ganti lewat Profile lalu hapus variabel itu)
3. Selesai! 🎉

---

## 📦 Dependencies Detail

### Backend Packages (auto-install via npm)
```json
{
  "express": "^4.18.2"          // Web server framework
  "pg": "^8.11.3"               // PostgreSQL connector (node-postgres)
  "bcryptjs": "^2.4.3"          // Password encryption
  "jsonwebtoken": "^9.0.2"      // JWT authentication
  "cors": "^2.8.5"              // Cross-origin requests
  "dotenv": "^16.3.1"           // Environment variables
  "multer": "^1.4.5"            // File uploads
  "express-validator": "^7.0.1" // Input validation
  "helmet": "^7.1.0"            // Security headers
  "express-rate-limit": "^7.1.5" // Rate limiting
}
```

### Frontend Packages (auto-install via npm)
```json
{
  "react": "^18.2.0"            // UI framework
  "react-router-dom": "^6.x"      // Page routing
  "axios": "^1.x"                 // API requests
  "xlsx": "^0.18.x"               // Excel export
  "jspdf": "^2.x"                 // PDF export
  "jspdf-autotable": "^3.x"       // PDF tables
  "aos": "^2.x"                   // Animations
}
```

---

## ⚙️ Environment Configuration

### Backend .env File
```env
# Server
NODE_ENV=development
PORT=5000

# Database (PostgreSQL)
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_PORT=5432
DB_NAME=ipt_school
# Alternatif: satu connection string (opsional)
#DATABASE_URL=postgres://postgres:your_postgres_password@localhost:5432/ipt_school

# Security
JWT_SECRET=your_random_secret_64_chars_minimum

# CORS (production)
ALLOWED_ORIGINS=http://localhost:3000
```

### Frontend .env File (jika diperlukan)
```env
REACT_APP_API_URL=http://localhost:5000/api
```

---

## 🔐 Default Login Credentials

| Role | Login ID | Password | Akses |
|------|----------|----------|-------|
| Superadmin | ADMIN001 | `SUPERADMIN_SETUP_PASSWORD` (login pertama saja) | Full access |
| Guru | (NIP) | (dibuat superadmin) | Input data sesuai izin |
| Siswa | (NIS) | (dibuat superadmin) | View only |

---

## 🐛 Troubleshooting Installation

### Error: "Cannot find module"
```bash
cd backend    # atau cd frontend
npm install   # ulang installasi
```

### Error: "password authentication failed for user postgres" / "connection refused"
- Pastikan PostgreSQL service sedang running:
  - Windows: buka *Services* → cari `postgresql-x64-16` → status *Running*
    (atau cek dengan `pg_isready` di CMD)
  - Linux: `sudo systemctl status postgresql`
- Cek password di file `.env` sama dengan password user `postgres`
  saat instalasi. Ganti password via SQL Shell (psql):
  ```sql
  ALTER USER postgres PASSWORD 'password_baru';
  ```
- Pastikan `DB_PORT=5432` (port default PostgreSQL)

### Error: "Port 5000 already in use"
```bash
# Cari proses yang pakai port 5000
netstat -ano | findstr :5000

# Kill proses (ganti PID dengan nomor dari perintah di atas)
taskkill /PID <PID> /F
```

### Error: "Port 3000 already in use"
```bash
# Kill semua node process
taskkill /F /IM node.exe

# Atau ganti port di frontend
PORT=3001 npm start
```

### Browser Error: "CORS policy"
- Cek CORS configuration di backend server.js
- Pastikan ALLOWED_ORIGINS sesuai dengan URL frontend

---

## 📚 Additional Resources

### Dokumentasi Resmi
- Node.js: https://nodejs.org/docs/
- React: https://react.dev/
- PostgreSQL: https://www.postgresql.org/docs/
- PostgreSQL Tutorial (pemula): https://www.postgresqltutorial.com/
- Express: https://expressjs.com/en/api.html

### Tutorial Terkait
- Express + PostgreSQL: https://node-postgres.com/
- JWT Authentication: https://jwt.io/introduction
- React Router: https://reactrouter.com/en/main

---

## ✅ Post-Installation Checklist

- [ ] Backend running di http://localhost:5000
- [ ] Frontend running di http://localhost:3000
- [ ] Database terkoneksi dengan benar
- [ ] Login dengan ADMIN001 berhasil
- [ ] Avatar upload berfungsi
- [ ] Export Excel/PDF berfungsi
- [ ] Semua menu terlihat dengan benar
- [ ] Tidak ada error di browser console

---

**Butuh bantuan?** Lihat DOCUMENTATION.md untuk panduan lengkap.
