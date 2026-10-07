import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import StudentDetail from './StudentDetail';
import { GRHA_OPTIONS, getRowField, normalizeGrha } from '../utils/excelImport';
import { styleImportTemplateSheet } from '../utils/excelTemplate';
import { Plus, Download, CircleCheck, CircleX, BookOpen, Lightbulb } from 'lucide-react';

const JABATAN_OPTIONS = ['Guru', 'Pegawai'];

const EXPORT_COLUMNS = [
  { key: 'nama', header: 'Nama', width: 25 },
  { key: 'username', header: 'Username', width: 16 },
  { key: 'role', header: 'Role', width: 12 },
  { key: 'detail', header: 'Jabatan', width: 12 },
  { key: 'nis', header: 'NIS', width: 12 },
  { key: 'nip', header: 'NIP', width: 18 },
  { key: 'kelas', header: 'Kelas', width: 12 },
  { key: 'jurusan', header: 'Jurusan', width: 10 },
  { key: 'grha', header: 'Grha', width: 12 },
  { key: 'tahun_pelajaran', header: 'Tahun Pelajaran', width: 16 },
  { key: 'no_hp', header: 'No HP', width: 16 },
  { key: 'alamat', header: 'Alamat', width: 25 },
  { key: 'wali_kelas', header: 'Wali Kelas', width: 14 },
  { key: 'ipt_total', header: 'IPT Total', width: 10 },
  { key: 'ipt_awal', header: 'IPT Awal', width: 10 },
  { key: 'is_graduated', header: 'Status', width: 10 },
  { key: 'created_at', header: 'Tanggal Dibuat', width: 18 },
  { key: 'id', header: 'ID', width: 8 }
];

// Columns that must stay Text format so Excel keeps leading zeros (e.g. 08123).
const EXPORT_TEXT_FORMAT_KEYS = new Set(['nis', 'nip', 'no_hp']);

const KELAS_OPTIONS = [
  'X TKJ 1', 'X TKJ 2', 'X TKR 1', 'X TKR 2',
  'X DPIB 1', 'X DPIB 2',
  'XI TKJ 1', 'XI TKJ 2', 'XI TKR 1', 'XI TKR 2',
  'XI DPIB 1', 'XI DPIB 2',
  'XII TKJ 1', 'XII TKJ 2', 'XII TKR 1', 'XII TKR 2',
  'XII DPIB 1', 'XII DPIB 2'
];

function KelolaAkun() {
  const minIpt = useMinIptPerGrade();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({});
  const [message, setMessage] = useState('');
  const [editStudent, setEditStudent] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [filters, setFilters] = useState({
    role: '',
    jabatan: '',
    kelas: '',
    grha: '',
    jurusan: '',
    tahun_pelajaran: ''
  });
  const [excelFile, setExcelFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState([]);
  const [detailStudent, setDetailStudent] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionRole, setSelectionRole] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalType, setCreateModalType] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importModalType, setImportModalType] = useState('');
  const [showExportModal, setShowExportModal] = useState(false);
  const [excludedCols, setExcludedCols] = useState(new Set(['id']));
  const [exporting, setExporting] = useState(false);
  const [showEditBiodataModal, setShowEditBiodataModal] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0
  });
  const [searchQuery, setSearchQuery] = useState('');
  // Background refresh indicator (table only). The full-page spinner (loading)
  // is reserved for the first mount so typing never unmounts the search box.
  const [refreshing, setRefreshing] = useState(false);
  // Latest filter values for the stable fetch callback below.
  const searchRef = useRef(searchQuery);
  searchRef.current = searchQuery;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const limitRef = useRef(pagination.limit);
  limitRef.current = pagination.limit;
  const fetchStartedRef = useRef(false);

  const grhaOptions = GRHA_OPTIONS;

  // Remove client-side filtering since backend handles it now
  const filteredUsers = users;

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters({ role: '', jabatan: '', kelas: '', grha: '', jurusan: '', tahun_pelajaran: '' });
  };

  // Stable identity (empty deps): reads latest search/filters via refs so
  // typing doesn't recreate it and retrigger the mount effect below.
  // First call drives the full-page spinner; later calls only set `refreshing`
  // so the search input is never unmounted mid-keystroke.
  const fetchUsers = useCallback(async (page = 1) => {
    const isFirstLoad = !fetchStartedRef.current;
    fetchStartedRef.current = true;
    try {
      if (isFirstLoad) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      const params = new URLSearchParams({
        page: page,
        limit: limitRef.current,
        search: searchRef.current
      });

      const f = filtersRef.current;
      if (f.role) params.append('role', f.role);
      if (f.jabatan) params.append('jabatan', f.jabatan);
      if (f.kelas) params.append('kelas', f.kelas);
      if (f.grha) params.append('grha', f.grha);
      if (f.jurusan) params.append('jurusan', f.jurusan);
      if (f.tahun_pelajaran) params.append('tahun_pelajaran', f.tahun_pelajaran);

      const response = await api.get(`/users?${params.toString()}`);

      setUsers(response.data.users || []);
      setPagination(response.data.pagination || {
        page: 1,
        limit: 50,
        total: 0,
        totalPages: 0
      });
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    setUserRole(user?.role);
    fetchUsers();
  }, [fetchUsers]);

  // Debounced search effect
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUsers(1);
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, filters.role, filters.jabatan, filters.kelas, filters.grha, filters.jurusan, filters.tahun_pelajaran, fetchUsers]);

  const handleCreateStudent = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/users/create-student', formData);
      setMessage(`Akun siswa berhasil dibuat! Username: ${res.data?.username || '-'}`);
      setShowCreateModal(false);
      setFormData({});
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal membuat akun');
    }
  };

  const handleCreateTeacher = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/users/create-teacher', formData);
      setMessage(`Akun guru berhasil dibuat! Username: ${res.data?.username || '-'}`);
      setShowCreateModal(false);
      setFormData({});
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal membuat akun');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus akun ini?')) return;
    
    try {
      await api.delete(`/users/${userId}`);
      setMessage('Akun berhasil dihapus!');
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus akun');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) {
      setMessage('Pilih minimal satu pengguna');
      return;
    }

    const label = selectionRole === 'guru' ? 'guru/pegawai' : selectionRole === 'pegawai' ? 'pegawai/guru' : 'siswa';
    if (!window.confirm(`Apakah Anda yakin ingin menghapus ${selectedIds.length} akun ${label}?\n\nData terkait (pengajuan/notifications) juga akan ikut terhapus.`)) {
      return;
    }

    try {
      await api.post('/users/bulk-delete', { user_ids: selectedIds });
      setMessage(`Berhasil menghapus ${selectedIds.length} akun`);
      setSelectedIds([]);
      setSelectionRole(null);
      fetchUsers();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus akun (bulk)');
    }
  };

  const toggleUserSelection = (user) => {
    if (user.role === 'superadmin') {
      return;
    }

    if (selectedIds.includes(user.id)) {
      const next = selectedIds.filter((id) => id !== user.id);
      setSelectedIds(next);
      if (next.length === 0) {
        setSelectionRole(null);
      }
      return;
    }

    if (selectionRole && user.role !== selectionRole) {
      // Allow selecting both guru and pegawai together
      if ((selectionRole === 'guru' && user.role === 'pegawai') || (selectionRole === 'pegawai' && user.role === 'guru')) {
        // Allow mixing guru and pegawai
      } else {
        setMessage('Tidak bisa memilih role berbeda sekaligus. Kosongkan pilihan terlebih dahulu.');
        return;
      }
    }

    // Set selection role - if adding guru or pegawai, set to 'guru' to represent both
    if (user.role === 'guru' || user.role === 'pegawai') {
      setSelectionRole('guru');
    } else {
      setSelectionRole(user.role);
    }
    
    setSelectedIds([...selectedIds, user.id]);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setSelectionRole(null);
  };

  const selectAllFiltered = () => {
    const selectable = filteredUsers.filter((u) => u.role !== 'superadmin');
    if (selectable.length === 0) {
      return;
    }

    // Allow selecting all regardless of role mixing
    setSelectedIds(selectable.map((u) => u.id));
    // Set selection role based on what's selected - if mixed guru/pegawai, set to 'guru' as default
    const hasGuru = selectable.some(u => u.role === 'guru');
    const hasPegawai = selectable.some(u => u.role === 'pegawai');
    const hasSiswa = selectable.some(u => u.role === 'siswa');
    
    if (hasSiswa && (hasGuru || hasPegawai)) {
      setSelectionRole(null); // Mixed with siswa, allow all
    } else if (hasGuru || hasPegawai) {
      setSelectionRole('guru'); // Use 'guru' to represent both guru and pegawai
    } else {
      setSelectionRole('siswa');
    }
  };

  const isUserSelectable = (user) => user.role !== 'superadmin';
  const isUserDisabled = (user) => {
    if (!isUserSelectable(user)) return true;
    // Only disable if selectionRole is set and user role doesn't match
    // If selectionRole is null, allow mixed selection
    if (!selectionRole) return false;
    
    // Allow mixing guru and pegawai
    if (selectionRole === 'guru' && (user.role === 'guru' || user.role === 'pegawai')) {
      return false;
    }
    
    return user.role !== selectionRole;
  };

  const handleLimitChange = (newLimit) => {
    limitRef.current = newLimit;
    setPagination((prev) => ({ ...prev, limit: newLimit }));
    fetchUsers(1);
  };

  const getPageNumbers = () => {
    const total = pagination.totalPages || 0;
    const current = pagination.page || 1;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const candidates = new Set([1, 2, current - 1, current, current + 1, total - 1, total]);
    const nums = [...candidates].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) out.push('...');
      out.push(n);
    });
    return out;
  };

  const handleEditUser = (user) => {
    setEditStudent(user);
    if (user.role === 'siswa') {
      setFormData({
        nama: user.nama,
        nis: user.nis,
        username: user.username || '',
        jurusan: user.jurusan,
        grha: user.grha,
        tahun_pelajaran: user.tahun_pelajaran
      });
    } else if (user.role === 'guru' || user.role === 'pegawai') {
      setFormData({
        nama: user.nama,
        nip: user.nip,
        username: user.username || '',
        jabatan: user.jabatan || user.detail || '',
        no_hp: user.no_hp
      });
    }
    setShowEditBiodataModal(true);
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      // Superadmin may also rename the account: applied first so a failed
      // rename aborts before biodata is touched.
      const newUsername = (formData.username || '').trim();
      if (userRole === 'superadmin' && newUsername && newUsername !== (editStudent.username || '')) {
        await api.put(`/users/${editStudent.id}/username`, { username: newUsername });
      }
      // Biodata edits apply directly, no approval needed (guru/pegawai may
      // only touch siswa targets enforced server-side too).
      await api.put(`/users/${editStudent.id}/biodata`, formData);
      setMessage(`Data ${editStudent.role === 'siswa' ? 'siswa' : 'guru'} berhasil diupdate!`);
      
      setShowEditBiodataModal(false);
      setEditStudent(null);
      setFormData({});
      fetchUsers(pagination.page);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal update data');
    }
  };

  const handleExcelFileChange = (e) => {
    setExcelFile(e.target.files[0]);
  };

  // NOTE: import type is passed explicitly as an argument (not via setState)
  // because setState is async calling setImportType() then handleExcelImport()
  // in the same tick reads the STALE type and runs the wrong branch
  // (this was the bug: guru import ran the siswa validation).
  const handleExcelImport = async (type = importModalType) => {
    if (!excelFile) {
      setMessage('Please select an Excel file');
      return;
    }

    setImporting(true);
    setImportResults([]);
    const results = [];

    try {
      const data = await excelFile.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);

      for (const row of jsonData) {
        try {
          if (type === 'siswa') {
            // Skip rows without nama (might be header or empty)
            const nama = getRowField(row, 'nama', 'Nama');
            if (!nama) {
              continue;
            }

            // Import student
            const jurusan = getRowField(row, 'jurusan', 'Jurusan');
            const tahunPelajaran = getRowField(row, 'tahun_pelajaran', 'Tahun Pelajaran', 'TahunPelajaran');
            
            // Validate jurusan
            const validJurusanOptions = ['TKJ 1', 'TKJ 2', 'DPIB 1', 'DPIB 2', 'TKR 1', 'TKR 2'];
            if (!jurusan || !validJurusanOptions.includes(jurusan)) {
              results.push({
                status: 'error',
                name: nama,
                error: `Jurusan tidak valid. Gunakan: ${validJurusanOptions.join(', ')}`
              });
              continue;
            }
            
            // Validate tahun_pelajaran format
            if (!tahunPelajaran || !/^\d{4}-\d{4}$/.test(tahunPelajaran)) {
              results.push({
                status: 'error',
                name: nama,
                error: 'Tahun pelajaran tidak valid. Format harus YYYY-YYYY (contoh: 2024-2025)'
              });
              continue;
            }

            // Calculate expected class for better feedback
            const currentYear = new Date().getFullYear();
            const currentMonth = new Date().getMonth();
            const currentAcademicYear = currentMonth >= 6 
              ? `${currentYear}-${currentYear + 1}` 
              : `${currentYear - 1}-${currentYear}`;
            
            const [enrollStart] = tahunPelajaran.split('-').map(Number);
            const [currentStart] = currentAcademicYear.split('-').map(Number);
            const yearsSinceEnrollment = currentStart - enrollStart;
            
            let classLevel = '';
            let statusText = '';
            
            switch (yearsSinceEnrollment) {
              case 0: 
                classLevel = 'X'; 
                statusText = 'Kelas X';
                break;
              case 1: 
                classLevel = 'XI'; 
                statusText = 'Kelas XI';
                break;
              case 2: 
                classLevel = 'XII'; 
                statusText = 'Kelas XII';
                break;
              default: 
                classLevel = 'Lulus';
                statusText = 'Sudah Lulus';
            }
            
            const expectedClass = classLevel === 'Lulus' ? 'Lulus' : `${classLevel} ${jurusan}`;
            
            const studentData = {
              nama: nama,
              nis: getRowField(row, 'nis', 'NIS'),
              jurusan,
              grha: normalizeGrha(getRowField(row, 'grha', 'Grha', 'Gra', 'GRHA')) || 'Airsanya',
              tahun_pelajaran: tahunPelajaran,
              password: getRowField(row, 'password', 'Password') || '123456'
            };

            const res = await api.post('/users/create-student', studentData);
            results.push({ 
              status: 'success', 
              name: studentData.nama, 
              type: 'siswa',
              username: res.data?.username || '-',
              expectedClass: expectedClass,
              statusText: statusText,
              tahunPelajaran: tahunPelajaran
            });
          } else {
            // Import teacher
            const teacherData = {
              nama: getRowField(row, 'nama', 'Nama'),
              nip: getRowField(row, 'nip', 'NIP'),
              jabatan: getRowField(row, 'jabatan', 'Jabatan', 'detail', 'Detail'),
              no_hp: getRowField(row, 'no_hp', 'NoHP', 'No HP', 'no hp'),
              password: getRowField(row, 'password', 'Password') || '123456'
            };

            if (!JABATAN_OPTIONS.includes(teacherData.jabatan)) {
              results.push({
                status: 'error',
                name: teacherData.nama,
                error: `Jabatan tidak valid. Gunakan: ${JABATAN_OPTIONS.join(', ')}`
              });
              continue;
            }

            const res = await api.post('/users/create-teacher', teacherData);
            results.push({ status: 'success', name: teacherData.nama, type: 'guru', username: res.data?.username || '-' });
          }
        } catch (error) {
          results.push({
            status: 'error',
            name: row.nama || row.Nama || 'Unknown',
            error: error.response?.data?.message || error.message
          });
        }
      }

      setImportResults(results);
      setMessage(`Import completed: ${results.filter(r => r.status === 'success').length} successful, ${results.filter(r => r.status === 'error').length} failed`);
      fetchUsers(pagination.page);
    } catch (error) {
      setMessage('Error reading Excel file: ' + error.message);
    } finally {
      setImporting(false);
      setExcelFile(null);
    }
  };

  const toggleExportCol = (key) => {
    setExcludedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleExportExcel = async () => {
    const activeCols = EXPORT_COLUMNS.filter((c) => !excludedCols.has(c.key));
    if (activeCols.length === 0) {
      setMessage('Pilih minimal satu kolom untuk diekspor');
      return;
    }

    setExporting(true);
    try {
      const params = new URLSearchParams({
        page: 1,
        limit: 100000,
        search: searchQuery
      });

      if (filters.role) params.append('role', filters.role);
      if (filters.jabatan) params.append('jabatan', filters.jabatan);
      if (filters.kelas) params.append('kelas', filters.kelas);
      if (filters.grha) params.append('grha', filters.grha);
      if (filters.jurusan) params.append('jurusan', filters.jurusan);
      if (filters.tahun_pelajaran) params.append('tahun_pelajaran', filters.tahun_pelajaran);

      const response = await api.get(`/users?${params.toString()}`);
      const rows = response.data.users || [];

      const formatCellValue = (user, key) => {
        if (key === 'is_graduated') {
          return user.is_graduated ? 'Lulus' : 'Aktif';
        }
        if (key === 'created_at') {
          if (!user.created_at) return '';
          const d = new Date(user.created_at);
          return Number.isNaN(d.getTime()) ? user.created_at : d.toLocaleString('id-ID');
        }
        const value = user[key];
        return value === null || value === undefined ? '' : value;
      };

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Users');

      worksheet.columns = activeCols.map((c) => ({
        header: c.header,
        key: c.key,
        width: c.width,
        ...(EXPORT_TEXT_FORMAT_KEYS.has(c.key) ? { style: { numFmt: '@' } } : {})
      }));

      rows.forEach((user) => {
        const rowData = {};
        activeCols.forEach((c) => {
          rowData[c.key] = formatCellValue(user, c.key);
        });
        worksheet.addRow(rowData);
      });

      // Force Text format on NIS/NIP/No HP data cells so leading zeros survive.
      activeCols.forEach((c, colIndex) => {
        if (!EXPORT_TEXT_FORMAT_KEYS.has(c.key)) return;
        const colNumber = colIndex + 1;
        worksheet.getColumn(colNumber).numFmt = '@';
        for (let rowNumber = 2; rowNumber <= rows.length + 1; rowNumber += 1) {
          worksheet.getCell(rowNumber, colNumber).numFmt = '@';
        }
      });

      await styleImportTemplateSheet(worksheet, { dataRowCount: rows.length + 1, protect: false });

      const buffer = await workbook.xlsx.writeBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
      const link = document.createElement('a');
      link.href = blobUrl;
      const today = new Date().toISOString().slice(0, 10);
      link.download = `export_users_${today}.xlsx`;
      link.click();
      URL.revokeObjectURL(blobUrl);

      setMessage(`Berhasil mengekspor ${rows.length} pengguna`);
      setShowExportModal(false);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengekspor data');
    } finally {
      setExporting(false);
    }
  };

  const downloadTemplate = async (type) => {
    if (type === 'siswa') {
      // Create 30 sample students with TKJ 1 and the current academic year
      const templateData = [];
      
      for (let i = 1; i <= 30; i++) {
        templateData.push({
          No: i
        });
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template');

      worksheet.columns = [
        { header: 'No', key: 'No', width: 6 },
        { header: 'Nama', key: 'Nama', width: 25 },
        { header: 'NIS', key: 'NIS', width: 10 },
        { header: 'Jurusan', key: 'Jurusan', width: 10 },
        { header: 'Grha', key: 'Grha', width: 12 },
        { header: 'TahunPelajaran', key: 'TahunPelajaran', width: 15 },
        { header: 'Password', key: 'Password', width: 12 }
      ];
      templateData.forEach(row => worksheet.addRow(row));

      const validJurusanOptions = ['TKJ 1', 'TKJ 2', 'DPIB 1', 'DPIB 2', 'TKR 1', 'TKR 2'];
      const academicYearOptions = [];
      for (let year = 2024; year <= 2034; year += 1) {
        academicYearOptions.push(`${year}-${year + 1}`);
      }

      const validationFor = (formulae, errorTitle, error) => ({
        type: 'list',
        allowBlank: false,
        formulae: [`"${formulae.join(',')}"`],
        showErrorMessage: true,
        errorTitle,
        error
      });

      for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
        worksheet.getCell(`D${rowNumber}`).dataValidation = validationFor(
          validJurusanOptions,
          'Jurusan tidak valid',
          `Pilih salah satu: ${validJurusanOptions.join(', ')}`
        );
        worksheet.getCell(`E${rowNumber}`).dataValidation = validationFor(
          GRHA_OPTIONS,
          'Grha tidak valid',
          `Pilih salah satu: ${GRHA_OPTIONS.join(', ')}`
        );
        worksheet.getCell(`F${rowNumber}`).dataValidation = validationFor(
          academicYearOptions,
          'Tahun Pelajaran tidak valid',
          'Pilih TahunPelajaran dari daftar yang tersedia'
        );
      }

      await styleImportTemplateSheet(worksheet, {
        headerNotes: {
          Nama: 'Nama lengkap siswa sesuai data sekolah.',
          NIS: 'Nomor Induk Siswa - unik, tidak boleh sama dengan siswa lain.',
          Jurusan: 'Pilih dari daftar: TKJ 1, TKJ 2, DPIB 1, DPIB 2, TKR 1, TKR 2.',
          Grha: 'Pilih grha siswa dari daftar yang tersedia.',
          TahunPelajaran: 'Tahun pelajaran siswa tersebut masuk sekolah. Format YYYY-YYYY, contoh: 2026-2027.',
          Password: 'Password awal akun (min. 6 karakter). User wajib menggantinya saat login pertama.'
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'template_siswa.xlsx';
      link.click();
      URL.revokeObjectURL(blobUrl);
    } else {
      const templateData = [];
      
      for (let i = 1; i <= 30; i++) {
        templateData.push({
          No: i
        });
      }

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template');
      worksheet.columns = [
        { header: 'No', key: 'No', width: 6 },
        { header: 'Nama', key: 'Nama', width: 25 },
        { header: 'NIP', key: 'NIP', width: 18 },
        { header: 'Jabatan', key: 'Jabatan', width: 14 },
        { header: 'NoHP', key: 'NoHP', width: 15, style: { numFmt: '@' } },
        { header: 'Password', key: 'Password', width: 12 }
      ];
      templateData.forEach(row => worksheet.addRow(row));

      // Keep leading zero (e.g. 08123): force NoHP column (E) to Text format.
      worksheet.getColumn('E').numFmt = '@';
      for (let rowNumber = 2; rowNumber <= 1000; rowNumber += 1) {
        worksheet.getCell(`E${rowNumber}`).numFmt = '@';
      }

      worksheet.dataValidations.add('D2:D1000', {
        type: 'list',
        allowBlank: false,
        formulae: [`"${JABATAN_OPTIONS.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Jabatan tidak valid',
        error: `Pilih salah satu: ${JABATAN_OPTIONS.join(', ')}`
      });

      await styleImportTemplateSheet(worksheet, {
        headerNotes: {
          Nama: 'Nama lengkap guru/pegawai sesuai data sekolah.',
          NIP: 'Nomor Induk Pegawai - unik, tidak boleh sama dengan yang lain.',
          Jabatan: 'Pilih dari daftar: Guru, Pegawai.',
          NoHP: 'Nomor HP aktif, diawali 08 (contoh: 081234567890).',
          Password: 'Password awal akun (min. 6 karakter). User wajib menggantinya saat login pertama.'
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = 'template_guru.xlsx';
      link.click();
      URL.revokeObjectURL(blobUrl);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  // Siswa cannot access Kelola Akun
  if (userRole === 'siswa') {
    return (
      <div className="card">
        <h2>Akses Ditolak</h2>
        <p>Anda tidak memiliki izin untuk mengakses halaman ini.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'var(--font-sans)', background: 'transparent', padding: '4px 4px 40px', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--card-radius)', padding: '24px', boxShadow: 'var(--shadow-card)' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '24px', fontWeight: '700', color: 'var(--ink)', margin: '0 0 8px' }}>Kelola Akun</h1>
          <p style={{ fontSize: '13px', color: 'var(--slate)', margin: 0 }}>Role: {userRole || 'loading...'}</p>
        </div>

        {message && <div className="alert alert-success" style={{ marginBottom: '20px' }}>{message}</div>}

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {userRole === 'superadmin' && (
            <button 
              onClick={() => { setShowCreateModal(true); setCreateModalType('student'); setFormData({}); }}
              style={{ 
                padding: '10px 16px', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                background: 'var(--blue)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => { e.target.style.background = 'var(--blue-dark)'; e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 8px rgba(30, 136, 229, 0.3)'; }}
              onMouseOut={(e) => { e.target.style.background = 'var(--blue)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
            >
              <Plus size={15} /> Buat Akun Siswa
            </button>
          )}
          
          {userRole === 'superadmin' && (
            <button 
              onClick={() => { setShowCreateModal(true); setCreateModalType('teacher'); setFormData({}); }}
              style={{ 
                padding: '10px 16px', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                background: 'var(--success-color)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px',
                transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => { e.target.style.background = '#059669'; e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 8px rgba(67, 160, 71, 0.3)'; }}
              onMouseOut={(e) => { e.target.style.background = 'var(--success-color)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
            >
              <Plus size={15} /> Buat Akun Guru
            </button>
          )}

          {userRole === 'superadmin' && (
            <>
              <button 
                onClick={() => { setShowImportModal(true); setImportModalType('siswa'); setExcelFile(null); setImportResults([]); }}
                style={{ 
                  padding: '10px 16px', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  background: 'var(--blue)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => { e.target.style.background = 'var(--blue-dark)'; e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 8px rgba(30, 136, 229, 0.3)'; }}
                onMouseOut={(e) => { e.target.style.background = 'var(--blue)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
              >
                <Download size={15} /> Import Siswa
              </button>
              <button 
                onClick={() => { setShowImportModal(true); setImportModalType('guru'); setExcelFile(null); setImportResults([]); }}
                style={{ 
                  padding: '10px 16px', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  background: 'var(--blue)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => { e.target.style.background = 'var(--blue-dark)'; e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 8px rgba(30, 136, 229, 0.3)'; }}
                onMouseOut={(e) => { e.target.style.background = 'var(--blue)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
              >
                <Download size={15} /> Import Guru
              </button>
              <button 
                onClick={() => { setShowExportModal(true); setExcludedCols(new Set(['id'])); }}
                style={{ 
                  padding: '10px 16px', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: '500', cursor: 'pointer',
                  background: 'var(--success-color)', color: 'white', display: 'inline-flex', alignItems: 'center', gap: '6px',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => { e.target.style.background = '#059669'; e.target.style.transform = 'translateY(-2px)'; e.target.style.boxShadow = '0 4px 8px rgba(67, 160, 71, 0.3)'; }}
                onMouseOut={(e) => { e.target.style.background = 'var(--success-color)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
              >
                <Download size={15} /> Export Excel
              </button>
            </>
          )}
        </div>

        {/* Filters */}
        <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '2', minWidth: '200px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Cari</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama, NIS, atau NIP..."
                style={{
                  width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                  fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
            {userRole === 'superadmin' && (
              <div style={{ flex: '1', minWidth: '160px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Role</label>
                <select
                  value={filters.role}
                  onChange={(e) => {
                    handleFilterChange('role', e.target.value);
                    // Reset jabatan filter when role changes
                    if (e.target.value !== 'guru' && e.target.value !== 'pegawai') {
                      handleFilterChange('jabatan', '');
                    }
                  }}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                    fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
                >
                  <option value="">Semua Role</option>
                  <option value="superadmin">Superadmin</option>
                  <option value="guru">Guru</option>
                  <option value="pegawai">Pegawai</option>
                  <option value="siswa">Siswa</option>
                </select>
              </div>
            )}
            {userRole === 'superadmin' && (filters.role === 'guru' || filters.role === 'pegawai') && (
              <div style={{ flex: '1', minWidth: '160px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Jabatan</label>
                <select
                  value={filters.jabatan}
                  onChange={(e) => handleFilterChange('jabatan', e.target.value)}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                    fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                  }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                  onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
                >
                  <option value="">Semua Jabatan</option>
                  {JABATAN_OPTIONS.map((jabatan) => (
                    <option key={jabatan} value={jabatan}>{jabatan}</option>
                  ))}
                </select>
              </div>
            )}
            <div style={{ flex: '1', minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Kelas</label>
              <select
                value={filters.kelas}
                onChange={(e) => handleFilterChange('kelas', e.target.value)}
                style={{ 
                  width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px', 
                  fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
              >
                <option value="">Semua Kelas</option>
                {KELAS_OPTIONS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div style={{ flex: '1', minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Grha</label>
              <select
                value={filters.grha}
                onChange={(e) => handleFilterChange('grha', e.target.value)}
                style={{ 
                  width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px', 
                  fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
              >
                <option value="">Semua Grha</option>
                {grhaOptions.map(grha => <option key={grha} value={grha}>{grha}</option>)}
              </select>
            </div>
            {userRole === 'superadmin' && (
              <>
                <div style={{ flex: '1', minWidth: '160px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Jurusan</label>
                  <select
                    value={filters.jurusan}
                    onChange={(e) => handleFilterChange('jurusan', e.target.value)}
                    style={{ 
                      width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px', 
                      fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
                  >
                    <option value="">Semua Jurusan</option>
                    <option value="TKJ 1">TKJ 1</option>
                    <option value="TKJ 2">TKJ 2</option>
                    <option value="DPIB 1">DPIB 1</option>
                    <option value="DPIB 2">DPIB 2</option>
                    <option value="TKR 1">TKR 1</option>
                    <option value="TKR 2">TKR 2</option>
                  </select>
                </div>
                <div style={{ flex: '1', minWidth: '160px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '6px' }}>Tahun Pelajaran</label>
                  <select
                    value={filters.tahun_pelajaran}
                    onChange={(e) => handleFilterChange('tahun_pelajaran', e.target.value)}
                    style={{ 
                      width: '100%', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px', 
                      fontSize: '13px', background: 'white', color: '#333', transition: 'all 0.3s ease'
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)'; }}
                    onBlur={(e) => { e.target.style.borderColor = '#d0d0d0'; e.target.style.boxShadow = 'none'; }}
                  >
                    <option value="">Semua Tahun</option>
                    {(() => {
                      const options = [];
                      for (let year = 2024; year <= 2034; year++) {
                        options.push(`${year}-${year + 1}`);
                      }
                      return options.map(year => (
                        <option key={year} value={year}>{year}</option>
                      ));
                    })()}
                  </select>
                </div>
              </>
            )}
            <button 
              onClick={resetFilters}
              style={{ 
                padding: '8px 14px', background: '#f5f5f5', border: '1px solid #d0d0d0', borderRadius: '4px', 
                fontSize: '13px', cursor: 'pointer', color: '#666', transition: 'all 0.3s ease'
              }}
              onMouseOver={(e) => { e.target.style.background = '#efefef'; e.target.style.borderColor = '#bbb'; }}
              onMouseOut={(e) => { e.target.style.background = '#f5f5f5'; e.target.style.borderColor = '#d0d0d0'; }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto', marginBottom: '24px', border: '1px solid #d0d0d0', borderRadius: '4px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead style={{ background: '#f9f9f9', borderBottom: '1px solid #d0d0d0' }}>
              <tr>
                {userRole === 'superadmin' && <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '30px' }}></th>}
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0' }}>Nama</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '90px' }}>NIS/NIP</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '110px' }}>Username</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '80px' }}>Role</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '100px' }}>Kelas</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '90px' }}>Grha</th>
                {userRole === 'superadmin' && (
                  <>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '100px' }}>Jurusan</th>
                    <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '100px' }}>Tahun Pelajaran</th>
                  </>
                )}
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', borderRight: '1px solid #e0e0e0', width: '90px' }}>IPT Total</th>
                <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#333', width: '80px' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => (
                <tr 
                  key={user.id} 
                  style={{ 
                    transition: 'all 0.2s ease',
                    ...(isUserDisabled(user) && selectionRole ? { opacity: 0.45 } : {})
                  }}
                  onMouseOver={(e) => { if (!isUserDisabled(user) || !selectionRole) e.currentTarget.style.background = '#f0f7ff'; }}
                  onMouseOut={(e) => { e.currentTarget.style.background = ''; }}
                >
                  {userRole === 'superadmin' && (
                    <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                      {isUserSelectable(user) && (
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(user.id)}
                          disabled={isUserDisabled(user)}
                          onChange={() => toggleUserSelection(user)}
                          style={{ cursor: 'pointer' }}
                        />
                      )}
                    </td>
                  )}
                  <td style={{ padding: '10px 12px', color: '#333', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>{user.nama}</td>
                  <td style={{ padding: '10px 12px', color: '#333', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>{user.nis || user.nip || '-'}</td>
                  <td style={{ padding: '10px 12px', color: '#333', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0', fontWeight: '600' }}>{user.username || '-'}</td>
                  <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                    <span style={{ 
                      display: 'inline-block', padding: '4px 8px', borderRadius: '3px', fontSize: '11px', fontWeight: '500', textAlign: 'center', minWidth: '50px',
                      background: user.role === 'superadmin' ? 'var(--danger-color)' : (user.role === 'guru' || user.role === 'pegawai') ? 'var(--warning-color)' : 'var(--blue-light)',
                      color: user.role === 'superadmin' ? 'white' : (user.role === 'guru' || user.role === 'pegawai') ? 'white' : 'var(--blue)'
                    }}>
                      {(user.role === 'guru' || user.role === 'pegawai') ? (user.detail || user.jabatan || user.role.toUpperCase()) : user.role.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                    {user.is_graduated ? (
                      <span style={{ color: '#999', fontStyle: 'italic' }}>{user.kelas || '-'}</span>
                    ) : (
                      user.kelas || '-'
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                    {user.grha ? (
                      <span style={{ 
                        fontSize: '11px', backgroundColor: '#e3f2fd', color: '#1976d2', padding: '2px 6px', borderRadius: '4px'
                      }}>
                        {user.grha}
                      </span>
                    ) : '-'}
                  </td>
                  {userRole === 'superadmin' && (
                    <>
                      <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                        {user.jurusan ? (
                          <span style={{ 
                            fontSize: '11px', backgroundColor: '#fff3e0', color: '#e65100', padding: '2px 6px', borderRadius: '4px'
                          }}>
                            {user.jurusan}
                          </span>
                        ) : '-'}
                      </td>
                      <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                        {user.tahun_pelajaran ? (
                          <span style={{ 
                            fontSize: '11px',
                            backgroundColor: '#e3f2fd',
                            color: '#1976d2',
                            padding: '2px 6px',
                            borderRadius: '4px'
                          }}>
                            {user.tahun_pelajaran}
                          </span>
                        ) : '-'}
                      </td>
                    </>
                  )}
                  <td style={{ padding: '10px 12px', borderRight: '1px solid #e0e0e0', borderBottom: '1px solid #e0e0e0' }}>
                    <span style={{ 
                      color: (user.ipt_total ?? 0) < 0 || isBelowMinIpt(user.ipt_total ?? 0, minIptFor(minIpt, user.kelas)) ? '#dc2626' : 'inherit',
                      fontWeight: (user.ipt_total ?? 0) < 0 || isBelowMinIpt(user.ipt_total ?? 0, minIptFor(minIpt, user.kelas)) ? 'bold' : 'normal'
                    }}>
                      {(user.ipt_total ?? 0) < 0 ? `${user.ipt_total ?? 0} (MINUS)` : (user.ipt_total ?? 0)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', borderBottom: '1px solid #e0e0e0' }}>
                    {userRole === 'superadmin' && user.role !== 'superadmin' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {user.role === 'siswa' && (
                          <button 
                            onClick={() => setDetailStudent(user)}
                            style={{ 
                              padding: '6px 10px', border: 'none', borderRadius: '3px', 
                              fontSize: '11px', fontWeight: '600', cursor: 'pointer', color: 'white',
                              background: 'var(--blue)', transition: 'all 0.2s ease', width: '100%', textAlign: 'center'
                            }}
                            onMouseOver={(e) => { e.target.style.background = 'var(--blue-dark)'; e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 2px 4px rgba(30, 136, 229, 0.3)'; }}
                            onMouseOut={(e) => { e.target.style.background = 'var(--blue)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                          >
                            Detail
                          </button>
                        )}
                        <button 
                          onClick={() => { handleEditUser(user); setShowEditBiodataModal(true); }}
                          style={{ 
                            padding: '6px 10px', border: 'none', borderRadius: '3px', 
                            fontSize: '11px', fontWeight: '600', cursor: 'pointer', color: 'white',
                            background: '#00bcd4', transition: 'all 0.2s ease', width: '100%', textAlign: 'center'
                          }}
                          onMouseOver={(e) => { e.target.style.background = '#00acc1'; e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 2px 4px rgba(0, 188, 212, 0.3)'; }}
                          onMouseOut={(e) => { e.target.style.background = '#00bcd4'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteUser(user.id)}
                          style={{ 
                            padding: '6px 10px', border: 'none', borderRadius: '3px', 
                            fontSize: '11px', fontWeight: '600', cursor: 'pointer', color: 'white',
                            background: '#ef5350', transition: 'all 0.2s ease', width: '100%', textAlign: 'center'
                          }}
                          onMouseOver={(e) => { e.target.style.background = '#e53935'; e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 2px 4px rgba(239, 83, 80, 0.3)'; }}
                          onMouseOut={(e) => { e.target.style.background = '#ef5350'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                        >
                          Hapus
                        </button>
                      </div>
                    )}
                    {userRole === 'guru' && user.role === 'siswa' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <button 
                          onClick={() => setDetailStudent(user)}
                          style={{ 
                            padding: '6px 10px', border: 'none', borderRadius: '3px', 
                            fontSize: '11px', fontWeight: '600', cursor: 'pointer', color: 'white',
                            background: 'var(--blue)', transition: 'all 0.2s ease', width: '100%', textAlign: 'center'
                          }}
                          onMouseOver={(e) => { e.target.style.background = 'var(--blue-dark)'; e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 2px 4px rgba(30, 136, 229, 0.3)'; }}
                          onMouseOut={(e) => { e.target.style.background = 'var(--blue)'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                        >
                          Detail
                        </button>
                        <button 
                          onClick={() => { handleEditUser(user); setShowEditBiodataModal(true); }}
                          style={{ 
                            padding: '6px 10px', border: 'none', borderRadius: '3px', 
                            fontSize: '11px', fontWeight: '600', cursor: 'pointer', color: 'white',
                            background: '#00bcd4', transition: 'all 0.2s ease', width: '100%', textAlign: 'center'
                          }}
                          onMouseOver={(e) => { e.target.style.background = '#00acc1'; e.target.style.transform = 'translateY(-1px)'; e.target.style.boxShadow = '0 2px 4px rgba(0, 188, 212, 0.3)'; }}
                          onMouseOut={(e) => { e.target.style.background = '#00bcd4'; e.target.style.transform = 'translateY(0)'; e.target.style.boxShadow = 'none'; }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Bulk Actions */}
        {userRole === 'superadmin' && (
          <div style={{ display: 'flex', gap: '8px', paddingTop: '16px', borderTop: '1px solid #e0e0e0', marginBottom: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={selectAllFiltered}
              style={{
                padding: '6px 12px', border: '1px solid #d0d0d0', background: 'white', borderRadius: '3px',
                fontSize: '12px', cursor: 'pointer', color: '#333'
              }}
              onMouseOver={(e) => { e.target.style.background = '#f5f5f5'; e.target.style.borderColor = '#bbb'; }}
              onMouseOut={(e) => { e.target.style.background = 'white'; e.target.style.borderColor = '#d0d0d0'; }}
            >
              Pilih Semua
            </button>
            {selectedIds.length > 0 && (
              <>
                <button
                  onClick={handleBulkDelete}
                  style={{
                    padding: '6px 12px', border: '1px solid var(--border-color)', background: 'var(--danger-color)', borderRadius: '3px',
                    fontSize: '12px', cursor: 'pointer', color: 'white'
                  }}
                  onMouseOver={(e) => { e.target.style.background = 'var(--danger-dark)'; }}
                  onMouseOut={(e) => { e.target.style.background = 'var(--danger-color)'; }}
                >
                  Hapus ({selectedIds.length})
                </button>
                <button
                  onClick={clearSelection}
                  style={{
                    padding: '6px 12px', border: '1px solid #d0d0d0', background: 'white', borderRadius: '3px',
                    fontSize: '12px', cursor: 'pointer', color: '#333'
                  }}
                  onMouseOver={(e) => { e.target.style.background = '#f5f5f5'; e.target.style.borderColor = '#bbb'; }}
                  onMouseOut={(e) => { e.target.style.background = 'white'; e.target.style.borderColor = '#d0d0d0'; }}
                >
                  Batal
                </button>
              </>
            )}
          </div>
        )}
        {/* Pagination visible to superadmin and guru */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
          ...(userRole !== 'superadmin' ? { borderTop: '1px solid #e0e0e0', paddingTop: '16px' } : {})
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
            <label htmlFor="kelola-akun-limit">Baris per halaman:</label>
            <select
              id="kelola-akun-limit"
              value={pagination.limit}
              onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
              style={{
                padding: '6px 10px', border: '1px solid #d0d0d0', borderRadius: '4px',
                fontSize: '12px', background: 'white', color: '#333', cursor: 'pointer'
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => fetchUsers(pagination.page - 1)}
              disabled={pagination.page <= 1 || loading || refreshing}
              style={{
                padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                fontSize: '12px', cursor: pagination.page <= 1 || loading || refreshing ? 'not-allowed' : 'pointer',
                background: pagination.page <= 1 || loading || refreshing ? '#f5f5f5' : 'white',
                color: pagination.page <= 1 || loading || refreshing ? '#999' : '#333'
              }}
            >
              ← Sebelumnya
            </button>
            {getPageNumbers().map((p, idx) => (
              p === '...' ? (
                <span key={`ellipsis-${idx}`} style={{ fontSize: '12px', color: '#999', padding: '0 2px' }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => fetchUsers(p)}
                  disabled={loading || refreshing || p === pagination.page}
                  style={{
                    minWidth: '30px', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: '4px',
                    fontSize: '12px', cursor: loading || refreshing || p === pagination.page ? 'default' : 'pointer',
                    background: p === pagination.page ? 'var(--blue)' : 'white',
                    color: p === pagination.page ? 'white' : '#333',
                    fontWeight: p === pagination.page ? '700' : '400'
                  }}
                >
                  {p}
                </button>
              )
            ))}
            <button
              onClick={() => fetchUsers(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages || loading || refreshing}
              style={{
                padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                fontSize: '12px', cursor: pagination.page >= pagination.totalPages || loading || refreshing ? 'not-allowed' : 'pointer',
                background: pagination.page >= pagination.totalPages || loading || refreshing ? '#f5f5f5' : 'white',
                color: pagination.page >= pagination.totalPages || loading || refreshing ? '#999' : '#333'
              }}
            >
              Selanjutnya →
            </button>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
          Menampilkan {users.length} dari {pagination.total} pengguna (Halaman {pagination.page} dari {pagination.totalPages})
          {refreshing && <span style={{ marginLeft: '8px', color: 'var(--blue)' }}>Memuat…</span>}
        </div>
        {userRole === 'superadmin' && selectionRole && (
          <p style={{ fontSize: '13px', color: '#666', marginTop: '12px' }}>
            Mode pilihan: <strong>{selectionRole === 'siswa' ? 'Siswa' : 'Guru & Pegawai'}</strong> - hanya role yang sama yang bisa dipilih.
          </p>
        )}
      </div>

      {detailStudent && (
        <StudentDetail student={detailStudent} onClose={() => setDetailStudent(null)} />
      )}

      {/* Create Account Modal */}
      {showCreateModal && (
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
            <h3>{createModalType === 'student' ? 'Buat Akun Siswa' : 'Buat Akun Guru'}</h3>
            <button className="btn btn-danger" onClick={() => { setShowCreateModal(false); setFormData({}); }} style={{ marginBottom: '10px' }}>Tutup</button>

            {createModalType === 'student' ? (
              <form onSubmit={handleCreateStudent}>
                <div className="form-group">
                  <label>Nama</label>
                  <input type="text" value={formData.nama || ''} onChange={(e) => setFormData({...formData, nama: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>NIS</label>
                  <input type="text" value={formData.nis || ''} onChange={(e) => setFormData({...formData, nis: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Kelas</label>
                  <select value={formData.jurusan || ''} onChange={(e) => setFormData({...formData, jurusan: e.target.value})} required>
                    <option value="" disabled hidden>Pilih Kelas</option>
                    <option value="TKJ 1">TKJ 1</option>
                    <option value="TKJ 2">TKJ 2</option>
                    <option value="DPIB 1">DPIB 1</option>
                    <option value="DPIB 2">DPIB 2</option>
                    <option value="TKR 1">TKR 1</option>
                    <option value="TKR 2">TKR 2</option>
                  </select>
                  <small style={{ color: '#666', fontSize: '12px' }}>Kelas akan dihitung otomatis berdasarkan tahun pelajaran</small>
                </div>
                <div className="form-group">
                  <label>Grha</label>
                  <select value={formData.grha || ''} onChange={(e) => setFormData({...formData, grha: e.target.value})}>
                    <option value="" disabled hidden>Pilih Grha</option>
                    {grhaOptions.map(grha => (
                      <option key={grha} value={grha}>{grha}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Tahun Pelajaran (Masuk)</label>
                  <select value={formData.tahun_pelajaran || ''} onChange={(e) => setFormData({...formData, tahun_pelajaran: e.target.value})} required>
                    <option value="" disabled hidden>Pilih Tahun Pelajaran</option>
                    {(() => {
                      // Opsi tahun pelajaran dari 2024-2025 sampai 2034-2035
                      const options = [];
                      for (let year = 2024; year <= 2034; year++) {
                        options.push(`${year}-${year + 1}`);
                      }
                      return options.map(year => (
                        <option key={year} value={year}>{year}</option>
                      ));
                    })()}
                  </select>
                  <small style={{ color: '#666', fontSize: '12px' }}>Tahun pelajaran saat siswa pertama kali masuk sekolah</small>
                </div>

                {/* Preview Kelas */}
                {formData.tahun_pelajaran && formData.jurusan && (
                  <div className="form-group" style={{
                    background: '#e3f2fd',
                    padding: '12px',
                    borderRadius: '4px',
                    border: '1px solid #2196f3'
                  }}>
                    <strong style={{ color: '#1976d2', display: 'flex', alignItems: 'center', gap: 6, marginBottom: '5px' }}>
                      <BookOpen size={15} /> Preview Kelas yang Akan Dibuat:
                    </strong>
                    <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#0d47a1' }}>
                      {(() => {
                        const currentYear = new Date().getFullYear();
                        const currentMonth = new Date().getMonth();
                        const currentAcademicYear = currentMonth >= 6 
                          ? `${currentYear}-${currentYear + 1}` 
                          : `${currentYear - 1}-${currentYear}`;
                        
                        const [enrollStart] = formData.tahun_pelajaran.split('-').map(Number);
                        const [currentStart] = currentAcademicYear.split('-').map(Number);
                        const yearsSinceEnrollment = currentStart - enrollStart;
                        
                        let classLevel = '';
                        let statusColor = '#0d47a1';
                        let statusText = '';
                        
                        switch (yearsSinceEnrollment) {
                          case 0: 
                            classLevel = 'X'; 
                            statusText = 'Kelas X (Tahun Pertama)';
                            break;
                          case 1: 
                            classLevel = 'XI'; 
                            statusText = 'Kelas XI (Tahun Kedua)';
                            break;
                          case 2: 
                            classLevel = 'XII'; 
                            statusText = 'Kelas XII (Tahun Ketiga)';
                            break;
                          default: 
                            classLevel = 'Lulus';
                            statusColor = '#c62828';
                            statusText = 'SUDAH LULUS';
                        }
                        
                        if (classLevel === 'Lulus') {
                          return (
                            <div>
                              <span style={{ color: statusColor, fontSize: '18px' }}>
                                {classLevel}
                              </span>
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                                {statusText} - Siswa tidak akan muncul di kelas aktif
                              </div>
                            </div>
                          );
                        }
                        
                        return (
                          <div>
                            <span style={{ color: statusColor, fontSize: '18px' }}>
                              {classLevel} {formData.jurusan}
                            </span>
                            <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                              {statusText}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                    <small style={{ color: '#666', fontSize: '11px' }}>
                      Kelas dihitung otomatis berdasarkan tahun pelajaran masuk dan tahun ajaran saat ini ({(() => {
                        const currentYear = new Date().getFullYear();
                        const currentMonth = new Date().getMonth();
                        return currentMonth >= 6 
                          ? `${currentYear}-${currentYear + 1}` 
                          : `${currentYear - 1}-${currentYear}`;
                      })()})
                    </small>
                  </div>
                )}
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={formData.password || ''} onChange={(e) => setFormData({...formData, password: e.target.value})} required />
                </div>
                <button type="submit" className="btn btn-primary">Buat Akun Siswa</button>
              </form>
            ) : (
              <form onSubmit={handleCreateTeacher}>
                <div className="form-group">
                  <label>Nama</label>
                  <input type="text" value={formData.nama || ''} onChange={(e) => setFormData({...formData, nama: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>NIP</label>
                  <input type="text" value={formData.nip || ''} onChange={(e) => setFormData({...formData, nip: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label>Jabatan</label>
                  <select value={formData.jabatan || ''} onChange={(e) => setFormData({...formData, jabatan: e.target.value})} required>
                    <option value="" disabled hidden>Pilih Jabatan</option>
                    {JABATAN_OPTIONS.map((jabatan) => (
                      <option key={jabatan} value={jabatan}>{jabatan}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>No HP</label>
                  <input type="text" value={formData.no_hp || ''} onChange={(e) => setFormData({...formData, no_hp: e.target.value})} />
                </div>
                <div className="form-group">
                  <label>Password</label>
                  <input type="password" value={formData.password || ''} onChange={(e) => setFormData({...formData, password: e.target.value})} required />
                </div>
                <button type="submit" className="btn btn-success">Buat Akun Guru</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Import Modal */}
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
            <h4>Import {importModalType === 'siswa' ? 'Siswa' : 'Guru'} dari Excel</h4>
            <button className="btn btn-danger" onClick={() => { setShowImportModal(false); setExcelFile(null); setImportResults([]); }} style={{ marginBottom: '10px' }}>Tutup</button>
            <div style={{ marginBottom: '15px' }}>
              <button
                className="btn btn-secondary"
                onClick={() => downloadTemplate(importModalType)}
                style={{ marginBottom: '10px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Download size={14} /> Download Template {importModalType === 'siswa' ? 'Siswa' : 'Guru'}
              </button>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleExcelFileChange}
                style={{ marginBottom: '10px' }}
              />
              <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                {importModalType === 'siswa' ? (
                  <div>
                    <strong>Format Siswa:</strong> nama, nis, jurusan, grha, tahun_pelajaran, password
                    <br />
                    <small style={{ color: '#1976d2', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <Lightbulb size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>Kelas akan dihitung otomatis berdasarkan tahun_pelajaran dan jurusan.
                      Download template untuk melihat contoh.</span>
                    </small>
                  </div>
                ) : (
                  <div>
                    <strong>Format Guru:</strong> nama, nip, jabatan (Guru/Pegawai), no_hp, password
                  </div>
                )}
              </div>
              <button
                className="btn btn-primary"
                onClick={() => handleExcelImport(importModalType)}
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
                      <th style={{ padding: '5px' }}>Nama</th>
                      <th style={{ padding: '5px' }}>Kelas</th>
                      <th style={{ padding: '5px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.map((result, index) => (
                      <tr key={index}>
                        <td style={{ padding: '5px' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{result.status === 'success' ? <CircleCheck size={14} /> : <CircleX size={14} />} {result.name}</span>
                          {result.status === 'success' && result.username && (
                            <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>Username: <strong>{result.username}</strong></div>
                          )}
                        </td>
                        <td style={{ padding: '5px' }}>
                          {result.status === 'success' && result.expectedClass ? (
                            <div>
                              <span style={{ 
                                backgroundColor: result.expectedClass === 'Lulus' ? 'var(--danger-bg)' : 'var(--blue-light)',
                                color: result.expectedClass === 'Lulus' ? 'var(--danger-dark)' : 'var(--blue)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                display: 'block'
                              }}>
                                {result.expectedClass}
                              </span>
                              <small style={{ fontSize: '10px', color: '#666' }}>
                                {result.statusText}
                              </small>
                            </div>
                          ) : '-'}
                        </td>
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

      {/* Export Modal */}
      {showExportModal && (
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
            <h4>Export Data Pengguna ke Excel</h4>
            <button className="btn btn-danger" onClick={() => setShowExportModal(false)} style={{ marginBottom: '10px' }}>Tutup</button>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
              Data mengikuti pencarian &amp; filter yang sedang aktif. Hilangkan centang pada kolom yang tidak ingin diekspor.
            </div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button className="btn btn-secondary" onClick={() => setExcludedCols(new Set())} style={{ fontSize: '12px' }}>
                Pilih Semua
              </button>
              <button className="btn btn-secondary" onClick={() => setExcludedCols(new Set(EXPORT_COLUMNS.map((c) => c.key)))} style={{ fontSize: '12px' }}>
                Kosongkan
              </button>
            </div>
            <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '10px', marginBottom: '12px', maxHeight: '300px', overflowY: 'auto' }}>
              {EXPORT_COLUMNS.map((col) => (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', padding: '4px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!excludedCols.has(col.key)}
                    onChange={() => toggleExportCol(col.key)}
                  />
                  {col.header}
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={handleExportExcel}
              disabled={exporting || excludedCols.size >= EXPORT_COLUMNS.length}
            >
              {exporting ? 'Mengekspor...' : `Export (${EXPORT_COLUMNS.length - excludedCols.size} kolom)`}
            </button>
          </div>
        </div>
      )}

      {/* Edit Biodata Modal */}
      {showEditBiodataModal && (
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
            <h3>Edit Data {editStudent?.role === 'siswa' ? 'Siswa' : 'Guru'}</h3>
            <button className="btn btn-danger" onClick={() => { setShowEditBiodataModal(false); setEditStudent(null); setFormData({}); }} style={{ marginBottom: '10px' }}>Tutup</button>

            <form onSubmit={handleUpdateUser}>
              <div className="form-group">
                <label>Nama</label>
                <input type="text" value={formData.nama || ''} onChange={(e) => setFormData({...formData, nama: e.target.value})} required />
              </div>
              {userRole === 'superadmin' && (
                <div className="form-group">
                  <label>Username</label>
                  <input type="text" value={formData.username || ''} onChange={(e) => setFormData({...formData, username: e.target.value})} required />
                  <small style={{ color: '#666', fontSize: '12px' }}>5-20 karakter: huruf, angka, dan !@#_ (tanpa spasi). Mengubah username akan mengubah login akun tersebut.</small>
                </div>
              )}
              
              {editStudent?.role === 'siswa' ? (
                <>
                  <div className="form-group">
                    <label>NIS</label>
                    <input type="text" value={formData.nis || ''} onChange={(e) => setFormData({...formData, nis: e.target.value})} required />
                  </div>
                  <div className="form-group">
                  </div>
                  <div className="form-group">
                    <label>Kelas</label>
                    <select value={formData.jurusan || ''} onChange={(e) => setFormData({...formData, jurusan: e.target.value})} required>
                      <option value="" disabled hidden>Pilih Kelas</option>
                      <option value="TKJ 1">TKJ 1</option>
                      <option value="TKJ 2">TKJ 2</option>
                      <option value="DPIB 1">DPIB 1</option>
                      <option value="DPIB 2">DPIB 2</option>
                      <option value="TKR 1">TKR 1</option>
                      <option value="TKR 2">TKR 2</option>
                    </select>
                    <small style={{ color: '#666', fontSize: '12px' }}>Kelas akan dihitung otomatis berdasarkan tahun pelajaran</small>
                  </div>
                  <div className="form-group">
                    <label>Grha</label>
                    <select value={formData.grha || ''} onChange={(e) => setFormData({...formData, grha: e.target.value})}>
                      <option value="" disabled hidden>Pilih Grha</option>
                      {grhaOptions.map(grha => (
                        <option key={grha} value={grha}>{grha}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Tahun Pelajaran (Masuk)</label>
                    <select value={formData.tahun_pelajaran || ''} onChange={(e) => setFormData({...formData, tahun_pelajaran: e.target.value})} required>
                      <option value="" disabled hidden>Pilih Tahun Pelajaran</option>
                      {(() => {
                        const options = [];
                        for (let year = 2024; year <= 2034; year++) {
                          options.push(`${year}-${year + 1}`);
                        }
                        return options.map(year => (
                          <option key={year} value={year}>{year}</option>
                        ));
                      })()}
                    </select>
                    <small style={{ color: '#666', fontSize: '12px' }}>Tahun pelajaran saat siswa pertama kali masuk sekolah</small>
                  </div>
                </>
              ) : (
                <> 
                  <div className="form-group">
                    <label>NIP</label>
                    <input type="text" value={formData.nip || ''} onChange={(e) => setFormData({...formData, nip: e.target.value})} required />
                  </div>
                  <div className="form-group">
                    <label>Jabatan</label>
                    <select value={formData.jabatan || ''} onChange={(e) => setFormData({...formData, jabatan: e.target.value})} required>
                      <option value="" disabled hidden>Pilih Jabatan</option>
                      {!JABATAN_OPTIONS.includes(formData.jabatan) && formData.jabatan ? (
                        <option value={formData.jabatan}>{formData.jabatan} (lama)</option>
                      ) : null}
                      {JABATAN_OPTIONS.map((jabatan) => (
                        <option key={jabatan} value={jabatan}>{jabatan}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>No HP</label>
                    <input type="text" value={formData.no_hp || ''} onChange={(e) => setFormData({...formData, no_hp: e.target.value})} />
                  </div>
                </>
              )}
              <button type="submit" className="btn btn-primary">Update Data</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default KelolaAkun;
