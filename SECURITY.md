# Mandara Talenta - Dokumentasi Keamanan

> File ini mendeskripsikan langkah keamanan yang **benar-benar diimplementasikan**
> di kode (`backend/middleware/security.js`, `backend/middleware/auth.js`,
> `backend/server.js`). Klaim di sini diverifikasi terhadap kode, bukan aspirasi.

## Langkah yang Diimplementasikan

| Langkah | Lokasi | Keterangan |
|---|---|---|
| Login rate limiting per IP | `middleware/security.js` (`loginLimiter`) | Maks 100 percobaan gagal / 15 menit per IP; login sukses tidak dihitung |
| Login rate limiting per akun | `middleware/security.js` (`loginAccountLimiter`) | Maks 20 percobaan gagal / 15 menit per username |
| Forgot-password rate limiting | `middleware/security.js` (`forgotPasswordLimiter`) | Maks 10 permintaan / 15 menit per IP; ditambah cooldown 12 jam per akun |
| Security headers (API) | `middleware/security.js` (`securityHeaders`, helmet) | CSP, HSTS, nosniff, referrer policy, frame protection |
| Security headers (frontend) | `frontend/serve.js` | Header yang sama untuk HTML/static saat frontend di-serve terpisah |
| Password hashing | `routes/auth.js` (bcrypt, async) | Password tidak pernah disimpan plain-text; bcrypt tidak memblokir event loop |
| Anti username enumeration | `routes/auth.js` | Pesan login dibuat generik; akun tidak dikenal tetap menjalankan bcrypt dummy |
| JWT via HTTP-only cookie | `routes/auth.js`, `middleware/auth.js` | Token tidak bisa dibaca JavaScript; `SameSite=Lax`, `Secure` saat HTTPS |
| Role-based access control | `middleware/auth.js` (`auth`, `superAdminOnly`, dsb.) | Peran di-refresh dari database sehingga perubahan role berlaku segera |
| Input permission check | `middleware/auth.js` (`checkInputAccess`) | Guru/Siswa hanya bisa input sesuai izin superadmin |
| SQL injection prevention | Query database | Nilai input memakai parameter `?`; identifier/limit dinamis berasal dari allowlist/internal, bukan input mentah |
| XSS prevention | React + CSP | React melakukan output escaping; CSP `script-src 'self'`; tidak ada `dangerouslySetInnerHTML` |
| CORS allowlist | `server.js` (`ALLOWED_ORIGINS`) | Origin dicocokkan persis (scheme + host + port); wildcard tidak dipakai |
| Upload access | `server.js` (`authForUploads`) | `/uploads` memerlukan sesi login; tidak ada `Access-Control-Allow-Origin: *` |
| Public branding logo | `routes/school-config.js` | Hanya file logo yang tercatat di `school_config` yang bisa diakses tanpa login |
| Upload validation | `routes/*` (multer) + `utils/evidenceUpload.js` | Bukti: gambar/PDF dengan batas ukuran; logo: JPEG/PNG maks 5 MB, nama file dibuat server |

## Yang Harus Dilakukan Operator (tidak otomatis)

- [ ] `JWT_SECRET` di `.env` diganti string acak minimal 32 karakter (jangan pakai contoh)
- [ ] `SUPERADMIN_SETUP_PASSWORD` dihapus dari `.env` setelah login pertama berhasil
- [ ] `NODE_ENV=production` + HTTPS (wajib bila diakses lewat internet)
- [ ] `ALLOWED_ORIGINS=https://talenta.skanbara.my.id` (origin persis, tanpa wildcard)
- [ ] `HOST=0.0.0.0` (atau IP LAN server) dan `TRUST_PROXY=1`, karena cloudflared berjalan di perangkat lain
- [ ] Cloudflare Tunnel mengarah ke `http://<IP-LAN-server>:3000` dan `http://<IP-LAN-server>:5000`
- [ ] Firewall port 3000/5000 hanya mengizinkan IP perangkat cloudflared; jangan terbuka ke LAN lain/internet
- [ ] Backup berkala database `ipt_school` + folder `backend/uploads/`
- [ ] `npm audit` berkala; update dependensi tiap kuartal
- [ ] Jangan commit file `.env` ke git (sudah ada di `.gitignore` - verifikasi)

## Respons Insiden

1. Putar (rotate) `JWT_SECRET` - semua sesi aktif otomatis invalid.
2. Ganti password akun yang terdampak lewat superadmin (menu Kelola Akun).
3. Periksa `activity_logs` (menu Logs) untuk aktivitas mencurigakan.
4. Bila ada upload berbahaya, hapus file di `backend/uploads/` dan cabut izin input user terkait.

## Batasan yang Diketahui

- Rate limit login dibagi per IP dan per username. Jika `TRUST_PROXY` salah,
  semua pengguna bisa terlihat berasal dari IP tunnel yang sama.
- Karena cloudflared berada di perangkat lain, origin harus listen di interface
  LAN. `TRUST_PROXY=1` hanya aman bila firewall membatasi port 3000/5000 ke IP
  perangkat cloudflared; host LAN lain yang bisa connect dapat memalsukan
  `X-Forwarded-For`.
- Tidak ada 2FA; keamanan akun mengandalkan kekuatan password + rate limit login.
- File `backend/.env` adalah satu-satunya penyimpanan secret - amankan permission-nya
  di server (`chmod 600` di Linux).
- `style-src 'unsafe-inline'` masih diperlukan oleh sebagian komponen UI; CSP
  tetap membatasi script ke origin sendiri.
