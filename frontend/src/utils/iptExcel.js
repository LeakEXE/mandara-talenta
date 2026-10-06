import ExcelJS from 'exceljs';

// ------------------------------------------------------------------
// Individual Point Talent Excel ("Raport IPT")
// Layout direplika dari dokumen resmi sekolah (format_ipt.xlsx):
// kop di baris 1-8, judul 9-13, biodata 15-17, tabel point 19-39,
// tanda tangan 42-48. Area cetak A1:L48, portrait A4.
// Prestasi (II) dirinci per kategori: Akademik (22) + Non-akademik (23);
// kolom A "II" TIDAK di-merge dengan B-G (berdiri sendiri seperti I, III...).
// Baris Pelanggaran mengikuti SEMUA tingkat yang dikonfigurasi
// (urut point terkecil -> terbesar). Jika tingkat > 3, tabel memanjang:
// baris TOTAL/tanda tangan & area cetak bergeser mengikuti jumlah baris.
// ------------------------------------------------------------------

const TNR = 'Times New Roman';
const INK = 'FF000000';

// Password proteksi sheet untuk SEMUA unduhan Excel /laporan-cetak
// (kartu individual & leger kelas). Satu sumber supaya konsisten;
// admin memakai password ini untuk Unprotect di Excel bila perlu mengedit.
export const IPT_SHEET_PASSWORD = 'balimandara-ipt';

// Opsi proteksi: seluruh sel terkunci (anti-edit), pengguna hanya boleh
// menyeleksi (lihat/salin) — seleksi tidak mengubah isi & tidak merusak cetak.
const IPT_SHEET_PROTECT_OPTIONS = { selectLockedCells: true, selectUnlockedCells: true };

// Lebar kolom A..L (satuan Excel) sesuai dokumen asli
const COL_WIDTHS = [4.22, 4.11, 3.33, 3.22, 6.78, 7.78, 14.22, 7.22, 2.11, 3.22, 12, 4.44];

const F_TITLE = { name: TNR, size: 12, bold: true };
const F_TEXT = { name: TNR, size: 11 };
const F_BOLD = { name: TNR, size: 11, bold: true };
const F_SIGN = { name: TNR, size: 11, bold: true, underline: true };
// Merah untuk baris Pelanggaran (point negatif) — sama dengan warna merah
// nilai negatif pada leger kelas (LaporanCetak).
const F_BOLD_RED = { name: TNR, size: 11, bold: true, color: { argb: 'FFC00000' } };

const A_CENTER = { vertical: 'middle', horizontal: 'center', wrapText: true };
const A_LEFT = { vertical: 'middle', horizontal: 'left', wrapText: true };
const A_LEFT_NW = { vertical: 'middle', horizontal: 'left' }; // tanpa wrap (area tanda tangan)

const MERGES = [
  'A9:K9', 'A11:K11', 'A12:K12', 'A13:K13',
  'A15:C15', 'E15:H15', 'I15:K15',
  'E16:H16', 'I16:K16',
  'A17:C17', 'E17:H17', 'I17:K17',
  'A19:G19', 'H19:K19',
  'B20:G20', 'H20:K20',
  // II Prestasi: A21 ("II") TIDAK di-merge — dinormalkan seperti kolom A lain.
  // Header + 2 baris rincian (Akademik, Non-akademik).
  'A21:A23', 'B21:G21', 'H21:K21',
  'C22:G22', 'H22:K22', 'C23:G23', 'H23:K23',
  'A24:A31', 'B24:G24', 'H24:K24',
  'C25:G25', 'H25:K25', 'C26:G26', 'H26:K26', 'C27:G27', 'H27:K27',
  'C28:G28', 'H28:K28', 'C29:G29', 'H29:K29', 'C30:G30', 'H30:K30',
  'C31:G31', 'H31:K31',
  'B32:G32', 'H32:K32', 'B33:G33', 'H33:K33', 'B34:G34', 'H34:K34',
];
// Merge bagian bawah tabel (baris 35: header VII, item, dan TOTAL) dibangun
// dinamis di createIndividualIptExcelBuffer sesuai jumlah tingkat pelanggaran.

const ROW_HEIGHTS = {
  // Hanya baris spacer (10) yang memakai tinggi khusus; semua baris lain
  // diseragamkan ke 20 (lihat penerapan di createIndividualIptExcelBuffer).
  10: 1.95,
};

function setCell(sheet, addr, value, { font, alignment } = {}) {
  const cell = sheet.getCell(addr);
  cell.value = value;
  if (font) cell.font = font;
  if (alignment) cell.alignment = alignment;
  return cell;
}

// Grid tabel A19:K{totalRow}: garis horizontal medium, vertikal tipis di dalam,
// medium di tepi luar — sesuai dokumen asli.
function styleTableGrid(sheet, totalRow = 37) {
  const thin = { style: 'thin', color: { argb: INK } };
  const medium = { style: 'medium', color: { argb: INK } };
  for (let r = 19; r <= totalRow; r++) {
    for (let c = 1; c <= 11; c++) {
      const cell = sheet.getCell(r, c);
      cell.border = {
        top: r === 19 ? medium : thin,
        bottom: r === totalRow ? medium : thin,
        left: c === 1 ? medium : thin,
        right: c === 11 ? medium : thin,
      };
    }
  }
}

// Ambil gambar kop (logo sekolah -> header.png) sebagai base64 + dimensi asli.
// Dipisah agar mudah diuji; di browser memakai fetch + Image.
export async function fetchKopImage(urls) {
  for (const url of urls) {
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      const clean = String(url).split('?')[0];
      const ext = (clean.split('.').pop() || 'png').toLowerCase();
      const extension = ext === 'jpg' ? 'jpeg' : ['png', 'jpeg', 'gif'].includes(ext) ? ext : 'png';
      const dims = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(new Blob([buf]));
      });
      if (!dims) continue;
      return { base64: btoa(binary), extension, dims };
    } catch {
      // coba URL berikutnya
    }
  }
  return null;
}

function fitImage(dims, maxW, maxH) {
  const scale = Math.min(maxW / dims.w, maxH / dims.h, 1);
  return { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) };
}

// Bentuk normalisasi nilai point dari breakdown API (string/null -> number)
const num = (v) => Number(v) || 0;

// 'sangat berat' -> 'Sangat Berat' (label resmi tingkat di cetakan)
const titleCase = (s) =>
  String(s).split(' ').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');

export function calcIndividualPoints(points = {}) {
  const pointAwal = num(points.point_awal) || 80;
  // Prestasi dirinci per kategori (jenis_lomba); total gabungan tetap
  // dipakai untuk TOTAL agar konsisten dengan leger & users.ipt_total.
  const prestasi = num(points.prestasi);
  const prestasiAkademik = num(points.prestasi_akademik);
  const prestasiNonAkademik = num(points.prestasi_non_akademik);
  const tanggungJawab = num(points.tanggung_jawab);
  const disiplin = num(points.disiplin);
  const kepedulian = num(points.kepedulian);
  const kemandirian = num(points.kemandirian);
  const spiritual = num(points.spiritual);
  const kejujuran = num(points.kejujuran);
  const kepercayaanDiri = num(points.kepercayaan_diri);
  const organisasi = num(points.organisasi);
  const kepanitiaan = num(points.kepanitiaan);
  const event = num(points.event);
  const pelanggaranRingan = num(points.pelanggaran_ringan);
  const pelanggaranSedang = num(points.pelanggaran_sedang);
  const pelanggaranBerat = num(points.pelanggaran_berat);
  const pelanggaranLainnya = num(points.pelanggaran_lainnya);
  // Pelanggaran disimpan negatif (pengurangan) — sama seperti users.ipt_total —
  // jadi total di sini cukup penjumlahan biasa, bukan pengurangan.
  const total =
    pointAwal +
    prestasi +
    tanggungJawab + disiplin + kepedulian + kemandirian + spiritual + kejujuran + kepercayaanDiri +
    organisasi + kepanitiaan + event +
    pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + pelanggaranLainnya;
  return {
    pointAwal, prestasi, prestasiAkademik, prestasiNonAkademik,
    tanggungJawab, disiplin, kepedulian, kemandirian, spiritual, kejujuran, kepercayaanDiri,
    organisasi, kepanitiaan, event,
    pelanggaranRingan, pelanggaranSedang, pelanggaranBerat, pelanggaranLainnya,
    total,
  };
}

// Susun workbook "Raport IPT" untuk satu siswa.
// school: { school_name, principal_name, principal_nip }
// kopImage: { base64, extension, dims: { w, h } } | null
export async function createIndividualIptExcelBuffer({
  student = {},
  wali = null,
  points = {},
  iptTotal = null,
  school = {},
  semester = 'Ganjil', // sama seperti default backend (templateData semester)
  tahunPelajaran = null,
  tanggal = null,
  kopImage = null,
  minIpt = 0, // batas minimum Total IPT (0 = nonaktif)
}) {
  const p = calcIndividualPoints(points);
  const total = iptTotal ?? p.total;
  // Total di bawah batas minimum diketak merah — hanya nilai Total (kolom H),
  // label "TOTAL POINT IPT" tetap hitam.
  const totalBelowMin = Number(minIpt) > 0 && Number(total) < Number(minIpt);

  // Baris Pelanggaran: SEMUA tingkat dari konfigurasi, urut dari point
  // terkecil (-1) ke terbesar. Fallback lama: Ringan/Sedang/Berat.
  const levelSource = Array.isArray(points.pelanggaran_levels) && points.pelanggaran_levels.length
    ? points.pelanggaran_levels
    : [
        { name: 'Ringan', total: p.pelanggaranRingan },
        { name: 'Sedang', total: p.pelanggaranSedang },
        { name: 'Berat', total: p.pelanggaranBerat },
      ];
  const langgarRows = levelSource.map((l) => [titleCase(l.name), num(l.total)]);
  while (langgarRows.length < 3) langgarRows.push(['', null]); // jaga format asli (3 baris)
  const nRows = langgarRows.length;
  // Seksi Prestasi (II) memakai 3 baris (header 21 + rincian 22-23),
  // sehingga semua baris di bawahnya bergeser +2 dari format asli.
  const rIII = 24;                      // header seksi III
  const rVII = 35;                      // header seksi VII Pelanggaran
  const lastItemRow = rVII + nRows;     // baris item terakhir Pelanggaran
  const totalRow = lastItemRow + 1;     // baris TOTAL POINT IPT
  const signRow = totalRow + 3;         // baris awal blok tanda tangan

  const schoolName = school.school_name || 'SMK Negeri Bali Mandara';
  const principalName = school.principal_name || 'Nama Kepala Sekolah';
  const principalNip = school.principal_nip || '-';
  const waliNama = wali?.nama || '-';
  const waliNip = wali?.nip || '-';
  const year = new Date().getFullYear();
  const tp = tahunPelajaran || `${year}/${year + 1}`;
  const tgl = tanggal || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Raport IPT', {
    pageSetup: { paperSize: 9, orientation: 'portrait'},
  });
  // Margin sesuai cetakan resmi: kiri 3,6 cm, kanan 0,2 cm.
  // ExcelJS memakai inci & hanya menulis pageSetup.margins ke file
  // (properti pageMargins polos diabaikan saat tulis).
  sheet.pageSetup.margins = { left: 3.6 / 2.54, right: 0.2 / 2.54, top: 0.18, bottom: 0.3, header: 0.12, footer: 0.12 };
  sheet.pageSetup.printArea = `A1:M${totalRow + 9}`;

  COL_WIDTHS.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });

  // Tinggi baris: 20 untuk semua baris kecuali baris spacer (10).
  // Mencakup area kop (1-8), isi, tabel (yang memanjang mengikuti
  // jumlah tingkat pelanggaran), dan blok tanda tangan.
  const lastBodyRow = totalRow + 10;
  for (let r = 1; r <= lastBodyRow; r++) {
    sheet.getRow(r).height = r === 10 ? ROW_HEIGHTS[10] : 20;
  }

  // Merge bagian bawah tabel (header VII, item, dan TOTAL) mengikuti
  // jumlah tingkat pelanggaran; baris 9-34 statis di MERGES.
  const tableTail = [`A${rVII}:A${lastItemRow}`, `B${rVII}:G${rVII}`, `H${rVII}:K${rVII}`];
  for (let r = rVII + 1; r <= lastItemRow; r++) tableTail.push(`C${r}:G${r}`, `H${r}:K${r}`);
  tableTail.push(`A${totalRow}:G${totalRow}`, `H${totalRow}:K${totalRow}`);
  [...MERGES, ...tableTail].forEach((m) => sheet.mergeCells(m));

  // Kop (baris 1-8 dikosongkan untuk gambar, seperti dokumen asli)
  // Kop mulai dari kolom B (col 1) agar tampak di tengah halaman.
  if (kopImage) {
    const imageId = workbook.addImage({ base64: kopImage.base64, extension: kopImage.extension || 'png' });
    const size = fitImage(kopImage.dims || { w: 480, h: 130 }, 490, 128);
    sheet.addImage(imageId, { tl: { col: 1, row: 0 }, ext: size });
  }

  // Judul
  setCell(sheet, 'A9', 'INDIVIDUAL POINT TALENT', { font: F_TITLE, alignment: A_CENTER });
  setCell(sheet, 'A11', String(schoolName).toUpperCase(), { font: F_TITLE, alignment: A_CENTER });
  setCell(sheet, 'A12', 'TAHUN PELAJARAN', { font: F_TITLE, alignment: A_CENTER });
  setCell(sheet, 'A13', tp, { font: F_TITLE, alignment: A_CENTER });

  // Biodata
  setCell(sheet, 'A15', 'Nama', { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'D15', ':', { font: F_TEXT, alignment: A_CENTER });
  setCell(sheet, 'E15', student.nama || '-', { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'I15', `Kelas : ${student.kelas || '-'}`, { font: F_TEXT, alignment: A_LEFT });

  setCell(sheet, 'A16', 'NIS', { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'D16', ':', { font: F_TEXT, alignment: A_CENTER });
  setCell(sheet, 'E16', student.nis != null ? String(student.nis) : '-', { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'I16', `Grha : ${student.grha || '-'}`, { font: F_TEXT, alignment: A_LEFT });

  // Nama wali mendapat merge E17:H17 (+1 kolom dari format asli) agar
  // nama panjang tidak terpotong; blok Semester digabung di I17:K17.
  setCell(sheet, 'A17', 'Wali Kelas', { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'D17', ':', { font: F_TEXT, alignment: A_CENTER });
  setCell(sheet, 'E17', waliNama, { font: F_TEXT, alignment: A_LEFT });
  setCell(sheet, 'I17', `Semester : ${semester}`, { font: F_TEXT, alignment: A_LEFT });

  // Tabel point
  setCell(sheet, 'A19', 'Point IPT', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, 'H19', 'Point', { font: F_BOLD, alignment: A_CENTER });

  setCell(sheet, 'A20', 'I', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, 'B20', 'Point Awal', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, 'H20', p.pointAwal, { font: F_BOLD, alignment: A_CENTER });

  // Prestasi (II): A21 ("II") berdiri sendiri; rincian Akademik (22)
  // dan Non-akademik (23) mengikuti pola seksi III/VII.
  setCell(sheet, 'A21', 'II', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, 'B21', 'Prestasi', { font: F_BOLD, alignment: A_CENTER });

  const prestasiRows = [['Akademik', p.prestasiAkademik], ['Non-akademik', p.prestasiNonAkademik]];
  prestasiRows.forEach(([label, val], i) => {
    const r = 22 + i;
    setCell(sheet, `B${r}`, i + 1, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `C${r}`, label, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `H${r}`, val, { font: F_TEXT, alignment: A_CENTER });
  });

  setCell(sheet, `A${rIII}`, 'III', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, `B${rIII}`, 'Perkembangan karakter', { font: F_BOLD, alignment: A_CENTER });

  const karakterRows = [
    ['Tanggung Jawab', p.tanggungJawab], ['Disiplin', p.disiplin], ['Kepedulian', p.kepedulian],
    ['Kemandirian', p.kemandirian], ['Spiritual', p.spiritual], ['Kejujuran', p.kejujuran],
    ['Kepercayaan Diri', p.kepercayaanDiri],
  ];
  karakterRows.forEach(([label, val], i) => {
    const r = rIII + 1 + i;
    setCell(sheet, `B${r}`, i + 1, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `C${r}`, label, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `H${r}`, val, { font: F_TEXT, alignment: A_CENTER });
  });

  const rIV = rIII + 8;
  const aktifRows = [['IV', 'Organisasi', p.organisasi], ['V', 'Kepanitiaan', p.kepanitiaan], ['VI', 'Event', p.event]];
  aktifRows.forEach(([roman, label, val], i) => {
    const r = rIV + i;
    setCell(sheet, `A${r}`, roman, { font: F_BOLD, alignment: A_CENTER });
    setCell(sheet, `B${r}`, label, { font: F_BOLD, alignment: A_CENTER });
    setCell(sheet, `H${r}`, val, { font: F_TEXT, alignment: A_CENTER });
  });

  setCell(sheet, `A${rVII}`, 'VII', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, `B${rVII}`, 'Pelanggaran', { font: F_BOLD, alignment: A_CENTER });

  // Satu baris per tingkat (sudah diurutkan; nilai negatif = pengurangan)
  // — hanya nilai Point (kolom H) yang dicetak merah.
  langgarRows.forEach(([label, val], i) => {
    const r = rVII + 1 + i;
    setCell(sheet, `B${r}`, i + 1, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `C${r}`, label, { font: F_TEXT, alignment: A_CENTER });
    setCell(sheet, `H${r}`, val, { font: F_TEXT, alignment: A_CENTER });
  });

  setCell(sheet, `A${totalRow}`, 'TOTAL POINT IPT', { font: F_BOLD, alignment: A_CENTER });
  setCell(sheet, `H${totalRow}`, total, { font: totalBelowMin ? F_BOLD_RED : F_BOLD, alignment: A_CENTER });

  styleTableGrid(sheet, totalRow);

  // Label tabel (A19:G{lastItemRow}) rata kiri; kolom Point (H) tetap rata tengah.
  for (let r = 19; r <= lastItemRow; r++) {
    for (let c = 1; c <= 7; c++) {
      sheet.getCell(r, c).alignment = A_LEFT;
    }
  }

  // Tanda tangan (tanpa merge & tanpa wrap)
  setCell(sheet, `A${signRow}`, 'Mengetahui.', { font: F_BOLD, alignment: A_LEFT_NW });
  setCell(sheet, `H${signRow}`, `Kubutambahan, ${tgl}`, { font: F_BOLD, alignment: A_LEFT_NW });
  setCell(sheet, `A${signRow + 1}`, `Kepala ${schoolName}`, { font: F_BOLD, alignment: A_LEFT_NW });
  setCell(sheet, `H${signRow + 1}`, 'Wali Kelas', { font: F_BOLD, alignment: A_LEFT_NW });
  setCell(sheet, `A${signRow + 5}`, principalName, { font: F_SIGN, alignment: A_LEFT_NW });
  setCell(sheet, `H${signRow + 5}`, waliNama, { font: F_SIGN, alignment: A_LEFT_NW });
  setCell(sheet, `A${signRow + 6}`, `NIP. ${principalNip}`, { font: F_BOLD, alignment: A_LEFT_NW });
  setCell(sheet, `H${signRow + 6}`, `NIP. ${waliNip}`, { font: F_BOLD, alignment: A_LEFT_NW });

  // Kunci border tabel: ExcelJS menyalin referensi objek style dari sel master
  // merge ke semua anggotanya, sehingga penulisan border per-sel saling
  // menimpa antar-sel dalam satu merge (tepi kiri A19/A39 jadi thin).
  // Tulis ulang setiap sel tabel dengan objek style BARU yang lengkap agar
  // tidak lagi berbagi referensi.
  for (let r = 19; r <= totalRow; r++) {
    for (let c = 1; c <= 11; c++) {
      const cell = sheet.getCell(r, c);
      const st = cell.style || {};
      const side = (s) => ({ style: s, color: { argb: INK } });
      cell.style = {
        ...(st.font ? { font: { ...st.font } } : {}),
        ...(st.alignment ? { alignment: { ...st.alignment } } : {}),
        border: {
          top: side(r === 19 ? 'medium' : 'thin'),
          bottom: side(r === totalRow ? 'medium' : 'thin'),
          left: side(c === 1 ? 'medium' : 'thin'),
          right: side(c === 11 ? 'medium' : 'thin'),
        },
      };
    }
  }

  // Proteksi tulis: dokumen resmi — kunci sebelum tulis buffer.
  await sheet.protect(IPT_SHEET_PASSWORD, IPT_SHEET_PROTECT_OPTIONS);

  return workbook.xlsx.writeBuffer();
}
