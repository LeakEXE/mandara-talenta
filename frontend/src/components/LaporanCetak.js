import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import ExcelJS from 'exceljs';
import { createIndividualIptExcelBuffer, fetchKopImage, IPT_SHEET_PASSWORD } from '../utils/iptExcel';
import { fetchMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import '../iptPrint.css';

// ------------------------------------------------------------------
// KONFIGURASI WARNA
// ------------------------------------------------------------------
// Warna untuk ExcelJS (format ARGB)
const EXCEL_COLORS = {
  prestasi: "FFFFF2CC",
  karakter: "FFC6E0B4",
  keaktifan: "FFF8CBAD",
  pelanggaran: "FFF4C7C3",
  total: "FFBDD7EE",
  jumlahPrestasi: "FFFFFF00",
  jumlahKarakter: "FFA9D08E",
  jumlahKeaktifan: "FFF4B084",
  jumlahPelanggaran: "FFFFC7CE",
  headerAbu: "FFE6E6E6",
};

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFB4B4B4" } },
  left: { style: "thin", color: { argb: "FFB4B4B4" } },
  bottom: { style: "thin", color: { argb: "FFB4B4B4" } },
  right: { style: "thin", color: { argb: "FFB4B4B4" } },
};

// Helper: Calculate totals - MUST MATCH BACKEND CALCULATION
function hitungTotal(s) {
  // Point awal (default 80 if not specified)
  const iptAwal = s.ipt_awal || 80;
  
  // Prestasi: total gabungan dipakai untuk Total IPT (konsisten dengan
  // backend); rinciannya Akademik / Non-akademik ditampilkan terpisah.
  const totalPrestasi = Number(s.prestasi) || 0;
  
  // Perilaku (7 karakter)
  const tanggungJawab = Number(s.tanggung_jawab) || 0;
  const disiplin = Number(s.disiplin) || 0;
  const kepedulian = Number(s.kepedulian) || 0;
  const kemandirian = Number(s.kemandirian) || 0;
  const spiritual = Number(s.spiritual) || 0;
  const kejujuran = Number(s.kejujuran) || 0;
  const kepercayaanDiri = Number(s.kepercayaan_diri) || 0;
  
  // Keaktifan
  const organisasi = Number(s.organisasi) || 0;
  const kepanitiaan = Number(s.kepanitiaan) || 0;
  const event = Number(s.event) || 0;
  
  // Pelanggaran
  const pelanggaranRingan = Number(s.pelanggaran_ringan) || 0;
  const pelanggaranSedang = Number(s.pelanggaran_sedang) || 0;
  const pelanggaranBerat = Number(s.pelanggaran_berat) || 0;
  const pelanggaranLainnya = Number(s.pelanggaran_lainnya) || 0;
  
  const totalKarakter = tanggungJawab + disiplin + kepedulian + kemandirian + spiritual + kejujuran + kepercayaanDiri;
  const totalKeaktifan = organisasi + kepanitiaan + event;
  const totalPelanggaran = pelanggaranRingan + pelanggaranSedang + pelanggaranBerat + pelanggaranLainnya;
  
  // Pelanggaran bernilai negatif (pengurangan) -> cukup dijumlahkan.
  const iptTotal = iptAwal + totalPrestasi + totalKarakter + totalKeaktifan + totalPelanggaran;
  
  return {
    iptAwal,
    totalPrestasi,
    totalKarakter,
    totalKeaktifan,
    totalPelanggaran,
    iptTotal
  };
}

// Helper: Style cell
function styleCell(cell, { fill, bold, align = "center", color } = {}) {
  cell.border = THIN_BORDER;
  cell.alignment = { vertical: "middle", horizontal: align, wrapText: true };
  if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  if (bold) cell.font = { ...(cell.font || {}), bold: true, color: color ? { argb: color } : undefined };
  else if (color) cell.font = { ...(cell.font || {}), color: { argb: color } };
}

// Column definitions
const COLUMN_DEFS = [
  { key: "no", header1: "No", merge: "v", width: 5 },
  { key: "nama", header1: "Nama Siswa", merge: "v", width: 32, align: "left" },
  { key: "nis", header1: "Nis", merge: "v", width: 11 },
  { key: "kelas", header1: "Kelas", merge: "v", width: 10 },
  { key: "grha", header1: "Grha", merge: "v", width: 9 },
  { key: "pointAwal", header1: "Point Awal", merge: "v", width: 10 }, // Added point awal column

  { key: "prestasi_akademik", header1: "Prestasi", header2: "Akademik", group: "prestasi", width: 10 },
  { key: "prestasi_non_akademik", header2: "Non-akademik", group: "prestasi", width: 14 },
  { key: "jumlahPrestasi", header2: "Jumlah", group: "prestasi", width: 10, jumlahFill: "jumlahPrestasi" },

  { key: "tanggung_jawab", header1: "Perkembangan Karakter", header2: "Tanggung Jawab", group: "karakter", width: 13 },
  { key: "disiplin", header2: "Disiplin", group: "karakter", width: 9 },
  { key: "kepedulian", header2: "Kepedulian", group: "karakter", width: 12 },
  { key: "kemandirian", header2: "Kemandirian", group: "karakter", width: 12 }, // Added kemandirian
  { key: "spiritual", header2: "Spiritual", group: "karakter", width: 9 },
  { key: "kejujuran", header2: "Kejujuran", group: "karakter", width: 12 },
  { key: "kepercayaan_diri", header2: "Kepercayaan Diri", group: "karakter", width: 15 },
  { key: "jumlahKarakter", header2: "Jumlah", group: "karakter", width: 10, jumlahFill: "jumlahKarakter" },

  { key: "organisasi", header1: "Keaktifan", header2: "Organisasi", group: "keaktifan", width: 10 },
  { key: "kepanitiaan", header2: "Kepanitiaan", group: "keaktifan", width: 11 },
  { key: "event", header2: "Event", group: "keaktifan", width: 8 },
  { key: "jumlahKeaktifan", header2: "Jumlah", group: "keaktifan", width: 10, jumlahFill: "jumlahKeaktifan" },

  { key: "pelanggaran_ringan", header1: "Pelanggaran", header2: "Ringan", group: "pelanggaran", width: 10 },
  { key: "pelanggaran_sedang", header2: "Sedang", group: "pelanggaran", width: 10 },
  { key: "pelanggaran_berat", header2: "Berat", group: "pelanggaran", width: 9 },
  { key: "jumlahPelanggaran", header2: "Jumlah", group: "pelanggaran", width: 10, jumlahFill: "jumlahPelanggaran" },

  { key: "totalIPT", header1: "Total IPT", merge: "v", width: 10, jumlahFill: "total" },
];

function buildRowValues(s) {
  const t = hitungTotal(s);
  return {
    no: s.no,
    nama: s.nama,
    nis: s.nis,
    kelas: s.kelas,
    grha: s.grha || "-",
    pointAwal: t.iptAwal, // ipt_awal siswa
    prestasi_akademik: Number(s.prestasi_akademik) ?? 0,
    prestasi_non_akademik: Number(s.prestasi_non_akademik) ?? 0,
    jumlahPrestasi: t.totalPrestasi,
    tanggung_jawab: Number(s.tanggung_jawab) ?? 0,
    disiplin: Number(s.disiplin) ?? 0,
    kepedulian: Number(s.kepedulian) ?? 0,
    kemandirian: Number(s.kemandirian) ?? 0, // Added kemandirian
    spiritual: Number(s.spiritual) ?? 0,
    kejujuran: Number(s.kejujuran) ?? 0,
    kepercayaan_diri: Number(s.kepercayaan_diri) ?? 0,
    jumlahKarakter: t.totalKarakter,
    organisasi: Number(s.organisasi) ?? 0,
    kepanitiaan: Number(s.kepanitiaan) ?? 0,
    event: Number(s.event) ?? 0,
    jumlahKeaktifan: t.totalKeaktifan,
    pelanggaran_ringan: Number(s.pelanggaran_ringan) ?? 0,
    pelanggaran_sedang: Number(s.pelanggaran_sedang) ?? 0,
    pelanggaran_berat: Number(s.pelanggaran_berat) ?? 0,
    jumlahPelanggaran: t.totalPelanggaran,
    totalIPT: t.iptTotal,
  };
}

// Leger Excel "Laporan IPT per Kelas" (landscape, fit-to-page).
// Diekstrak dari generateExcelBlob agar bisa diuji langsung.
// Kop memakai gambar yang sama dengan raport individual (header.png),
// dicetak selebar min. 490px / setinggi 128px di baris 1-5.
export async function createClassIptExcelBuffer({ classStudents = [], schoolName, selectedClass, kopImage = null }) {
  const minIpt = await fetchMinIptPerGrade();
  // Prepare student data in the format expected by the Excel generator
  const formattedStudents = classStudents.map((student, index) => {
    const points = student.points || {};
    return {
      no: index + 1,
      nama: student.nama || '-',
      nis: student.nis || '-',
      kelas: student.kelas || '-',
      grha: student.grha || '-',
      // Use snake_case to match backend API directly
      prestasi: Number(points.prestasi) || 0,
      prestasi_akademik: Number(points.prestasi_akademik) || 0,
      prestasi_non_akademik: Number(points.prestasi_non_akademik) || 0,
      tanggung_jawab: Number(points.tanggung_jawab) || 0,
      disiplin: Number(points.disiplin) || 0,
      kepedulian: Number(points.kepedulian) || 0,
      kemandirian: Number(points.kemandirian) || 0,
      spiritual: Number(points.spiritual) || 0,
      kejujuran: Number(points.kejujuran) || 0,
      kepercayaan_diri: Number(points.kepercayaan_diri) || 0,
      organisasi: Number(points.organisasi) || 0,
      kepanitiaan: Number(points.kepanitiaan) || 0,
      event: Number(points.event) || 0,
      pelanggaran_ringan: Number(points.pelanggaran_ringan) || 0,
      pelanggaran_sedang: Number(points.pelanggaran_sedang) || 0,
      pelanggaran_berat: Number(points.pelanggaran_berat) || 0,
      pelanggaran_lainnya: Number(points.pelanggaran_lainnya) || 0,
      ipt_awal: Number(points.point_awal) || Number(student.ipt_awal) || 80,
    };
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Laporan IPT", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
  });
  sheet.properties.defaultRowHeight = 20;

  const totalCols = COLUMN_DEFS.length;
  const tahunPelajaran = `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`;

  // Kop (baris 1-10 dikosongkan untuk gambar: 2x raport individual,
  // maks 980x256px agar proporsional dengan tabel landscape).
  // Berbeda dengan raport individual yang sempit, leger landscape jauh lebih
  // lebar dari gambar kop gambar di-center di atas tabel. ExcelJS
  // mendukung anchor kolom fraksional (lihat anchor.js: nativeCol +
  // nativeColOff), jadi offset kiri dihitung dalam satuan lebar kolom.
  if (kopImage) {
    const imageId = workbook.addImage({ base64: kopImage.base64, extension: kopImage.extension || 'png' });
    const dims = kopImage.dims || { w: 480, h: 130 };
    const scale = Math.min(980 / dims.w, 256 / dims.h, 1);
    const imgW = Math.round(dims.w * scale);
    const imgH = Math.round(dims.h * scale);
    const PX_PER_UNIT = 7; // aproksimasi Excel untuk Calibri 11
    const totalUnits = COLUMN_DEFS.reduce((a, d) => a + d.width, 0);
    const startUnits = Math.max(0, (totalUnits - imgW / PX_PER_UNIT) / 2);
    let accUnits = 0;
    let startCol = 0;
    while (startCol < totalCols && accUnits + COLUMN_DEFS[startCol].width <= startUnits) {
      accUnits += COLUMN_DEFS[startCol].width;
      startCol += 1;
    }
    const frac = COLUMN_DEFS[startCol] ? (startUnits - accUnits) / COLUMN_DEFS[startCol].width : 0;
    sheet.addImage(imageId, {
      tl: { col: startCol + frac, row: 0 },
      ext: { width: imgW, height: imgH },
    });
  }

  // ---- Judul di bawah kop (kop setinggi ±256px ≈ 10 baris @20pt) ----
  sheet.mergeCells(11, 1, 11, totalCols);
  sheet.getCell(11, 1).value = "LAPORAN IPT PER KELAS";
  sheet.getCell(11, 1).font = { bold: true, size: 13 };
  sheet.getCell(11, 1).alignment = { horizontal: "center" };

  sheet.mergeCells(12, 1, 12, totalCols);
  sheet.getCell(12, 1).value = schoolName || "SMK NEGERI BALI MANDARA";
  sheet.getCell(12, 1).font = { bold: true };
  sheet.getCell(12, 1).alignment = { horizontal: "center" };

  sheet.mergeCells(13, 1, 13, totalCols);
  sheet.getCell(13, 1).value = `TAHUN PELAJARAN ${tahunPelajaran}`;
  sheet.getCell(13, 1).font = { bold: true };
  sheet.getCell(13, 1).alignment = { horizontal: "center" };

  sheet.mergeCells(15, 1, 15, totalCols);
  sheet.getCell(15, 1).value = `Kelas: ${selectedClass}`;
  sheet.getCell(15, 1).font = { bold: true };

  // Baris 16 dikosongkan sebagai jarak
  const HEAD_ROW_1 = 17; // baris grup
  const HEAD_ROW_2 = 18; // baris sub-header
  const DATA_START_ROW = 19;

  // ---- Set lebar kolom ----
  COLUMN_DEFS.forEach((def, i) => {
    sheet.getColumn(i + 1).width = def.width;
  });

  // ---- Set tinggi baris header supaya teks tidak kepotong ----
  sheet.getRow(HEAD_ROW_1).height = 22;
  sheet.getRow(HEAD_ROW_2).height = 38;

  // ---- Tulis header baris 1 & 2, sekaligus merge sesuai grup/rowspan ----
  let colCursor = 1;
  while (colCursor <= totalCols) {
    const def = COLUMN_DEFS[colCursor - 1];

    if (def.merge === "v") {
      // Kolom rowspan 2
      sheet.mergeCells(HEAD_ROW_1, colCursor, HEAD_ROW_2, colCursor);
      const cell = sheet.getCell(HEAD_ROW_1, colCursor);
      cell.value = def.header1;
      styleCell(cell, { fill: def.jumlahFill ? EXCEL_COLORS[def.jumlahFill] : EXCEL_COLORS.headerAbu, bold: true });

      // style cell kedua juga (walau sudah merge) supaya border-nya konsisten
      styleCell(sheet.getCell(HEAD_ROW_2, colCursor), { fill: def.jumlahFill ? EXCEL_COLORS[def.jumlahFill] : EXCEL_COLORS.headerAbu, bold: true });

      colCursor += 1;
      continue;
    }

    if (def.group) {
      // Hitung berapa banyak kolom berturutan dengan group yang sama
      let span = 1;
      while (
        colCursor + span <= totalCols &&
        COLUMN_DEFS[colCursor + span - 1] &&
        COLUMN_DEFS[colCursor + span - 1].group === def.group
      ) {
        span += 1;
      }

      if (span > 1) {
        sheet.mergeCells(HEAD_ROW_1, colCursor, HEAD_ROW_1, colCursor + span - 1);
      }

      // PENTING: style SEMUA cell dalam rentang merge, bukan cuma cell pertama,
      // supaya border tidak bolong di tengah setelah merge
      for (let k = 0; k < span; k++) {
        const groupCell = sheet.getCell(HEAD_ROW_1, colCursor + k);
        if (k === 0) groupCell.value = def.header1;
        styleCell(groupCell, { fill: EXCEL_COLORS[def.group], bold: true });
      }

      for (let k = 0; k < span; k++) {
        const subDef = COLUMN_DEFS[colCursor - 1 + k];
        const subCell = sheet.getCell(HEAD_ROW_2, colCursor + k);
        subCell.value = subDef.header2;
        styleCell(subCell, { fill: EXCEL_COLORS[subDef.group], bold: true });
      }

      colCursor += span;
      continue;
    }

    colCursor += 1;
  }

  // ---- Tulis baris data siswa ----
  formattedStudents.forEach((s, idx) => {
    const rowNum = DATA_START_ROW + idx;
    const values = buildRowValues(s);

    COLUMN_DEFS.forEach((def, colIdx) => {
      const cell = sheet.getCell(rowNum, colIdx + 1);
      cell.value = values[def.key];

      const isNegative = typeof values[def.key] === "number" && values[def.key] < 0;
      const isBelowMin = def.key === "totalIPT" && isBelowMinIpt(values[def.key], minIptFor(minIpt, s.kelas));

      styleCell(cell, {
        fill: def.jumlahFill ? EXCEL_COLORS[def.jumlahFill] : undefined,
        bold: !!def.jumlahFill,
        align: def.align || "center",
        color: isNegative || isBelowMin ? "FFC00000" : undefined,
      });
    });
  });

  // ---- Freeze panes supaya header tetap kelihatan saat scroll ----
  sheet.views = [{ state: "frozen", ySplit: HEAD_ROW_2 }];

  // ---- Proteksi tulis: dokumen resmi seluruh sel terkunci,
  // pengguna hanya boleh menyeleksi (lihat/salin). Password sama
  // dengan kartu individual (lihat IPT_SHEET_PASSWORD).
  await sheet.protect(IPT_SHEET_PASSWORD, { selectLockedCells: true, selectUnlockedCells: true });

  return workbook.xlsx.writeBuffer();
}

function LaporanCetak({ user }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [excelLoading, setExcelLoading] = useState(false);
  const [reportType, setReportType] = useState('individual'); // 'individual' or 'class'
  const [classStudents, setClassStudents] = useState([]);
  const [isWaliKelas, setIsWaliKelas] = useState(false);
  const [waliKelasInfo, setWaliKelasInfo] = useState(null);
  const [schoolConfig, setSchoolConfig] = useState(null);
  // Semester & tahun pelajaran untuk cetakan IPT individual
  const currentYear = new Date().getFullYear();
  const [semester, setSemester] = useState('Ganjil');
  const [tahunPelajaran, setTahunPelajaran] = useState(`${currentYear}/${currentYear + 1}`);
  const tahunOptions = [];
  for (let y = currentYear - 5; y <= currentYear + 1; y++) {
    tahunOptions.push(`${y}/${y + 1}`);
  }
  
  useEffect(() => {
    checkWaliKelasStatus();
    fetchStudents();
    fetchSchoolConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkWaliKelasStatus = async () => {
    if (user?.role === 'guru' || user?.role === 'pegawai') {
      try {
        const response = await api.get('/wali-kelas/my-class');
        setIsWaliKelas(true);
        setWaliKelasInfo(response.data);
        setSelectedClass(response.data.kelas);
      } catch (error) {
        setIsWaliKelas(false);
      }
    }
  };

  useEffect(() => {
    setSelectedStudentId('');
    setClassStudents([]);
  }, [selectedClass]);

  useEffect(() => {
    if (selectedClass && reportType === 'class') {
      fetchClassStudents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType, selectedClass]);

  const fetchStudents = async () => {
    try {
      let response;
      
      if (isWaliKelas && waliKelasInfo) {
        // For wali kelas, fetch only their class students
        response = await api.get(`/reports/class-ipt/${waliKelasInfo.kelas}`);
        setStudents(response.data);
        setClasses([waliKelasInfo.kelas]); // Only show their class
      } else {
        // For superadmin, fetch all students
        response = await api.get('/reports/students');
        setStudents(response.data);

        // Get unique classes from calculated classes
        const uniqueClasses = [...new Set(response.data.map(s => s.kelas).filter(Boolean))];
        setClasses(uniqueClasses.sort());
      }
    } catch (error) {
      console.error('Error fetching students:', error);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredStudents = () => {
    if (!selectedClass) return students;
    return students.filter(s => s.kelas === selectedClass);
  };

  const fetchIptCard = async (userId) => {
    // Teruskan semester & tahun pelajaran agar breakdown (dan total) hanya
    // mencakup point sampai periode terpilih (cutoff di backend).
    const response = await api.get(
      `/reports/ipt-card/${userId}?semester=${encodeURIComponent(semester)}&tahun_pelajaran=${encodeURIComponent(tahunPelajaran)}`
    );
    return response.data;
  };

  const fetchClassStudents = async () => {
    try {
      const response = await api.get(`/reports/class-ipt/${selectedClass}`);
      setClassStudents(response.data);
    } catch (error) {
      console.error('Error fetching class students:', error);
    }
  };

  const fetchSchoolConfig = async () => {
    try {
      const response = await api.get('/school-config');
      setSchoolConfig(response.data);
    } catch (error) {
      console.error('Error fetching school config:', error);
      // Use default values if fetch fails
      setSchoolConfig({
        school_name: 'SMK Negeri Bali Mandara',
        school_description: 'Mandara Talenta (Manajemen dan Pengembangan Karakter Talenta) • Panel Admin',
        principal_name: 'Nama Kepala Sekolah',
        principal_nip: '',
        logo_url: null
      });
    }
  };

  const generateExcelBlob = async () => {
    // Refresh school config to get latest data
    await fetchSchoolConfig();

    if (reportType === 'individual') {
      // For individual report, we'll handle separately if needed
      return null;
    } else if (reportType === 'class') {
      // Leger kelas (lihat createClassIptExcelBuffer): kop + judul + tabel.
      try {
        const kopImage = await fetchKopImage(['/header.png']);
        const buffer = await createClassIptExcelBuffer({
          classStudents,
          schoolName: schoolConfig?.school_name || "SMK NEGERI BALI MANDARA",
          selectedClass,
          kopImage,
        });
        return buffer;
      } catch (error) {
        console.error('Error generating Excel:', error);
        return null;
      }
    }
    return null;
  };

  // Config sekolah terbaru untuk kop Excel (jangan pakai state yg bisa basi)
  const getFreshSchoolConfig = async () => {
    try {
      const res = await api.get('/school-config');
      return res.data;
    } catch {
      return schoolConfig || {};
    }
  };

  // Download Excel Individual Point Talent (layout Raport IPT resmi sekolah)
  const handleDownloadIndividualExcel = async () => {
    if (!selectedStudentId) {
      alert('Pilih siswa terlebih dahulu');
      return;
    }
    try {
      setExcelLoading(true);
      const cardData = await fetchIptCard(selectedStudentId);
      const school = await getFreshSchoolConfig();
      const kopImage = await fetchKopImage(['/header.png']);
      const minIpt = await fetchMinIptPerGrade();
      const buffer = await createIndividualIptExcelBuffer({
        student: cardData.student,
        wali: cardData.wali,
        points: cardData.points,
        iptTotal: cardData.ipt_total,
        school,
        semester,
        tahunPelajaran,
        kopImage,
        minIpt: minIptFor(minIpt, cardData.student?.kelas),
      });
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a');
      link.href = url;
      const safeName = String(cardData.student?.nama || 'SISWA').replace(/[\\/:*?"<>|]/g, '_');
      link.download = `IPT_${safeName}_${cardData.student?.nis || ''}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Gagal membuat Excel');
    } finally {
      setExcelLoading(false);
    }
  };

  const handleDownloadExcel = async () => {
    const filename = `Laporan_IPT_Kelas_${selectedClass || 'SEMUA'}.xlsx`;

    try {
      setExcelLoading(true);
      const blob = await generateExcelBlob();
      if (blob) {
        const url = URL.createObjectURL(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        alert('Gagal membuat Excel');
      }
    } catch (e) {
      console.error(e);
      alert('Gagal membuat Excel');
    } finally {
      setExcelLoading(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  const filteredStudents = getFilteredStudents();

  return (
    <div className="container" style={{ padding: '20px' }}>
      <h2 className="ipt-print-no-print laporan-cetak-title" style={{ marginBottom: '20px' }}>
        {isWaliKelas ? `Laporan & Cetak - Wali Kelas ${waliKelasInfo?.kelas}` : 'Laporan & Cetak'}
      </h2>

      {isWaliKelas && (
        <div className="alert alert-info ipt-print-no-print" style={{ marginBottom: '20px' }}>
          <strong>Mode Wali Kelas:</strong> Anda hanya dapat melihat dan mencetak laporan untuk kelas {waliKelasInfo?.kelas} dengan {waliKelasInfo?.totalSiswa} siswa.
        </div>
      )}

      <div className="ipt-print-no-print" style={{ marginBottom: '20px' }}>
        <label style={{ marginRight: '10px' }}>Filter Kelas:</label>
        <select
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
          disabled={isWaliKelas} // Disable for wali kelas
          style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ddd', minWidth: '200px', backgroundColor: isWaliKelas ? '#f0f0f0' : 'white' }}
        >
          {isWaliKelas ? (
            <option value={waliKelasInfo?.kelas}>{waliKelasInfo?.kelas}</option>
          ) : (
            <>
              <option value="">Semua Kelas</option>
              {classes.map(cls => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </>
          )}
        </select>
      </div>

      <div className="ipt-print-no-print" style={{ marginBottom: '24px', backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h3 style={{ marginBottom: '12px' }}>Cetak Laporan IPT</h3>
        <p style={{ marginBottom: '14px', color: 'var(--text-secondary)', fontSize: '14px' }}>
          Pilih jenis laporan yang ingin dicetak.
        </p>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ marginRight: '10px', fontWeight: 'bold' }}>Jenis Laporan:</label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ddd', minWidth: '200px' }}
          >
            <option value="individual">Individual Point Talent (IPT)</option>
            <option value="class">Laporan IPT Per Kelas</option>
          </select>
        </div>

        {reportType === 'individual' ? (
          <>
            <p style={{ marginBottom: '14px', color: 'var(--text-secondary)', fontSize: '14px' }}>
              Format cetak mengikuti lembar IPT resmi sekolah (satu siswa per halaman A4).
              Hanya point yang tercatat sampai Semester {semester} TP {tahunPelajaran} yang dihitung.
            </p>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <div>
                <label htmlFor="ipt-semester-select" style={{ marginRight: '8px', fontWeight: 'bold' }}>Semester:</label>
                <select
                  id="ipt-semester-select"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ddd', minWidth: '120px' }}
                >
                  <option value="Ganjil">Ganjil</option>
                  <option value="Genap">Genap</option>
                </select>
              </div>
              <div>
                <label htmlFor="ipt-tahun-select" style={{ marginRight: '8px', fontWeight: 'bold' }}>Tahun Pelajaran:</label>
                <select
                  id="ipt-tahun-select"
                  value={tahunPelajaran}
                  onChange={(e) => setTahunPelajaran(e.target.value)}
                  style={{ padding: '8px', borderRadius: '5px', border: '1px solid #ddd', minWidth: '140px' }}
                >
                  {tahunOptions.map(tp => (
                    <option key={tp} value={tp}>{tp}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="ipt-print-toolbar">
              <div>
                <label htmlFor="ipt-student-select">Siswa:</label>
                <select
                  id="ipt-student-select"
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  disabled={!selectedClass}
                >
                  <option value="" disabled hidden>{selectedClass ? '- Pilih siswa -' : '- Pilih kelas dulu -'}</option>
                  {filteredStudents.map(s => (
                    <option key={s.id} value={s.id}>{s.nama} ({s.nis})</option>
                  ))}
                </select>
              </div>
              <button type="button" onClick={handleDownloadIndividualExcel} disabled={(!selectedStudentId) || excelLoading} className="btn btn-success">
                {excelLoading ? 'Membuat Excel...' : 'Download Excel'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginBottom: '14px', color: 'var(--text-secondary)', fontSize: '14px' }}>
              Format cetak menampilkan Leger IPT Individual Point Talent dengan format tabel lengkap termasuk NIS, Nama, Kelas, Grha, breakdown IPT (Prestasi, Perkembangan Karakter, Keaktifan, Pelanggaran), dan Total IPT dalam format landscape yang rapi dan profesional.
            </p>

            <div className="ipt-print-toolbar">
              <div>
                <span style={{ marginRight: '10px' }}>
                  {selectedClass ? `${classStudents.length} siswa di kelas ${selectedClass}` : 'Pilih kelas terlebih dahulu'}
                </span>
              </div>
              <button type="button" onClick={handleDownloadExcel} disabled={(!selectedClass) || excelLoading} className="btn btn-success">
                {excelLoading ? 'Membuat Excel...' : 'Download Excel'}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  );
}

export default LaporanCetak;
