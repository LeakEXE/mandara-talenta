# 🔒 Mandara Talenta - Dokumentasi Keamanan

> File ini mendeskripsikan langkah keamanan yang **benar-benar diimplementasikan**
> di kode (`backend/middleware/security.js`, `backend/middleware/auth.js`,
> `backend/server.js`). Klaim di sini diverifikasi terhadap kode, bukan aspirasi.

## Langkah yang Diimplementasikan

| Langkah | Lokasi | Keterangan |
|---|---|---|
| Login rate limiting | `middleware/security.js` (`loginLimiter`) | Maks 5x percobaan / 15 menit per IP; login sukses tidak dihitung |
| Logout rate limiting | `middleware/security.js` (`logoutLimiter`) | Maks 10x / 15 menit per IP |
| API rate limiting | `middleware/security.js` (`apiLimiter`) | Maks 500 request / menit per IP |
| Security headers | `middleware/security.js` (`securityHeaders`, helmet) | Header HTTP keamanan standar |
| SQL injection prevention | `middleware/security.js` (`sqlInjectionPrevention`) | Pola SQL berbahaya di request ditolak (403); query DB memakai prepared statements |
| Password hashing | `routes/auth.js` (bcrypt) | Password tidak pernah disimpan plain-text |
| JWT via HTTP-only cookie | `routes/auth.js`, `middleware/auth.js` | Token tidak bisa dibaca JavaScript (mitigasi XSS); kredensial `withCredentials` |
| Role-based access control | `middleware/auth.js` (`auth`, `superadminOnly`, dsb.) | Setiap route sensitif dicek peran |
| Input permission check | `middleware/auth.js` (`checkInputAccess`) | Guru/Siswa hanya bisa input sesuai izin superadmin |
| CORS allowlist | `server.js` (`ALLOWED_ORIGINS`) | Origin di luar daftar ditolak |
| Upload validation | `routes/*` (multer) + `utils/fileUtils.js` | Tipe/ukuran file dibatasi, disimpan lokal di `backend/uploads/` |

## Yang Harus Dilakukan Operator (tidak otomatis)

- [ ] `JWT_SECRET` di `.env` diganti string acak ≥ 32 karakter (jangan pakai contoh)
- [ ] `SUPERADMIN_SETUP_PASSWORD` dihapus dari `.env` setelah login pertama berhasil
- [ ] `NODE_ENV=production` + HTTPS (wajib bila diakses lewat internet)
- [ ] `ALLOWED_ORIGINS` diisi domain produksi, tanpa wildcard
- [ ] Backup berkala database `ipt_school` + folder `backend/uploads/`
- [ ] `npm audit` berkala; update dependensi tiap kuartal
- [ ] Jangan commit file `.env` ke git (sudah ada di `.gitignore` - verifikasi)

## Respons Insiden

1. Putar (rotate) `JWT_SECRET` - semua sesi aktif otomatis invalid.
2. Ganti password akun yang terdampak lewat superadmin (menu Kelola Akun).
3. Periksa `activity_logs` (menu Logs) untuk aktivitas mencurigakan.
4. Bila ada upload berbahaya, hapus file di `backend/uploads/` dan cabut izin input user terkait.

## Batasan yang Diketahui

- Rate limit berbasis IP: tidak efektif bila banyak user di belakang satu NAT/proxy
  tanpa konfigurasi `TRUST_PROXY` yang benar (lihat komentar di `server.js`).
- Tidak ada 2FA; keamanan akun mengandalkan kekuatan password + rate limit login.
- File `backend/.env` adalah satu-satunya penyimpanan secret - amankan permission-nya
  di server (`chmod 600` di Linux).
