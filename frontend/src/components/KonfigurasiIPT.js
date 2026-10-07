import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { formatDisplayText } from '../utils/formatDisplayText';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { getRowField } from '../utils/excelImport';
import { styleImportTemplateSheet } from '../utils/excelTemplate';
import { Plus, Download, Pencil, Trash2, TriangleAlert, CircleCheck, CircleX, Settings, RefreshCw } from 'lucide-react';
import { CATEGORY_ICONS } from './icons';

function KonfigurasiIPT() {
  const [configs, setConfigs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeCategory, setActiveCategory] = useState('prestasi');
  const [editingConfig, setEditingConfig] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [pelanggaranSection, setPelanggaranSection] = useState('severity');
  const [pelanggaranAddType, setPelanggaranAddType] = useState('severity');
  const [message, setMessage] = useState('');
  const [userRole, setUserRole] = useState('');
  const [organisasiOptions, setOrganisasiOptions] = useState([]);
  const [organisasiName, setOrganisasiName] = useState('');
  const [perilakuRatings, setPerilakuRatings] = useState([]);
  const [perilakuRatingName, setPerilakuRatingName] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [excelFile, setExcelFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState([]);
  const [minIptValues, setMinIptValues] = useState({ X: '0', XI: '0', XII: '0' });
  const [minIptSaving, setMinIptSaving] = useState(false);
  const [iptAwalValues, setIptAwalValues] = useState({ X: '80', XI: '80', XII: '80' });
  const [iptAwalCounts, setIptAwalCounts] = useState({ X: 0, XI: 0, XII: 0 });
  const [iptAwalSaving, setIptAwalSaving] = useState(false);

  const categories = [
    { key: 'prestasi', label: 'Prestasi', icon: CATEGORY_ICONS.prestasi },
    { key: 'organisasi', label: 'Organisasi', icon: CATEGORY_ICONS.organisasi },
    { key: 'kepanitiaan', label: 'Kepanitiaan', icon: CATEGORY_ICONS.kepanitiaan },
    { key: 'event', label: 'Event', icon: CATEGORY_ICONS.event },
    { key: 'pelanggaran', label: 'Pelanggaran', icon: CATEGORY_ICONS.pelanggaran },
    { key: 'perilaku', label: 'Perilaku', icon: CATEGORY_ICONS.perilaku }
  ];

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserRole(user.role || '');
    fetchConfigs();
    fetchOrganisasiOptions();
    fetchPerilakuRatings();
    fetchMinIptConfig();
    fetchIptAwalConfig();
  }, []);

  const fetchOrganisasiOptions = async () => {
    try {
      const response = await api.get('/ipt-config/organisasi-options');
      setOrganisasiOptions(response.data);
    } catch (error) {
      console.error('Error fetching organisasi options:', error);
      setMessage('Gagal memuat daftar organisasi');
    }
  };

  const fetchPerilakuRatings = async () => {
    try {
      const response = await api.get('/ipt-config/perilaku-ratings');
      if (!Array.isArray(response.data)) {
        throw new Error('Invalid perilaku rating response');
      }
      setPerilakuRatings(response.data);
    } catch (error) {
      console.error('Error fetching perilaku ratings:', error);
      setMessage('Gagal memuat daftar tingkat penilaian');
    }
  };

  const addPerilakuRating = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      await api.post('/ipt-config/perilaku-ratings', { name: perilakuRatingName });
      setPerilakuRatingName('');
      setMessage('Tingkat penilaian berhasil ditambahkan!');
      await fetchPerilakuRatings();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menambahkan tingkat penilaian');
    } finally {
      setSaving(false);
    }
  };

  const deletePerilakuRating = async (rating) => {
    if (!window.confirm(`Hapus tingkat penilaian ${rating.name}?`)) return;
    try {
      await api.delete(`/ipt-config/perilaku-ratings/${rating.id}`);
      setMessage('Tingkat penilaian berhasil dihapus!');
      fetchPerilakuRatings();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus tingkat penilaian');
    }
  };

  const addOrganisasiOption = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      await api.post('/ipt-config/organisasi-options', { name: organisasiName });
      setOrganisasiName('');
      setMessage('Organisasi berhasil ditambahkan!');
      fetchOrganisasiOptions();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menambahkan organisasi');
    } finally {
      setSaving(false);
    }
  };

  const deleteOrganisasiOption = async (option) => {
    if (!window.confirm(`Hapus organisasi ${option.name}?`)) return;
    try {
      await api.delete(`/ipt-config/organisasi-options/${option.id}`);
      setMessage('Organisasi berhasil dihapus!');
      fetchOrganisasiOptions();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus organisasi');
    }
  };

  const fetchMinIptConfig = async () => {
    try {
      const response = await api.get('/ipt-config/min-ipt-per-grade');
      const data = response.data || {};
      setMinIptValues({
        X: String(data.X ?? 0),
        XI: String(data.XI ?? 0),
        XII: String(data.XII ?? 0)
      });
    } catch (error) {
      console.error('Error fetching min IPT config:', error);
    }
  };

  const saveMinIptConfig = async () => {
    const parsed = {};
    for (const grade of ['X', 'XI', 'XII']) {
      const trimmed = String(minIptValues[grade]).trim();
      const value = Number(trimmed);
      if (trimmed === '' || !Number.isInteger(value) || value < 0) {
        setMessage(`Batas minimum Kelas ${grade} harus bilangan bulat 0 atau lebih (0 = nonaktif)`);
        return;
      }
      parsed[grade] = value;
    }
    try {
      setMinIptSaving(true);
      await api.put('/ipt-config/min-ipt-per-grade', parsed);
      setMessage('Batas minimum Total IPT berhasil disimpan!');
      setMinIptValues({ X: String(parsed.X), XI: String(parsed.XI), XII: String(parsed.XII) });
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menyimpan batas minimum IPT');
    } finally {
      setMinIptSaving(false);
    }
  };

  const fetchIptAwalConfig = async () => {
    try {
      const [defaultsRes, countsRes] = await Promise.all([
        api.get('/ipt-config/ipt-awal-per-grade'),
        api.get('/users/counts-by-grade')
      ]);
      const defaults = defaultsRes.data || {};
      setIptAwalValues({
        X: String(defaults.X ?? 80),
        XI: String(defaults.XI ?? 80),
        XII: String(defaults.XII ?? 80)
      });
      setIptAwalCounts({
        X: countsRes.data?.X ?? 0,
        XI: countsRes.data?.XI ?? 0,
        XII: countsRes.data?.XII ?? 0
      });
    } catch (error) {
      console.error('Error fetching IPT awal config:', error);
    }
  };

  const saveIptAwalConfig = async () => {
    const parsed = {};
    for (const grade of ['X', 'XI', 'XII']) {
      const value = parseInt(iptAwalValues[grade], 10);
      if (Number.isNaN(value) || value < 0) {
        setMessage(`IPT awal Kelas ${grade} harus angka valid (min 0)`);
        return;
      }
      parsed[grade] = value;
    }
    try {
      setIptAwalSaving(true);
      // 1. Store grade defaults (used for newly created students)
      await api.put('/ipt-config/ipt-awal-per-grade', parsed);
      // 2. Apply to ALL current students server-side (grade buckets resolved
      //    from every siswa row never from a paginated frontend list)
      const { data } = await api.post('/users/bulk-update-ipt-awal', { grades: parsed });
      const parts = ['X', 'XI', 'XII'].map(
        (grade) => `Kelas ${grade} (${data?.applied?.[grade]?.updated ?? 0} siswa)`
      );
      setMessage(`IPT awal berhasil disimpan dan diterapkan: ${parts.join(', ')}!`);
      fetchIptAwalConfig();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menyimpan IPT awal');
    } finally {
      setIptAwalSaving(false);
    }
  };

  const fetchConfigs = async () => {
    try {
      setLoading(true);
      const response = await api.get('/ipt-config/all');
      setConfigs(response.data);
    } catch (error) {
      console.error('Error fetching IPT configurations:', error);
      setMessage('Gagal memuat konfigurasi IPT');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateConfig = async (configId, updatedData) => {
    try {
      setSaving(true);
      await api.put(`/ipt-config/${configId}`, updatedData);
      setMessage('Konfigurasi berhasil diperbarui!');
      setShowEditModal(false);
      setEditingConfig(null);
      fetchConfigs();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal memperbarui konfigurasi');
    } finally {
      setSaving(false);
    }
  };

  const handleAddConfig = async (newData) => {
    try {
      setSaving(true);
      await api.post('/ipt-config', newData);
      setMessage('Konfigurasi berhasil ditambahkan!');
      setShowAddModal(false);
      fetchConfigs();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menambahkan konfigurasi');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteConfig = async (configId) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus konfigurasi ini?')) return;

    try {
      await api.delete(`/ipt-config/${configId}`);
      setMessage('Konfigurasi berhasil dihapus!');
      fetchConfigs();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus konfigurasi');
    }
  };

  const handleToggleActive = async (configId, currentStatus) => {
    try {
      await api.put(`/ipt-config/${configId}`, { is_active: !currentStatus });
      setMessage(`Konfigurasi berhasil ${!currentStatus ? 'diaktifkan' : 'dinonaktifkan'}!`);
      fetchConfigs();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengubah status konfigurasi');
    }
  };

  const handleDeleteAll = async () => {
    const categoryLabel = categories.find(c => c.key === activeCategory)?.label || activeCategory;
    if (!window.confirm(`Apakah Anda yakin ingin menghapus SEMUA konfigurasi ${categoryLabel}? Tindakan ini tidak dapat dibatalkan.`)) return;

    try {
      setSaving(true);
      await api.delete(`/ipt-config/all/${activeCategory}`);
      setMessage(`Semua konfigurasi ${categoryLabel} berhasil dihapus!`);
      fetchConfigs();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus konfigurasi');
    } finally {
      setSaving(false);
    }
  };

  const openEditModal = (config) => {
    setEditingConfig(config);
    setShowEditModal(true);
  };

  const handleExcelFileChange = (e) => {
    setExcelFile(e.target.files[0]);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setExcelFile(null);
    setImportResults([]);
  };

  const downloadDetailTemplate = async () => {
    const levelNames = configuredPelanggaranLevels.map(level => level.field1);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Template');
    worksheet.columns = [
      { header: 'No', key: 'No', width: 6 },
      { header: 'Detail', key: 'Detail', width: 35 },
      { header: 'TingkatPelanggaran', key: 'TingkatPelanggaran', width: 22 }
    ];

    if (levelNames.length) {
      worksheet.dataValidations.add('C2:C1000', {
        type: 'list',
        allowBlank: false,
        formulae: [`"${levelNames.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Tingkat Pelanggaran tidak valid',
        error: `Pilih salah satu: ${levelNames.join(', ')}`
      });
    }

    await styleImportTemplateSheet(worksheet, {
      headerNotes: {
        Detail: 'Nama detail/jenis pelanggaran, contoh: Terlambat masuk sekolah.',
        TingkatPelanggaran: 'Pilih tingkat yang sudah terdaftar (Ringan/Sedang/Berat atau sesuai konfigurasi).'
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blobUrl = URL.createObjectURL(new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'template_detail_pelanggaran.xlsx';
    link.click();
    URL.revokeObjectURL(blobUrl);
  };

  const handleDetailExcelImport = async () => {
    if (!excelFile) {
      setMessage('Pilih file Excel terlebih dahulu');
      return;
    }

    const activeLevels = configuredPelanggaranLevels;
    if (!activeLevels.length) {
      setMessage('Gagal import: belum ada Tingkat Pelanggaran aktif. Buat dulu di tab "Tingkat Pelanggaran & Point"');
      return;
    }

    setImporting(true);
    setImportResults([]);
    const results = [];

    try {
      const data = await excelFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      const existingDetails = pelanggaranDetailConfigs.map(config => String(config.field1).toLowerCase());
      const levelNames = activeLevels.map(level => level.field1).join(', ');

      for (const row of jsonData) {
        const detail = getRowField(row, 'Detail', 'detail', 'Detail Pelanggaran', 'DetailPelanggaran', 'Nama', 'nama', 'field1');
        const tingkatRaw = getRowField(row, 'TingkatPelanggaran', 'tingkatpelanggaran', 'Tingkat Pelanggaran', 'Tingkat', 'tingkat', 'Level', 'level', 'field2');

        // Lewati baris kosong / header
        if (!detail && !tingkatRaw) {
          continue;
        }
        if (!detail) {
          results.push({ status: 'error', name: '(tanpa nama)', level: tingkatRaw, error: 'Detail pelanggaran kosong' });
          continue;
        }
        if (!tingkatRaw) {
          results.push({ status: 'error', name: detail, level: '-', error: 'Tingkat pelanggaran kosong' });
          continue;
        }

        const level = activeLevels.find(l => String(l.field1).toLowerCase() === tingkatRaw.toLowerCase());
        if (!level) {
          results.push({
            status: 'error',
            name: detail,
            level: tingkatRaw,
            error: `Tingkat "${tingkatRaw}" tidak ditemukan. Pilih: ${levelNames}`
          });
          continue;
        }

        if (existingDetails.includes(detail.toLowerCase())) {
          results.push({ status: 'error', name: detail, level: level.field1, error: 'Detail sudah ada di daftar' });
          continue;
        }

        try {
          await api.post('/ipt-config', {
            category: 'pelanggaran',
            field1: detail,
            field2: level.field1,
            point_value: 0,
            description: null,
            is_active: true
          });
          existingDetails.push(detail.toLowerCase());
          results.push({ status: 'success', name: detail, level: level.field1 });
        } catch (error) {
          results.push({
            status: 'error',
            name: detail,
            level: level.field1,
            error: error.response?.data?.message || error.message
          });
        }
      }

      setImportResults(results);
      const ok = results.filter(r => r.status === 'success').length;
      const fail = results.filter(r => r.status === 'error').length;
      if (!results.length) {
        setMessage('Tidak ada baris data untuk diimport');
      } else if (ok === 0 && fail > 0) {
        setMessage(`Gagal import semua baris (${fail} error)`);
      } else {
        setMessage(`Import selesai: ${ok} berhasil, ${fail} gagal`);
      }
      if (ok > 0) {
        fetchConfigs();
      }
    } catch (error) {
      setMessage('Gagal membaca file Excel: ' + error.message);
    } finally {
      setImporting(false);
      setExcelFile(null);
    }
  };

  const categoryConfigs = configs.filter(c => c.category === activeCategory);
  const configuredPelanggaranLevels = configs.filter(c => c.category === 'pelanggaran' && !c.field2 && c.is_active);
  // Opsi tingkat untuk edit detail: semua tingkat aktif + tingkat saat ini (jika non-aktif/terhapus)
  const editTingkatOptions = [...configuredPelanggaranLevels];
  if (activeCategory === 'pelanggaran' && editingConfig?.field2 &&
      !editTingkatOptions.some(level => level.field1 === editingConfig.field2)) {
    const currentLevel = configs.find(c => c.category === 'pelanggaran' && !c.field2 && c.field1 === editingConfig.field2);
    editTingkatOptions.push(currentLevel || {
      id: `current-${editingConfig.field2}`,
      field1: editingConfig.field2,
      point_value: editingConfig.point_value,
      is_active: false
    });
  }
  const pelanggaranSeverityConfigs = categoryConfigs.filter(c => !c.field2);
  const pelanggaranDetailConfigs = categoryConfigs.filter(c => Boolean(c.field2));
  const displayedConfigs = activeCategory === 'pelanggaran'
    ? (pelanggaranSection === 'severity' ? pelanggaranSeverityConfigs : pelanggaranDetailConfigs)
    : categoryConfigs;
  const getDisplayPoint = (config) => {
    if (activeCategory === 'pelanggaran' && config.field2) {
      return categoryConfigs.find(level => !level.field2 && level.field1 === config.field2)?.point_value ?? 0;
    }
    return config.point_value ?? 0;
  };

  const getHeaderLabel1 = (category) => {
    const labels = {
      prestasi: 'Tingkat Lomba',
      organisasi: 'Nama Organisasi',
      kepanitiaan: 'Jabatan',
      event: 'Tingkat Event',
      pelanggaran: 'Tingkat Pelanggaran',
      perilaku: 'Tingkat Penilaian'
    };
    return labels[category] || 'Field 1';
  };

  const getHeaderLabel2 = (category) => {
    const labels = {
      prestasi: 'Juara Lomba',
      organisasi: 'Jabatan',
      kepanitiaan: '',
      event: '',
      pelanggaran: '',
      perilaku: ''
    };
    return labels[category] || 'Field 2';
  };

  const FIXED_TINGKAT_OPTIONS = [
    'sekolah',
    'kecamatan',
    'kabupaten',
    'provinsi',
    'nasional',
    'internasional'
  ];

  const FIXED_JUARA_LOMBA_OPTIONS = [
    'peserta',
    'finalis',
    'harapan_iii',
    'harapan_ii',
    'harapan_i',
    'juara_iii',
    'juara_ii',
    'juara_i'
  ];

  const showAddField2 = ['prestasi', 'organisasi'].includes(activeCategory) ||
    (activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail');
  const showTableField2 = !['kepanitiaan', 'event'].includes(activeCategory) &&
    !(activeCategory === 'pelanggaran' && pelanggaranSection === 'severity') &&
    activeCategory !== 'perilaku';
  const showEditField2 = ['prestasi', 'organisasi'].includes(activeCategory) ||
    (activeCategory === 'pelanggaran' && Boolean(editingConfig?.field2));

  // Display formatting for enum-style config values.
  // Only applied to fixed-vocabulary columns (prestasi tingkat/juara, event tingkat);
  // free-text columns (organisasi names, pelanggaran details, descriptions) stay raw
  // so values like "OSIS" are never mangled.
  const formatConfigField = (config, key) => {
    const value = config[key];
    if (!value) return 'Tidak ada';
    if (activeCategory === 'prestasi' && (key === 'field1' || key === 'field2')) {
      return formatDisplayText(value);
    }
    if (activeCategory === 'event' && key === 'field1') {
      return formatDisplayText(value);
    }
    return value;
  };

  const tableFields = [
    { key: 'field1', label: activeCategory === 'pelanggaran' ? (pelanggaranSection === 'severity' ? 'Tingkat Pelanggaran' : 'Detail Pelanggaran') : getHeaderLabel1(activeCategory) },
    { key: 'field2', label: showTableField2 ? (activeCategory === 'pelanggaran' && pelanggaranSection === 'detail' ? 'Tingkat Pelanggaran' : getHeaderLabel2(activeCategory)) : '' }
  ].filter(field => field.label);
  const showDescription = !(activeCategory === 'pelanggaran' && pelanggaranSection === 'detail');

  if (userRole !== 'superadmin') {
    return (
      <div className="card">
        <h2>Akses Ditolak</h2>
        <p>Halaman ini hanya dapat diakses oleh SuperAdmin.</p>
      </div>
    );
  }

  return (
    <div>
      <style>{`
        .form-group .ipt-switch{
          display:inline-flex;
          align-items:center;
          gap:10px;
          cursor:pointer;
          margin-bottom:0;
          font-weight:600;
          color:var(--text-primary);
        }
        /* Override global .form-group input { width:100%; padding:14px; border:2px } */
        .form-group .ipt-switch input{
          position:absolute;
          opacity:0;
          width:0;
          height:0;
          margin:0;
          padding:0;
          border:none;
        }
        .ipt-switch-track{
          position:relative;
          width:44px;
          height:24px;
          border-radius:999px;
          background:#D7DBE4;
          transition:background .2s ease;
          flex-shrink:0;
        }
        .ipt-switch-track::after{
          content:'';
          position:absolute;
          top:2px;
          left:2px;
          width:20px;
          height:20px;
          border-radius:50%;
          background:#fff;
          box-shadow:0 1px 3px rgba(0,0,0,.25);
          transition:transform .2s ease;
        }
        .ipt-switch input:checked + .ipt-switch-track{
          background:#10b981;
        }
        .ipt-switch input:checked + .ipt-switch-track::after{
          transform:translateX(20px);
        }
        .ipt-switch input:focus-visible + .ipt-switch-track{
          outline:2px solid #3B82F6;
          outline-offset:2px;
        }
        .ipt-switch-label .when-on{ display:none; }
        .ipt-switch-label .when-off{ display:inline; }
        .ipt-switch input:checked ~ .ipt-switch-label .when-on{ display:inline; }
        .ipt-switch input:checked ~ .ipt-switch-label .when-off{ display:none; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 10,
            background: '#EAF1FE', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: '#3B82F6'
          }}
        >
          <Settings size={20} />
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Konfigurasi IPT</h2>
          <p style={{ margin: 0, color: '#6B7080', fontSize: 14 }}>Atur nilai point untuk semua indikator IPT</p>
        </div>
      </div>

      {message && (
        <div className={`alert ${message.includes('Gagal') ? 'alert-danger' : 'alert-success'}`} style={{ marginBottom: 20 }}>
          {message}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h3 style={{ margin: '0 0 4px' }}>Batas Minimum Total IPT per Tingkat</h3>
            <p style={{ margin: 0, color: '#6B7080', fontSize: 13 }}>
              Total IPT siswa di bawah batas tingkatnya ditampilkan <strong style={{ color: '#dc2626' }}>merah</strong> pada
              cetakan Excel (laporan individual &amp; per kelas) dan halaman laporan. Isi <strong>0</strong> untuk
              menonaktifkan per tingkat.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {['X', 'XI', 'XII'].map(grade => (
              <div key={grade}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600, color: '#6B7080' }}>
                  Kelas {grade}
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={minIptValues[grade]}
                  onChange={(e) => setMinIptValues(prev => ({ ...prev, [grade]: e.target.value }))}
                  style={{ width: 110, padding: '9px 10px', borderRadius: 8, border: '1px solid #D7DBE4', fontSize: 14 }}
                />
              </div>
            ))}
            <button className="btn btn-primary" onClick={saveMinIptConfig} disabled={minIptSaving}>
              {minIptSaving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h3 style={{ margin: '0 0 4px' }}>IPT Awal per Tingkat</h3>
            <p style={{ margin: 0, color: '#6B7080', fontSize: 13 }}>
              Nilai awal IPT untuk siswa Kelas X, XI, dan XII. Menyimpan akan menerapkan nilai ke
              siswa saat ini (hanya yang berubah) dan menyimpannya sebagai default untuk siswa baru.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {['X', 'XI', 'XII'].map(grade => (
              <div key={grade}>
                <label style={{ display: 'block', marginBottom: 4, fontSize: 12, fontWeight: 600, color: '#6B7080' }}>
                  Kelas {grade} ({iptAwalCounts[grade] ?? 0} siswa)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={iptAwalValues[grade]}
                  onChange={(e) => setIptAwalValues(prev => ({ ...prev, [grade]: e.target.value }))}
                  style={{ width: 110, padding: '9px 10px', borderRadius: 8, border: '1px solid #D7DBE4', fontSize: 14 }}
                />
              </div>
            ))}
            <button className="btn btn-primary" onClick={saveIptAwalConfig} disabled={iptAwalSaving}>
              {iptAwalSaving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>Kategori Konfigurasi</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDeleteAll}
              disabled={saving}
              className="btn btn-danger"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Trash2 size={14} /> Hapus Semua
            </button>
            <button
              onClick={fetchConfigs}
              disabled={loading}
              className="btn btn-info"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid #E7E8EE',
                background: activeCategory === cat.key ? '#3B82F6' : '#FFFFFF',
                color: activeCategory === cat.key ? '#FFFFFF' : '#1E2130',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                transition: 'all 0.2s'
              }}
            >
              <span style={{ display: 'inline-flex' }}><cat.icon size={16} /></span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>
            {categories.find(c => c.key === activeCategory)?.label} Configuration
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            {activeCategory === 'pelanggaran' && pelanggaranSection === 'detail' && (
              <button
                onClick={() => { setExcelFile(null); setImportResults([]); setShowImportModal(true); }}
                className="btn btn-info"
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} /> Import Excel
              </button>
            )}
            <button
              onClick={() => {
                setPelanggaranAddType(activeCategory === 'pelanggaran' ? pelanggaranSection : 'severity');
                setShowAddModal(true);
              }}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={14} /> Tambah Konfigurasi
            </button>
          </div>
        </div>

        {activeCategory === 'pelanggaran' && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[
              ['severity', 'Tingkat Pelanggaran & Point'],
              ['detail', 'Detail Pelanggaran']
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setPelanggaranSection(key)}
                className={`btn ${pelanggaranSection === key ? 'btn-primary' : 'btn-secondary'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {activeCategory === 'perilaku' && (
          <div className="card" style={{ marginBottom: 20, background: '#F8FAFF' }}>
            <h4>Daftar Tingkat Penilaian</h4>
            <form onSubmit={addPerilakuRating} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={perilakuRatingName}
                onChange={event => setPerilakuRatingName(event.target.value)}
                placeholder="Contoh: Kurang Baik, Cukup Baik, Baik, Sangat Baik"
                required
                className="form-control"
              />
              <button className="btn btn-primary" disabled={saving}>Tambah</button>
            </form>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {perilakuRatings.length === 0 ? (
                <p style={{ color: '#6B7080' }}>Belum ada tingkat penilaian yang tersedia.</p>
              ) : perilakuRatings.map(rating => (
                <span
                  key={rating.id}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    background: '#F8FAFF',
                    border: '1px solid #E7E8EE',
                    borderRadius: 6,
                    fontWeight: 600
                  }}
                >
                  {formatDisplayText(rating.name)}
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => deletePerilakuRating(rating)}
                    style={{ padding: '2px 6px', fontSize: 11 }}
                  >
                    Hapus
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {activeCategory === 'organisasi' && (
          <div className="card" style={{ marginBottom: 20, background: '#F8FAFF' }}>
            <h4>Daftar Organisasi</h4>
            <form onSubmit={addOrganisasiOption} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={organisasiName}
                onChange={event => setOrganisasiName(event.target.value)}
                placeholder="Contoh: OSIS, KY, MPK"
                required
                className="form-control"
              />
              <button className="btn btn-primary" disabled={saving}>Tambah</button>
            </form>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {organisasiOptions.map(option => (
                <span key={option.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#FFFFFF', border: '1px solid #E7E8EE', borderRadius: 6 }}>
                  {option.name}
                  <button type="button" className="btn btn-danger" onClick={() => deleteOrganisasiOption(option)} style={{ padding: '2px 6px', fontSize: 11 }}>Hapus</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : displayedConfigs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#6B7080' }}>
            <div style={{ fontSize: 48, marginBottom: 16, color: '#94A3B8', display: 'flex', justifyContent: 'center' }}><TriangleAlert size={48} /></div>
            <p>Belum ada konfigurasi untuk kategori ini</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                {tableFields.map(field => <th key={field.key}>{field.label}</th>)}
                <th>Point</th>
                {showDescription && <th>Deskripsi</th>}
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {displayedConfigs.map(config => (
                <tr key={config.id}>
                  {tableFields.map((field, index) => (
                    <td key={field.key} style={index === 0 ? { fontWeight: 600 } : undefined}>
                      {formatConfigField(config, field.key)}
                    </td>
                  ))}
                  <td>
                    {(() => {
                      const pointValue = getDisplayPoint(config);
                      return (
                    <span
                      style={{
                        padding: '4px 12px',
                        borderRadius: 20,
                        background: pointValue >= 0 ? '#EAFBF3' : '#FEE2E2',
                        color: pointValue >= 0 ? '#0F7A55' : '#DC2626',
                        fontWeight: 700,
                        fontSize: 14
                      }}
                    >
                      {pointValue >= 0 ? '+' : ''}{pointValue}
                    </span>
                      );
                    })()}
                  </td>
                  {showDescription && <td style={{ fontSize: 13, color: '#6B7080' }}>{config.description || 'Tidak ada deskripsi'}</td>}
                  <td>
                    <button
                      onClick={() => handleToggleActive(config.id, config.is_active)}
                      className={`btn ${config.is_active ? 'btn-success' : 'btn-secondary'}`}
                      style={{ 
                        padding: '4px 12px', 
                        fontSize: 12, 
                        minWidth: '80px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                    >
                      {config.is_active ? '✓ Aktif' : '✗ Non-Aktif'}
                    </button>
                  </td>
                  <td>
                    <button
                      onClick={() => openEditModal(config)}
                      className="btn btn-info"
                      style={{ padding: '4px 8px', fontSize: 12, marginRight: 4, display: 'inline-flex', alignItems: 'center' }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => handleDeleteConfig(config.id)}
                      className="btn btn-danger"
                      style={{ padding: '4px 8px', fontSize: 12, display: 'inline-flex', alignItems: 'center' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && editingConfig && (
        <div className="app-modal-overlay" style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1500
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 12,
            padding: 24,
            width: '100%',
            maxWidth: 500,
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ marginBottom: 20 }}>Edit Konfigurasi</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const isDetailRow = activeCategory === 'pelanggaran' && Boolean(editingConfig.field2);
              // Point baris tingkat harus negatif; point baris detail diisi otomatis dari tingkat (read-only)
              if (!isDetailRow) {
                const pvRaw = e.target.point_value?.value;
                if (activeCategory === 'pelanggaran' && pvRaw !== undefined && !(parseInt(pvRaw) < 0)) {
                  setMessage('Point pelanggaran harus negatif (< 0)');
                  return;
                }
              }
              handleUpdateConfig(editingConfig.id, {
                field2: e.target.field2?.value || editingConfig.field2,
                point_value: isDetailRow
                  ? Number(e.target.point_value.value)
                  : parseInt(e.target.point_value.value),
                description: isDetailRow
                  ? null
                  : e.target.description.value,
                is_active: e.target.is_active.checked
              });
            }}>
              <div className="form-group">
                <label>{activeCategory === 'pelanggaran' && editingConfig.field2 ? 'Detail Pelanggaran' : getHeaderLabel1(activeCategory)}</label>
                <input
                  type="text"
                  name="field1"
                  defaultValue={editingConfig.field1 ? formatConfigField(editingConfig, 'field1') : '-'}
                  disabled
                  className="form-control"
                  style={{ background: '#F7F8FB', color: '#6B7080' }}
                />
              </div>
              {showEditField2 && (
                <div className="form-group">
                  <label>{activeCategory === 'pelanggaran' ? 'Tingkat Pelanggaran' : getHeaderLabel2(activeCategory)}</label>
                  {activeCategory === 'pelanggaran' ? (
                    <select
                      name="field2"
                      defaultValue={editingConfig.field2 || ''}
                      required
                      className="form-control"
                      onChange={(e) => {
                        // Auto-fill Point Value sesuai tingkat yang dipilih
                        const level = editTingkatOptions.find(l => l.field1 === e.target.value);
                        const pointInput = e.target.form?.elements?.point_value;
                        if (pointInput) pointInput.value = level?.point_value != null ? String(level.point_value) : '';
                      }}
                    >
                      <option value="" disabled hidden>Pilih Tingkat Pelanggaran</option>
                      {editTingkatOptions.map(level => (
                        <option key={level.id} value={level.field1}>
                          {level.field1}{level.is_active ? '' : ' (non-aktif)'}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      name="field2"
                      defaultValue={editingConfig.field2 ? formatConfigField(editingConfig, 'field2') : '-'}
                      disabled
                      className="form-control"
                      style={{ background: '#F7F8FB', color: '#6B7080' }}
                    />
                  )}
                </div>
              )}
              <div className="form-group">
                <label>Point Value</label>
                <input
                  type="number"
                  name="point_value"
                  defaultValue={editingConfig.point_value}
                  required
                  disabled={activeCategory === 'pelanggaran' && Boolean(editingConfig.field2)}
                  {...(activeCategory === 'pelanggaran' ? { max: -1 } : {})}
                  className="form-control"
                  placeholder="Masukkan nilai point"
                  style={activeCategory === 'pelanggaran' && editingConfig.field2 ? { background: '#F7F8FB', color: '#6B7080' } : undefined}
                />
                {activeCategory === 'pelanggaran' && (
                  <small style={{ color: '#666', fontSize: '12px' }}>
                    {editingConfig.field2
                      ? 'Point otomatis mengikuti Tingkat Pelanggaran yang dipilih'
                      : 'Point pelanggaran harus negatif karena mengurangi IPT'}
                  </small>
                )}
              </div>
              {!(activeCategory === 'pelanggaran' && editingConfig.field2) && <div className="form-group">
                <label>Deskripsi</label>
                <textarea
                  name="description"
                  defaultValue={editingConfig.description || ''}
                  className="form-control"
                  rows={3}
                  placeholder="Masukkan deskripsi konfigurasi"
                />
              </div>}
              <div className="form-group">
                <label>Status</label>
                <label className="ipt-switch">
                  <input
                    type="checkbox"
                    name="is_active"
                    defaultChecked={editingConfig.is_active}
                  />
                  <span className="ipt-switch-track" />
                  <span className="ipt-switch-label">
                    <span className="when-on">Aktif</span>
                    <span className="when-off">Non-Aktif</span>
                  </span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingConfig(null);
                  }}
                  className="btn btn-secondary"
                >
                  Batal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="app-modal-overlay" style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1500
        }}>
          <div style={{
            background: '#FFFFFF',
            borderRadius: 12,
            padding: 24,
            width: '100%',
            maxWidth: 450,
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ marginBottom: 8, fontSize: 18, fontWeight: 600 }}>Tambah Konfigurasi</h3>
            <p style={{ marginBottom: 20, fontSize: 13, color: '#6B7080' }}>
              Kategori: <strong>{categories.find(c => c.key === activeCategory)?.label}</strong>
            </p>
            <form onSubmit={(e) => {
              e.preventDefault();
              // Point pelanggaran harus negatif (mengurangi IPT)
              const pvRaw = e.target.point_value?.value;
              if (activeCategory === 'pelanggaran' && pvRaw !== undefined && !(parseInt(pvRaw) < 0)) {
                setMessage('Point pelanggaran harus negatif (< 0)');
                return;
              }
              handleAddConfig({
                category: activeCategory,
                field1: e.target.field1.value,
                field2: e.target.field2?.value || null,
                point_value: activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail'
                  ? 0
                  : parseInt(e.target.point_value.value),
                description: activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail'
                  ? null
                  : e.target.description.value,
                is_active: true
              });
            }}>
              <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                  {activeCategory === 'pelanggaran'
                    ? (pelanggaranAddType === 'detail' ? 'Detail Pelanggaran' : 'Tingkat Pelanggaran')
                    : getHeaderLabel1(activeCategory)} *
                </label>
                {activeCategory === 'prestasi' && (
                  <select name="field1" required className="form-control" style={{ fontSize: 14 }}>
                    <option value="" disabled hidden>Pilih Tingkat Lomba</option>
                    {FIXED_TINGKAT_OPTIONS.map(tingkat => (
                      <option key={tingkat} value={tingkat}>
                        {formatDisplayText(tingkat)}
                      </option>
                    ))}
                  </select>
                )}
                {activeCategory === 'perilaku' && (
                  <select name="field1" required className="form-control" style={{ fontSize: 14 }}>
                    <option value="" disabled hidden>Pilih Tingkat Penilaian</option>
                    {perilakuRatings.filter(rating => rating.is_active).map(rating => (
                      <option key={rating.id} value={rating.name}>
                        {formatDisplayText(rating.name)}
                      </option>
                    ))}
                  </select>
                )}
                {activeCategory === 'pelanggaran' && pelanggaranAddType === 'severity' && (
                <input
                  type="text"
                  name="field1"
                  required
                  className="form-control"
                  placeholder="Contoh: Ringan, Sedang, Berat, Sangat Berat"
                  style={{ fontSize: 14 }}
                />
                )}
                {activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail' && (
                  <input
                    type="text"
                    name="field1"
                    required
                    className="form-control"
                    placeholder="Contoh: Mencuri, Mencontek, Bolos"
                    style={{ fontSize: 14 }}
                  />
                )}
                {activeCategory === 'kepanitiaan' && (
                  <select name="field1" required className="form-control" style={{ fontSize: 14 }}>
                    <option value="" disabled hidden>Pilih Jabatan</option>
                    <option value="ketua">Ketua</option>
                    <option value="wakil ketua">Wakil Ketua</option>
                    <option value="sekretaris">Sekretaris</option>
                    <option value="bendahara">Bendahara</option>
                    <option value="koordinator">Koordinator</option>
                    <option value="anggota">Anggota</option>
                  </select>
                )}
                {activeCategory === 'organisasi' && (
                  <select name="field1" required className="form-control" style={{ fontSize: 14 }}>
                    <option value="" disabled hidden>Pilih Organisasi</option>
                    {organisasiOptions.filter(option => option.is_active).map(option => (
                      <option key={option.id} value={option.name}>{option.name}</option>
                    ))}
                  </select>
                )}
                {activeCategory === 'event' && (
                  <select name="field1" required className="form-control" style={{ fontSize: 14 }}>
                    <option value="" disabled hidden>Pilih Tingkat Event</option>
                    {FIXED_TINGKAT_OPTIONS.map(tingkat => (
                      <option key={tingkat} value={tingkat}>
                        {formatDisplayText(tingkat)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {showAddField2 && (
                <div className="form-group" style={{ marginBottom: 16 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>
                    {activeCategory === 'pelanggaran' ? 'Tingkat Pelanggaran' : getHeaderLabel2(activeCategory)} *
                  </label>
                  {activeCategory === 'prestasi' && (
                    <select name="field2" required className="form-control" style={{ fontSize: 14 }}>
                      <option value="" disabled hidden>Pilih Juara Lomba</option>
                      {FIXED_JUARA_LOMBA_OPTIONS.map(juara => (
                        <option key={juara} value={juara}>
                          {formatDisplayText(juara)}
                        </option>
                      ))}
                    </select>
                  )}
                  {activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail' && (
                    <select name="field2" required className="form-control" style={{ fontSize: 14 }}>
                      <option value="" disabled hidden>Pilih Tingkat Pelanggaran</option>
                    {configuredPelanggaranLevels.map(level => (
                      <option key={level.id} value={level.field1}>{level.field1}</option>
                    ))}
                    </select>
                  )}
                  {activeCategory === 'organisasi' && (
                    <select name="field2" required className="form-control" style={{ fontSize: 14 }}>
                      <option value="" disabled hidden>Pilih Jabatan</option>
                      <option value="ketua">Ketua</option>
                      <option value="wakil ketua">Wakil Ketua</option>
                      <option value="sekretaris">Sekretaris</option>
                      <option value="bendahara">Bendahara</option>
                      <option value="koordinator">Koordinator</option>
                      <option value="anggota">Anggota</option>
                    </select>
                  )}
                </div>
              )}
              {!(activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail') && <div className="form-group" style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Nilai Point *</label>
                <input
                  type="number"
                  name="point_value"
                  required
                  {...(activeCategory === 'pelanggaran' ? { max: -1 } : {})}
                  className="form-control"
                  placeholder={activeCategory === 'pelanggaran' ? 'Contoh: -1, -5, -25' : 'Masukkan nilai point'}
                  style={{ fontSize: 14 }}
                />
                {activeCategory === 'pelanggaran' && (
                  <small style={{ color: '#666', fontSize: '12px' }}>Point pelanggaran harus negatif karena mengurangi IPT</small>
                )}
              </div>}
              {!(activeCategory === 'pelanggaran' && pelanggaranAddType === 'detail') && <div className="form-group" style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 }}>Deskripsi</label>
                <textarea
                  name="description"
                  className="form-control"
                  rows={2}
                  placeholder="Deskripsi singkat..."
                  style={{ fontSize: 14 }}
                />
              </div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '8px 16px', fontSize: 14 }}
                >
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving} style={{ padding: '8px 16px', fontSize: 14 }}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Detail Pelanggaran dari Excel */}
      {showImportModal && (
        <div className="app-modal-overlay" style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1500
        }}>
          <div className="card" style={{ width: 500, maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
            <h4>Import Detail Pelanggaran dari Excel</h4>
            <button className="btn btn-danger" onClick={closeImportModal} style={{ marginBottom: '10px' }}>Tutup</button>
            <div style={{ marginBottom: '15px' }}>
              <button
                className="btn btn-secondary"
                onClick={downloadDetailTemplate}
                style={{ marginBottom: '10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} /> Download Template Detail
              </button>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleExcelFileChange}
                style={{ marginBottom: '10px' }}
              />
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                <strong>Format:</strong> Detail, TingkatPelanggaran
                <br />
                <small style={{ color: '#1976d2' }}>
                  Kolom TingkatPelanggaran harus sesuai daftar tingkat yang sudah dibuat
                  {configuredPelanggaranLevels.length > 0 && ` (contoh: ${configuredPelanggaranLevels.slice(0, 3).map(l => l.field1).join(', ')})`}.
                  Point diambil otomatis dari tingkatnya.
                </small>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleDetailExcelImport}
                disabled={importing || !excelFile}
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>

            {importResults.length > 0 && (
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px', borderRadius: '4px' }}>
                <h5>Import Results:</h5>
                <table className="table" style={{ fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '5px' }}>Detail</th>
                      <th style={{ padding: '5px' }}>Tingkat</th>
                      <th style={{ padding: '5px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.map((result, index) => (
                      <tr key={index}>
                        <td style={{ padding: '5px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{result.status === 'success' ? <CircleCheck size={14} /> : <CircleX size={14} />} {result.name}</span>
                        </td>
                        <td style={{ padding: '5px' }}>{result.level || '-'}</td>
                        <td style={{ padding: '5px' }}>
                          {result.status === 'error' ? result.error : 'Berhasil'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default KonfigurasiIPT;