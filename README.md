# Mandara Talenta

Mandara Talenta (Manajemen dan Pengembangan Karakter Talenta) adalah sistem untuk sekolah dengan fitur lengkap untuk mengelola prestasi, organisasi, event, pelanggaran, dan perilaku siswa.

## Tampilan Web 

<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0;">

### Dashboard
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Dashboard Utama</p>
<img src="screenshots/dashboard.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Prestasi
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Prestasi</p>
<img src="screenshots/inputprestasi.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Organisasi
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Organisasi</p>
<img src="screenshots/input organisasi.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Kepanitiaan
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Kepanitiaan</p>
<img src="screenshots/inputpanitia.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Event
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Event</p>
<img src="screenshots/input event.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Pelanggaran
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Pelanggaran</p>
<img src="screenshots/input pelanggaran.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Input Perilaku
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Input Perilaku</p>
<img src="screenshots/perilakusss.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">


### Kelola Akun
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Kelola Akun</p>
<img src="screenshots/kelolaakun.png" alt="Kelola Akun" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Edit Ipt
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Edit Ipt</p>
<img src="screenshots/edit pc awal.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Izin Akun
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Izin Akun</p>
<img src="screenshots/izin akun.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### File Manager
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">File Manager</p>
<img src="screenshots/localstorage.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Logs
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Logs</p>
<img src="screenshots/logs.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Manajemen Wali Kelas
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Manajemen Wali kelas</p>
<img src="screenshots/manajemenwali.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Peringkat
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Peringkat</p>
<img src="screenshots/peringkat.png" alt="Dashboard" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">


### Laporan & Cetak
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Laporan & Cetak</p>
<img src="screenshots/laporancetak.png" alt="Laporan Cetak" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

### Individual Point Talent
<p style="text-align: center; font-weight: bold; margin-bottom: 10px;">Individual Point Talent</p>
<img src="screenshots/individual.png" alt="IPT Card" style="width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">

</div>

## Fitur Utama

### Input Data
- **Input Prestasi**: Mencatat prestasi akademik dan non-akademik dengan sistem poin berdasarkan juara dan kategori (kecamatan, kabupaten, provinsi, nasional, internasional)
- **Input Organisasi**: Mencatat keanggotaan organisasi dengan poin berdasarkan jabatan
- **Input Event**: Mencatat partisipasi event dengan poin berdasarkan tingkat
- **Input Pelanggaran**: Mencatat pelanggaran dengan pengurangan poin IPT
- **Input Perilaku**: Mencatat karakter siswa dengan penambahan poin

### Sistem Approval
- Semua data input memerlukan approval dari Superadmin sebelum disimpan ke database
- Superadmin dapat approve atau reject dengan memberikan alasan
- User mendapatkan notifikasi status approval

### Manajemen Akun
- **Superadmin**: Akun tertinggi dengan akses penuh
- **Guru**: Dapat input data sesuai izin dari superadmin
- **Siswa**: Dapat melihat data dan input sesuai izin dari superadmin

### Sistem Izin (Permissions)
- Superadmin dapat mengatur izin input untuk setiap user
- Bulk permission untuk semua siswa
- Individual permission per user

### Fitur Lainnya
- Dashboard statistik untuk semua user
- Search siswa untuk melihat prestasi
- Profile dengan biodata dan riwayat IPT
- Activity logs untuk audit
- Manajemen Wali Kelas
- Poin IPT otomatis dihitung

## Teknologi

### Backend
- Node.js (Express.js)
- PostgreSQL (via `pg` / node-postgres)
- JWT Authentication
- Multer (file upload)
- Bcrypt (password hashing)

### Frontend
- React.js
- React Router
- Axios

## Instalasi

### Prasyarat
- Node.js (v14 atau lebih tinggi)
- PostgreSQL (v14 atau lebih tinggi) - download: https://www.postgresql.org/download/
  (installer Windows EDB sudah termasuk pgAdmin 4; catat password user `postgres`)
- npm atau yarn

### Langkah-langkah

#### 1. Setup Database
Cara otomatis (disarankan) - membuat database + mengimpor seluruh skema:
```bash
cd backend
npm install
npm run db:setup
```
`npm run db:setup` membaca koneksi dari `backend/.env`, membuat database
`ipt_school` jika belum ada, lalu mengimpor `database/skema.sql`
(semua tabel + data awal IPT).

Cara manual:
1. Buat database baru bernama `ipt_school` - via pgAdmin
   (klik kanan *Databases* → *Create*) atau terminal: `createdb -U postgres ipt_school`
2. Import file `backend/database/skema.sql` ke database `ipt_school`:
   `psql -U postgres -d ipt_school -f backend/database/skema.sql`
3. Pastikan database berhasil dibuat dengan semua tabel (`\dt` di psql)

> 🖱️ Baru pertama kali pakai PostgreSQL? Lihat panduan klik-per-klik
> **pgAdmin 4 di Windows** di `REQUIREMENTS.md` (Step 4).

**Catatan**: Gunakan file `skema.sql` untuk instalasi baru.

#### 2. Setup Backend
```bash
cd backend
npm install
```

#### 3. Konfigurasi Backend
Edit file `backend/.env` sesuai konfigurasi database Anda:
```
DB_HOST=localhost
DB_USER=postgres
DB_PASSWORD=
DB_PORT=5432
DB_NAME=ipt_school
PORT=5000
JWT_SECRET=your_jwt_secret_key_here_change_in_production
```

#### 4. Setup Frontend
```bash
cd frontend
npm install
```

#### 5. Jalankan Backend
```bash
cd backend
npm start
```
Atau untuk development dengan auto-reload:
```bash
npm run dev
```

#### 6. Jalankan Frontend
```bash
cd frontend
npm start
```

Aplikasi akan berjalan di `http://localhost:3000`

## Login Default

### Superadmin
- **Username**: ADMIN001
- **Password**: nilai `SUPERADMIN_SETUP_PASSWORD` dari `backend/.env` **(hanya login pertama)**

> ⚠️ **PENTING**: Database baru berisi ADMIN001 dengan password placeholder,
> jadi tidak bisa login dengan `admin123` sebelum setup. Isi
> `SUPERADMIN_SETUP_PASSWORD` di `.env` (lihat `backend/.env.example`), login
> dengan username `ADMIN001` + password tersebut - password otomatis di-hash
> saat login. Segera ganti password lewat menu Profile, lalu hapus variabel
> itu dari `.env`.

## Sistem Poin IPT

### Prestasi
| Juara | Kecamatan | Kabupaten | Provinsi | Nasional | Internasional |
|-------|-----------|-----------|----------|----------|---------------|
| Juara 1 | 8 | 12 | 30 | 40 | 50 |
| Juara 2 | 7 | 10 | 25 | 35 | 45 |
| Juara 3 | 6 | 8 | 20 | 30 | 40 |
| Harapan 1 | 5 | 7 | 15 | 25 | 35 |
| Harapan 2 | 4 | 6 | 12 | 20 | 30 |
| Harapan 3 | 3 | 5 | 10 | 15 | 25 |
| Finalis | 2 | 4 | 8 | 10 | 20 |
| Peserta | 1 | 3 | 5 | 8 | 15 |

### Organisasi
- Ketua Organisasi: 6 poin
- Wakil Ketua: 5 poin
- Sekretaris: 4 poin
- Bendahara: 3 poin
- Koordinator: 2 poin
- Anggota: 1 poin

### Event
- Sekolah: 2 poin
- Kecamatan: 4 poin
- Kabupaten: 6 poin
- Provinsi: 8 poin
- Nasional: 10 poin
- Internasional: 12 poin

### Pelanggaran (Pengurangan)
- Ringan: -1 poin
- Sedang: -5 poin
- Berat: -25 poin

### Perilaku
- Kurang Baik: 1 poin
- Cukup Baik: 2 poin
- Baik: 3 poin
- Sangat Baik: 4 poin

## Kelas Tersedia

Sistem menggunakan jurusan (program/studi) dan kelas dihitung otomatis berdasarkan tahun pelajaran.

### Jurusan Tersedia
- **TKJ** (Teknik Komputer dan Jaringan): TKJ 1, TKJ 2
- **DPIB** (Desain, Pemodelan, dan Informasi Bangunan): DPIB 1, DPIB 2
- **TKR** (Teknik Kendaraan Ringan): TKR 1, TKR 2

### Kelas Otomatis
Kelas (X, XI, XII) dihitung otomatis berdasarkan tahun pelajaran saat siswa masuk:
- **Tahun 1**: Kelas X (contoh: X TKJ 1, X TKJ 2)
- **Tahun 2**: Kelas XI (contoh: XI TKJ 1, XI TKJ 2)
- **Tahun 3**: Kelas XII (contoh: XII TKJ 1, XII TKJ 2)
- **Tahun 4+**: Lulus (is_graduated = 1)

## Struktur Project

```
mandara-talenta/
├── backend/
│   ├── config/
│   │   └── database.js
│   ├── middleware/
│   │   ├── auth.js          # JWT, RBAC, cek izin input
│   │   └── security.js      # rate limit, helmet, anti-SQLi
│   ├── routes/              # terpasang sebagai /api/* di server.js
│   │   ├── auth.js, users.js, profile.js, permissions.js, input-access.js
│   │   ├── prestasi.js, organisasi.js, kepanitiaan.js
│   │   ├── event.js, pelanggaran.js, perilaku.js
│   │   ├── approvals.js     # approval aktif
│   │   ├── dashboard.js, waliKelas.js, search.js, reports.js
│   │   ├── logs.js, file-viewer.js, academicYear.js, sync.js
│   │   └── iptConfig.js, school-config.js
│   ├── uploads/             # prestasi|organisasi|kepanitiaan|event|
│   │                         # pelanggaran|perilaku|approvals|approved|avatars|logos
│   ├── utils/               # ipt.js, schoolConfig.js, fileUtils.js, ...
│   ├── scripts/
│   │   └── setupDb.js       # npm run db:setup
│   ├── constants/
│   │   └── points.js
│   ├── .env                 # dari .env.example (jangan di-commit)
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── Login.js
│   │   │   ├── Navbar.js
│   │   │   ├── Dashboard.js
│   │   │   ├── InputPrestasi.js
│   │   │   ├── InputOrganisasi.js
│   │   │   ├── InputEvent.js
│   │   │   ├── InputKepanitiaan.js
│   │   │   ├── InputPelanggaran.js
│   │   │   ├── InputPerilaku.js
│   │   │   ├── KelolaAkun.js
│   │   │   ├── IzinAkun.js
│   │   │   ├── Search.js
│   │   │   ├── Profile.js
│   │   │   ├── Logs.js
│   │   │   ├── WaliKelas.js
│   │   │   ├── Approvals.js
│   │   │   ├── Notifications.js
│   │   │   ├── NotificationBadge.js
│   │   │   ├── EditModal.js
│   │   │   ├── KonfigurasiIPT.js
│   │   │   ├── SchoolConfig.js
│   │   │   ├── Leaderboard.js
│   │   │   ├── StudentDetail.js
│   │   │   ├── StudentRecordsHistory.js
│   │   │   ├── TeacherWaliKelas.js
│   │   │   ├── LaporanCetak.js
│   │   │   ├── IptReport.js
│   │   │   ├── IptPrintSheet.js
│   │   │   ├── iptPrintBranding.js
│   │   │   ├── Dashboard.css
│   │   │   ├── icons.js
│   │   │   └── DriveViewer.js
│   │   ├── hooks/
│   │   │   └── useEditModal.js
│   │   ├── utils/           # api.js, minIpt.js, kelasJurusan.js, ...
│   │   ├── App.js
│   │   ├── index.js
│   │   ├── index.css
│   │   └── config.js
│   └── package.json
├── backend/
│   └── database/
│       └── skema.sql  →  (jalur asli: backend/database/skema.sql)
├── docs/
│   └── ACADEMIC_YEAR_SYSTEM.md
├── screenshots/
├── DOCUMENTATION.md, REQUIREMENTS.md, QUICK_GUIDE.md
├── SECURITY.md, IPT_SYNC_GUIDE.md, DOCS_INDEX.txt
├── FLOWCHART.html (+ versi sederhana), LICENSE, README.md
```

## Panduan Penggunaan

### Untuk Superadmin
1. Login dengan akun ADMIN001
2. Buat akun guru dan siswa melalui menu "Kelola Akun"
3. Atur izin input untuk guru dan siswa melalui menu "Izin Akun"
4. Review dan approve/reject submissions melalui menu "Approvals"
5. Monitor aktivitas melalui menu "Logs"
6. Assign wali kelas melalui menu "Wali Kelas"
7. Input data langsung tanpa perlu approval

### Untuk Guru
1. Login dengan NIP
2. Input data sesuai izin yang diberikan superadmin
3. Lihat dashboard statistik
4. Search siswa untuk melihat prestasi
5. Edit biodata sendiri

### Untuk Siswa
1. Login dengan NIS atau NISN
2. Lihat biodata dan IPT di menu Profile
3. Input data sesuai izin yang diberikan superadmin
4. Lihat riwayat IPT
5. Tidak dapat mengedit biodata sendiri

## Troubleshooting

### Database Connection Error
- Pastikan PostgreSQL sedang berjalan (`pg_isready` harus menjawab `accepting connections`;
  Windows: cek *Services* → `postgresql-x64-*` → *Running*)
- Cek konfigurasi di file `backend/.env` (terutama `DB_PASSWORD` = password user `postgres`)
- Pastikan database `ipt_school` sudah dibuat (`npm run db:setup` membuatnya otomatis)

### CORS Error
- Pastikan backend berjalan di port 5000
- Cek konfigurasi CORS di `backend/server.js`

### Upload File Error
- Pastikan folder `uploads` ada di backend
- Pastikan permission folder sudah benar

## Catatan Penting

- Setiap siswa baru otomatis mendapatkan 80 poin IPT awal
- Superadmin dapat mengubah IPT siswa kapan saja
- Data duplikat (NIS/NISN/NIP sama) tidak dapat dibuat
- Semua input data memerlukan approval kecuali dari superadmin
- Foto bukti disimpan di folder `backend/uploads/approvals` di server (local storage)
- Google Drive integration telah dihapus dan diganti dengan penyimpanan lokal server

## Optimasi & Kinerja

### Optimasi yang Diterapkan
- **Dashboard Auto-refresh**: Data dashboard otomatis di-refresh setiap 30 detik untuk memastikan data terbaru
- **Notification Polling**: Notifikasi dicek setiap 30 detik untuk update real-time
- **Database Query Optimization**: Query dashboard dioptimasi dengan indexing pada tabel utama
- **Class Calculation**: Kelas siswa dihitung otomatis berdasarkan tahun pelajaran dan jurusan
- **IPT Breakdown**: Perhitungan IPT menggunakan fungsi terpusat untuk konsistensi data

### Catatan Kinerja
- Aplikasi menggunakan React 18 dengan optimasi rendering
- Backend menggunakan Express.js dengan middleware rate limiting untuk keamanan
- File upload menggunakan multer dengan storage lokal yang efisien
- Query database menggunakan prepared statements untuk mencegah SQL injection

## Pengembangan Lanjutan

Fitur yang dapat ditambahkan:
- Export laporan ke Excel/PDF
- Print system
- Notifikasi email
- Dashboard grafik lebih interaktif
- Mobile app

## License

Proprietary - Copyright (C) 2026 Dean Putra & Agus Kariada. All rights reserved.

Penggunaan perangkat lunak ini terbatas untuk SMK Negeri Bali Mandara.
Dilarang menyalin, menyebarluaskan, atau menggunakan kembali perangkat lunak ini
untuk sekolah atau pihak lain tanpa izin tertulis dari pemegang hak cipta.
Lihat file `LICENSE` untuk ketentuan lengkap.
