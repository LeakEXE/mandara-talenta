import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { RefreshCw, ListChecks, User, Search, BadgeCheck } from 'lucide-react';
import { CATEGORY_ICONS, CategoryIcon } from './icons';

const PAGE_SIZES = [25, 50, 100];

function IzinAkun() {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [filters, setFilters] = useState({
    role: [],
    kelas: [],
    grha: []
  });
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState(new Set());
  // Role of the current multi-select session (mirrors /kelola-akun):
  // locked to the first selected user's role; cleared when selection empties.
  const [selectionRole, setSelectionRole] = useState(null);

  const jenisInputs = [
    { key: 'prestasi', label: 'Prestasi', icon: CATEGORY_ICONS.prestasi },
    { key: 'organisasi', label: 'Organisasi', icon: CATEGORY_ICONS.organisasi },
    { key: 'kepanitiaan', label: 'Kepanitiaan', icon: CATEGORY_ICONS.kepanitiaan },
    { key: 'event', label: 'Event', icon: CATEGORY_ICONS.event },
    { key: 'pelanggaran', label: 'Pelanggaran', icon: CATEGORY_ICONS.pelanggaran },
    { key: 'perilaku', label: 'Perilaku', icon: CATEGORY_ICONS.perilaku }
  ];

  // Pelanggaran & Perilaku are guru-only (students never receive these permissions)
  const GURU_ONLY_KEYS = ['pelanggaran', 'perilaku'];

  const kelasOptions = [
    'X TKJ 1', 'X TKJ 2', 'X TKR 1', 'X TKR 2',
    'X DPIB 1', 'X DPIB 2',
    'XI TKJ 1', 'XI TKJ 2', 'XI TKR 1', 'XI TKR 2',
    'XI DPIB 1', 'XI DPIB 2',
    'XII TKJ 1', 'XII TKJ 2', 'XII TKR 1', 'XII TKR 2',
    'XII DPIB 1', 'XII DPIB 2'
  ];

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const ROLE_OPTIONS = [
    { key: 'superadmin', label: 'Superadmin' },
    { key: 'guru', label: 'Guru' },
    { key: 'pegawai', label: 'Pegawai' },
    { key: 'siswa', label: 'Siswa' }
  ];

  // All filters are multi-select (checkbox groups)
  const toggleArrayFilter = (key, value) => {
    setFilters(prev => ({
      ...prev,
      [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value]
    }));
    setPage(1);
  };

  const toggleRoleFilter = (role) => toggleArrayFilter('role', role);

  const resetFilters = () => {
    setFilters({ role: [], kelas: [], grha: [] });
    setSearchQuery('');
    setPage(1);
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    let filtered = users;

    // Apply search query
    if (searchQuery) {
      filtered = filtered.filter(user =>
        user.nama?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.nis?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.nip?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Apply filters
    if (filters.role.length > 0) {
      filtered = filtered.filter(user => filters.role.includes(user.role));
    }
    if (filters.kelas.length > 0) {
      filtered = filtered.filter(user => filters.kelas.includes(user.kelas));
    }
    if (filters.grha.length > 0) {
      filtered = filtered.filter(user => filters.grha.includes(user.grha));
    }

    setFilteredUsers(filtered);
  }, [searchQuery, filters, users]);

  // Keep page in range when search/filter shrinks the result set
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / limit));
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pagedUsers = filteredUsers.slice((page - 1) * limit, page * limit);
  const from = filteredUsers.length === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, filteredUsers.length);

  const getPageNumbers = () => {
    const total = totalPages || 0;
    const current = page || 1;
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

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setPage(1);
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get('/input-access/admin/users');
      setUsers(response.data);
      setFilteredUsers(response.data);
      // Selection is intentionally preserved across refreshes (stored as user IDs).
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  // Update Individual User Access
  const handleIndividualUpdate = async (userId, permissions) => {
    try {
      await api.post('/input-access/admin/individual', {
        user_id: userId,
        permissions: permissions
      });
      
      // Update local state
      setUsers(prev => prev.map(user => 
        user.id === userId ? { ...user, ...permissions } : user
      ));
      
      setMessage('✅ Izin individual berhasil diupdate!');
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('❌ Gagal update izin individual');
    }
  };

  const handleIndividualToggle = (user, jenis) => {
    const permKey = `can_input_${jenis}`;
    const newValue = !user[permKey];

    const newPermissions = {
      can_input_prestasi: user.can_input_prestasi,
      can_input_organisasi: user.can_input_organisasi,
      can_input_kepanitiaan: user.can_input_kepanitiaan,
      can_input_event: user.can_input_event,
      can_input_pelanggaran: user.can_input_pelanggaran,
      can_input_perilaku: user.can_input_perilaku,
      [permKey]: newValue
    };

    handleIndividualUpdate(user.id, newPermissions);
  };

  const APPROVAL_JENIS = [
    { key: 'prestasi', label: 'Prestasi' },
    { key: 'organisasi', label: 'Organisasi' },
    { key: 'kepanitiaan', label: 'Kepanitiaan' },
    { key: 'event', label: 'Event' },
    { key: 'pelanggaran', label: 'Pelanggaran' }
  ];

  // Multiselect modal state: which user is being edited + draft scopes
  const [scopeModalUser, setScopeModalUser] = useState(null);
  const [scopeDraft, setScopeDraft] = useState([]);
  const [savingScopes, setSavingScopes] = useState(false);

  const openScopeModal = (user) => {
    setScopeModalUser(user);
    setScopeDraft(user.approval_scopes || []);
  };

  const toggleScopeDraft = (jenis) => {
    setScopeDraft((prev) =>
      prev.includes(jenis) ? prev.filter((j) => j !== jenis) : [...prev, jenis]
    );
  };

  const handleScopeSave = async () => {
    if (!scopeModalUser) return;
    try {
      setSavingScopes(true);
      const res = await api.put(`/input-access/admin/approval-scopes/${scopeModalUser.id}`, {
        jenis: scopeDraft
      });
      setUsers((prev) => prev.map((u) =>
        u.id === scopeModalUser.id ? { ...u, approval_scopes: res.data.scopes } : u
      ));
      setMessage('✅ Izin approval berhasil diupdate!');
      setTimeout(() => setMessage(''), 3000);
      setScopeModalUser(null);
    } catch (error) {
      setMessage('❌ ' + (error.response?.data?.message || 'Gagal update izin approval'));
    } finally {
      setSavingScopes(false);
    }
  };

  // Reset all permissions
  const handleResetAll = async () => {
    if (!window.confirm('PERINGATAN!\n\nIni akan menghapus SEMUA individual permissions DAN semua izin approval, serta mereset izin ke default (semua input aktif untuk semua user).\n\nYakin ingin melanjutkan?')) {
      return;
    }
    
    try {
      const response = await api.post('/input-access/admin/reset-all', {});
      
      setMessage(`✅ ${response.data.message}`);
      
      // Refresh users
      fetchUsers();
      
      setTimeout(() => setMessage(''), 5000);
    } catch (error) {
      setMessage('❌ Gagal reset izin: ' + (error.response?.data?.message || error.message));
    }
  };

  // Toggle one user in the multi-select set (mirrors /kelola-akun:
  // superadmin can never be selected; once a role is picked, other roles grey out)
  const handleToggleSelect = (user) => {
    if (user.role === 'superadmin') {
      return;
    }
    if (selectedUserIds.has(user.id)) {
      const next = new Set(selectedUserIds);
      next.delete(user.id);
      setSelectedUserIds(next);
      if (next.size === 0) {
        setSelectionRole(null);
      }
      return;
    }
    if (selectionRole && user.role !== selectionRole) {
      return;
    }
    if (selectedUserIds.size === 0) {
      setSelectionRole(user.role);
    }
    const next = new Set(selectedUserIds);
    next.add(user.id);
    setSelectedUserIds(next);
  };

  const isUserSelectable = (user) => user.role !== 'superadmin';

  const isUserDisabled = (user) => {
    if (!isUserSelectable(user)) return true;
    if (!selectionRole) return false;
    return user.role !== selectionRole;
  };

  // Select all selectable users on the current page (mirrors /kelola-akun,
  // where "Pilih Semua" selects the current backend page).
  // Selection is ID-based so it persists across pages.
  const handleSelectAllVisible = () => {
    const selectable = pagedUsers.filter(isUserSelectable);
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      selectable.forEach((u) => next.add(u.id));
      return next;
    });
    setSelectionRole(null);
  };

  // Selection across ALL filtered users (every page), not just the visible
  // one — for bulk actions on hundreds of accounts at once.
  const handleSelectAllFiltered = () => {
    const selectable = filteredUsers.filter(isUserSelectable);
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      selectable.forEach((u) => next.add(u.id));
      return next;
    });
    setSelectionRole(null);
  };

  const handleClearSelection = () => {
    setSelectedUserIds(new Set());
    setSelectionRole(null);
  };

  // Derived: which users are currently selected (used for guru-only bulk button gating)
  // Guru-only permissions require a guru-ONLY selection: if even one siswa is
  // selected, the "Aktifkan Pelanggaran/Perilaku" buttons stay disabled.
  const selectedUsers = users.filter(u => selectedUserIds.has(u.id));
  const onlyGuruSelected = selectedUsers.length > 0 && selectedUsers.every(u => u.role === 'guru' || u.role === 'pegawai');

  // Bulk update ONE permission type, but only for the explicitly selected users
  const handleBulkSelectedUpdate = async (jenis, enable) => {
    if (bulkUpdating) return; // Prevent multiple simultaneous updates

    if (selectedUserIds.size === 0) {
      setMessage('❌ Pilih minimal satu user lewat checkbox terlebih dahulu');
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    // Guru-only permissions can never be granted to students, so a mixed
    // selection (guru + siswa) cannot use the enable buttons at all
    // deselect the siswa first. The backend enforces the same rule.
    if (enable && GURU_ONLY_KEYS.includes(jenis) && !onlyGuruSelected) {
      setMessage('⚠️ Pelanggaran & Perilaku hanya dapat diaktifkan untuk guru saja - hapus siswa dari pilihan Anda terlebih dahulu');
      setTimeout(() => setMessage(''), 4000);
      return;
    }

    setBulkUpdating(true);
    try {
      const jenisLabel = jenisInputs.find(j => j.key === jenis)?.label || jenis;

      const response = await api.post('/input-access/admin/bulk', {
        user_ids: [...selectedUserIds],
        jenis,
        enable
      });

      const skippedSiswa = response.data.skipped_siswa_count || 0;
      const skipNote = skippedSiswa > 0 ? ` (${skippedSiswa} siswa dilewati - khusus guru)` : '';
      setMessage(`✅ ${jenisLabel} ${enable ? 'diaktifkan' : 'dimatikan'} untuk ${response.data.success_count} user terpilih!${skipNote}`);
      await fetchUsers(); // Refresh user list (also clears selection)
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage('❌ Gagal update bulk: ' + (error.response?.data?.message || error.message));
      setTimeout(() => setMessage(''), 3000);
    } finally {
      setBulkUpdating(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div className="izin-scope" style={{ fontFamily: 'var(--font-sans)', background: 'transparent', padding: '4px 4px 40px', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--card-radius)', padding: '24px', boxShadow: 'var(--shadow-card)' }}>
      <style>{`
        .izin-scope{
          --blue:var(--blue);
          --blue-dark:var(--blue-dark);
          --green:var(--success-color);
          --green-dark:#059669;
          --red:var(--danger-color);
          --red-dark:var(--danger-dark);
          --gray-50:var(--bg-secondary);
          --gray-100:var(--bg-tertiary);
          --gray-200:var(--border-color);
          --gray-400:var(--muted-light);
          --gray-500:var(--slate);
          --gray-700:var(--text-primary);
          --gray-900:var(--ink);
          --radius:var(--card-radius);
          --radius-sm:var(--border-radius-sm);
          --shadow:var(--shadow-card);
          --shadow-hover:var(--shadow-md);
        }
        .btn-outline{background:#fff; border:1px solid var(--gray-200); color:var(--gray-700);}
        .btn-sm{padding:7px 12px; font-size:.78rem;}
        .chip-btn{
          border:none;
          border-radius:var(--radius-sm);
          padding:10px 16px;
          font-size:14px;
          font-weight:500;
          color:#fff;
          cursor:pointer;
          display:flex;
          align-items:center;
          gap:6px;
          min-height:42px;
          transition:all 0.3s ease;
        }
        .chip-btn:hover{filter:brightness(0.92);}
        .chip-btn:active{transform:translateY(0);}
        .chip-btn.on{background:var(--green);}
        .chip-btn.off{background:var(--red);}
        .chip-btn:disabled{opacity:0.6; cursor:not-allowed;}
        .chip-btn .ic{
          width:16px; height:16px;
          display:inline-flex; align-items:center; justify-content:center;
          font-size:11px;
          background:rgba(255,255,255,.25);
          border-radius:4px;
          flex-shrink:0;
        }
        .main-card{
          display:flex;
          flex-direction:column;
          gap:16px;
          margin-bottom:24px;
        }
        .main-card-title{
          font-weight:600;
          font-size:18px;
          color:var(--gray-900);
          line-height:1.3;
          display:flex;
          align-items:center;
          gap:8px;
        }
        .main-card-title svg,.bulk-panel-title svg,.search-box .ic svg,thead th .th-ic svg{display:block;flex-shrink:0;}
        .main-card-sub{
          margin:8px 0 0;
          font-size:13px;
          color:var(--gray-500);
          line-height:1.55;
        }
        .bulk-grid{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:18px;
        }
        .bulk-panel{
          border-radius:var(--radius);
          padding:16px;
          border:1px solid var(--gray-200);
          background:var(--gray-50);
          display:flex;
          flex-direction:column;
          gap:12px;
        }
        .bulk-panel.siswa{
          background:var(--gray-50);
          border-color:var(--gray-200);
        }
        .bulk-panel.guru{
          background:var(--gray-50);
          border-color:var(--gray-200);
        }
        .bulk-panel-title{
          font-weight:600;
          font-size:14px;
          color:var(--gray-900);
        }
        .bulk-panel.siswa .bulk-panel-title{color:var(--gray-900);}
        .bulk-panel.guru .bulk-panel-title{color:var(--gray-900);}
        .bulk-panel.unified{
          background:var(--gray-50);
          border-color:var(--gray-200);
          grid-column:span 2;
        }
        .bulk-panel.unified .bulk-panel-title{color:var(--gray-900);}
        .select-checkbox{
          width:17px;
          height:17px;
          padding:0;
          margin:0;
          accent-color:var(--blue);
          cursor:pointer;
          vertical-align:middle;
        }
        input[type="checkbox"]{
          width:auto;
          padding:0;
          margin:0;
          flex-shrink:0;
        }
        tbody tr.row-selected{background:#eff6ff;}
        tbody tr.row-selected:hover{background:#dbeafe;}
        .chip-flow{
          display:grid;
          grid-template-columns:1fr 1fr;
          gap:10px;
        }
        .chip-flow .chip-btn{justify-content:center; min-width:0;}
        .filter-card{
          background:var(--gray-50);
          border:1px solid var(--gray-200);
          border-radius:var(--radius);
          padding:16px;
          display:flex;
          flex-direction:column;
          gap:14px;
          margin-bottom:24px;
        }
        .filter-title{font-weight:600; font-size:14px; color:var(--gray-900);}
        .filter-row{
          display:grid;
          grid-template-columns:1fr 1fr 1fr auto;
          gap:14px;
          align-items:end;
        }
        .field label{
          display:block;
          font-size:12px;
          font-weight:600;
          color:var(--gray-500);
          margin-bottom:6px;
        }
        select, input{
          font-family:inherit;
          font-size:14px;
          padding:10px 12px;
          border-radius:var(--radius-sm);
          border:1px solid #ddd;
          background:#fff;
          color:var(--gray-700);
          outline:none;
          width:100%;
          transition:border-color .15s ease, box-shadow .15s ease;
        }
        select:focus, input:focus{border-color:var(--blue); box-shadow:0 0 0 3px rgba(30,136,229,.12);}
        .search-box{
          position:relative;
        }
        .search-box .ic{
          position:absolute;
          left:14px;
          top:50%;
          transform:translateY(-50%);
          color:var(--gray-400);
          font-size:.9rem;
        }
        .search-box input{padding-left:38px;}
        .table-card{
          overflow-x:auto;
        }
        .table-wrap{overflow-x:auto;}
        table{
          width:100%;
          border-collapse:collapse;
          font-size:12px;
        }
        thead{background:var(--gray-50); border-bottom:1px solid #d0d0d0;}
        thead th{
          text-align:left;
          font-size:12px;
          font-weight:600;
          color:var(--gray-500);
          padding:13px 14px;
          white-space:nowrap;
        }
        thead th .th-ic{margin-right:4px;}
        tbody td{
          padding:13px 14px;
          font-size:12px;
          border-bottom:1px solid var(--gray-200);
          color:var(--gray-700);
          text-align:center;
        }
        tbody td.user-cell{text-align:left;}
        tbody tr{transition:background .12s ease;}
        tbody tr:last-child td{border-bottom:none;}
        tbody tr:hover{background:var(--gray-50);}
        .user-name{font-weight:600; color:var(--gray-900); font-size:13px;}
        .user-sub{font-size:12px; color:var(--gray-400); margin-top:1px;}
        .role-pill{
          display:inline-block;
          background:var(--gray-100);
          color:var(--gray-500);
          font-size:12px;
          font-weight:600;
          padding:3px 10px;
          border-radius:999px;
        }
        .toggle-cell{
          width:34px;
          height:34px;
          border-radius:4px;
          border:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          font-size:.8rem;
          color:#fff;
          cursor:pointer;
          transition:filter .15s ease;
        }
        .toggle-cell:hover{filter:brightness(0.92);}
        .toggle-cell:active{transform:scale(.95);}
        .toggle-cell.on{background:var(--green);}
        .toggle-cell.off{background:var(--red);}
        /* Approval-scope toggles: iOS-style switch, same look as KonfigurasiIPT .ipt-switch */
        .scope-switch{
          display:flex;
          align-items:center;
          gap:10px;
          cursor:pointer;
          font-weight:500;
          color:var(--gray-900);
        }
        /* Beat the file-global input[type="checkbox"] rule by specificity */
        .scope-switch input[type="checkbox"]{
          position:absolute;
          opacity:0;
          width:0;
          height:0;
          margin:0;
          padding:0;
          border:none;
          pointer-events:none;
        }
        .scope-switch-track{
          position:relative;
          width:44px;
          height:24px;
          border-radius:999px;
          background:#D7DBE4;
          transition:background .2s ease;
          flex-shrink:0;
        }
        .scope-switch-track::after{
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
        .scope-switch input:checked + .scope-switch-track{
          background:#10b981;
        }
        .scope-switch input:checked + .scope-switch-track::after{
          transform:translateX(20px);
        }
        .scope-switch input:focus-visible + .scope-switch-track{
          outline:2px solid #3B82F6;
          outline-offset:2px;
        }
        .scope-switch-label .when-on{ display:none; }
        .scope-switch-label .when-off{ display:inline; color:var(--gray-400); }
        .scope-switch input:checked ~ .scope-switch-label .when-on{ display:inline; }
        .scope-switch input:checked ~ .scope-switch-label .when-off{ display:none; }
        @media (max-width: 1024px){
          .bulk-grid{grid-template-columns:1fr;}
          .filter-row{grid-template-columns:1fr 1fr; }
          .filter-row .field:last-of-type{grid-column:span 2;}
        }
        @media (max-width: 480px){
          .bulk-panel{padding:14px;}
          .chip-flow{grid-template-columns:1fr 1fr; gap:8px;}
          .chip-btn{font-size:12px; padding:9px 8px; min-height:40px;}
          .filter-row{grid-template-columns:1fr;}
          .filter-row .field:last-of-type{grid-column:span 1;}
          .filter-row .btn-outline{width:100%; justify-content:center;}
          .filter-card{padding:16px;}
          table{min-width:760px;}
        }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: '#1a1a1a', margin: 0 }}>Izin Akses Input Data</h1>
          <p style={{ fontSize: '13px', color: '#666', margin: '8px 0 0' }}>Kelola izin input data per user</p>
        </div>
        <button
          onClick={handleResetAll}
          className="btn btn-danger"
          title="Hapus semua individual permissions dan kembali ke pengaturan default"
        >
          <RefreshCw size={14} /> Reset Izin
        </button>
      </div>

      {message && (
        <div style={{ padding: '12px 16px', background: message.startsWith('✅') ? 'var(--green-bg)' : 'var(--danger-bg)', border: message.startsWith('✅') ? '1px solid var(--success-color)' : '1px solid var(--danger-color)', borderRadius: '4px', color: message.startsWith('✅') ? 'var(--green-text)' : 'var(--danger-dark)', fontSize: '13px', marginBottom: '20px' }}>
          {message.replace(/^[✅❌⚠️]\s*/, '')}
        </div>
      )}

      {/* INDIVIDUAL CONTROL */}
      <>
          <div className="main-card">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="main-card-title">
                <User size={18} />
                Kontrol Individual
              </div>
              <p className="main-card-sub">
                Centang user pada tabel di bawah, lalu gunakan tombol bulk update - hanya user yang dicentang yang akan diupdate.
              </p>
            </div>

            {/* Unified bulk update - applies only to checked users */}
            <div className="bulk-grid">
              <div className="bulk-panel unified">
                <div className="bulk-panel-title"><ListChecks size={16} style={{ verticalAlign: '-3px', marginRight: '6px' }} />Bulk Update ({selectedUserIds.size} user dipilih)</div>
                <div className="chip-flow">
                  {jenisInputs.map(({ key, label }) => {
                    const baseDisabled = bulkUpdating || selectedUserIds.size === 0;
                    const enableBlocked = enable => enable && GURU_ONLY_KEYS.includes(key) && !onlyGuruSelected;
                    const enableDisabled = baseDisabled || enableBlocked(true);
                    return (
                      <React.Fragment key={key}>
                        <button
                          className="chip-btn on"
                          onClick={() => handleBulkSelectedUpdate(key, true)}
                          disabled={enableDisabled}
                          title={enableBlocked(true) ? 'Hanya untuk pilihan berisi guru saja - hapus siswa dari pilihan' : undefined}
                          style={{ opacity: enableDisabled ? 0.6 : 1, cursor: enableDisabled ? 'not-allowed' : 'pointer' }}
                        >
                          <span className="ic">✓</span>
                          <span>Aktifkan {label}</span>
                        </button>
                        <button
                          className="chip-btn off"
                          onClick={() => handleBulkSelectedUpdate(key, false)}
                          disabled={baseDisabled}
                          style={{ opacity: baseDisabled ? 0.6 : 1, cursor: baseDisabled ? 'not-allowed' : 'pointer' }}
                        >
                          <span className="ic">✕</span>
                          <span>Matikan {label}</span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="filter-card">
            <div className="filter-title">Filter</div>
            <div className="filter-row">
              <div className="field">
                <label>Role (multi-pilih)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 'var(--radius-sm)', background: '#fff' }}>
                  {ROLE_OPTIONS.map(({ key, label }) => (
                    <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: 'var(--gray-700)' }}>
                      <input
                        type="checkbox"
                        className="select-checkbox"
                        checked={filters.role.includes(key)}
                        onChange={() => toggleRoleFilter(key)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Kelas (multi-pilih)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 'var(--radius-sm)', background: '#fff', maxHeight: '132px', overflowY: 'auto' }}>
                  {kelasOptions.map((k) => (
                    <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: 'var(--gray-700)' }}>
                      <input
                        type="checkbox"
                        className="select-checkbox"
                        checked={filters.kelas.includes(k)}
                        onChange={() => toggleArrayFilter('kelas', k)}
                      />
                      {k}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Grha (multi-pilih)</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 'var(--radius-sm)', background: '#fff', maxHeight: '132px', overflowY: 'auto' }}>
                  {grhaOptions.map((g) => (
                    <label key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer', color: 'var(--gray-700)' }}>
                      <input
                        type="checkbox"
                        className="select-checkbox"
                        checked={filters.grha.includes(g)}
                        onChange={() => toggleArrayFilter('grha', g)}
                      />
                      {g}
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn btn-outline" onClick={resetFilters}>Reset</button>
            </div>
            <div className="search-box">
              <span className="ic"><Search size={15} /></span>
              <input
                type="text"
                placeholder="Cari nama, NIS, atau NIP..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              />
            </div>
          </div>

          {/* Selection bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '13px', color: '#666' }}>
            <strong>{selectedUserIds.size} user dipilih</strong>
            {selectedUserIds.size > 0 && selectionRole && (
              <span>Mode pilihan: <strong>{selectionRole === 'siswa' ? 'Siswa' : 'Guru'}</strong> - hanya role yang sama yang bisa dipilih.</span>
            )}
            <button className="btn btn-outline btn-sm" onClick={handleSelectAllVisible}>
              Pilih semua di halaman ini ({pagedUsers.filter(isUserSelectable).length})
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleSelectAllFiltered}>
              Pilih semua hasil filter ({filteredUsers.filter(isUserSelectable).length})
            </button>
            {selectedUserIds.size > 0 && (
              <button className="btn btn-outline btn-sm" onClick={handleClearSelection}>
                Hapus pilihan
              </button>
            )}
          </div>

          {/* Table */}
          <div className="table-card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '44px' }}>
                      <input
                        type="checkbox"
                        className="select-checkbox"
                        checked={pagedUsers.filter(isUserSelectable).length > 0 && pagedUsers.filter(isUserSelectable).every(u => selectedUserIds.has(u.id))}
                        ref={(el) => {
                          if (el) {
                            const selectable = pagedUsers.filter(isUserSelectable);
                            const someSelected = selectable.some(u => selectedUserIds.has(u.id));
                            const allSelected = selectable.length > 0 && selectable.every(u => selectedUserIds.has(u.id));
                            el.indeterminate = someSelected && !allSelected;
                          }
                        }}
                        onChange={() => {
                          const selectable = pagedUsers.filter(isUserSelectable);
                          const allSelected = selectable.length > 0 && selectable.every(u => selectedUserIds.has(u.id));
                          if (allSelected) {
                            const pageIds = new Set(selectable.map((u) => u.id));
                            const next = new Set([...selectedUserIds].filter((id) => !pageIds.has(id)));
                            setSelectedUserIds(next);
                            if (next.size === 0) {
                              setSelectionRole(null);
                            }
                          } else {
                            handleSelectAllVisible();
                          }
                        }}
                        title="Pilih semua di halaman ini"
                      />
                    </th>
                    <th>User</th>
                    <th>Role</th>
                    <th className="col-prestasi"><span className="th-ic"><CategoryIcon name="prestasi" size={14} /></span>Prestasi</th>
                    <th className="col-organisasi"><span className="th-ic"><CategoryIcon name="organisasi" size={14} /></span>Organisasi</th>
                    <th className="col-kepanitiaan"><span className="th-ic"><CategoryIcon name="kepanitiaan" size={14} /></span>Kepanitiaan</th>
                    <th className="col-event"><span className="th-ic"><CategoryIcon name="event" size={14} /></span>Event</th>
                    <th className="col-pelanggaran"><span className="th-ic"><CategoryIcon name="pelanggaran" size={14} /></span>Pelanggaran<br/><span style={{ fontWeight: 500 }}>(GURU ONLY)</span></th>
                    <th className="col-perilaku"><span className="th-ic"><CategoryIcon name="perilaku" size={14} /></span>Perilaku<br/><span style={{ fontWeight: 500 }}>(GURU ONLY)</span></th>
                    <th className="col-approval"><span className="th-ic"><BadgeCheck size={14} /></span>Approval<br/><span style={{ fontWeight: 500 }}>(GURU ONLY)</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pagedUsers.map(user => (
                    <tr key={user.id} className={selectedUserIds.has(user.id) ? 'row-selected' : ''} style={isUserDisabled(user) && selectionRole ? { opacity: 0.45 } : undefined}>
                      <td>
                        {isUserSelectable(user) ? (
                          <input
                            type="checkbox"
                            className="select-checkbox"
                            checked={selectedUserIds.has(user.id)}
                            disabled={isUserDisabled(user)}
                            onChange={() => handleToggleSelect(user)}
                          />
                        ) : (
                          <span style={{ color: '#999' }}>-</span>
                        )}
                      </td>
                      <td className="user-cell">
                        <div className="user-name">{user.nama}</div>
                        <div className="user-sub">{user.nis || user.nip || '-'}</div>
                      </td>
                      <td>
                        <span className="role-pill">{user.role}</span>
                      </td>
                      {/* Siswa only sees prestasi, organisasi, kepanitiaan, event (no pelanggaran/perilaku) */}
                      {user.role === 'siswa' ? (
                        <>
                          <td>
                            <button
                              onClick={() => handleIndividualToggle(user, 'prestasi')}
                              className={`toggle-cell ${user.can_input_prestasi ? 'on' : 'off'}`}
                            >
                              {user.can_input_prestasi ? '✓' : '✕'}
                            </button>
                          </td>
                          <td>
                            <button
                              onClick={() => handleIndividualToggle(user, 'organisasi')}
                              className={`toggle-cell ${user.can_input_organisasi ? 'on' : 'off'}`}
                            >
                              {user.can_input_organisasi ? '✓' : '✕'}
                            </button>
                          </td>
                          <td>
                            <button
                              onClick={() => handleIndividualToggle(user, 'kepanitiaan')}
                              className={`toggle-cell ${user.can_input_kepanitiaan ? 'on' : 'off'}`}
                            >
                              {user.can_input_kepanitiaan ? '✓' : '✕'}
                            </button>
                          </td>
                          <td>
                            <button
                              onClick={() => handleIndividualToggle(user, 'event')}
                              className={`toggle-cell ${user.can_input_event ? 'on' : 'off'}`}
                            >
                              {user.can_input_event ? '✓' : '✕'}
                            </button>
                          </td>
                          <td style={{ color: '#94a3b8' }}>-</td>
                          <td style={{ color: '#94a3b8' }}>-</td>
                          <td style={{ color: '#94a3b8' }} title="Siswa tidak dapat memiliki Izin Approval">-</td>
                        </>
                      ) : user.role === 'superadmin' ? (
                        <>
                          {jenisInputs.map(({ key }) => (
                            <td key={key} style={{ color: '#94a3b8' }}>-</td>
                          ))}
                          <td>
                            <span className="toggle-cell on" title="Superadmin selalu dapat menyetujui">✓</span>
                          </td>
                        </>
                      ) : (
                        /* Guru sees all 5 input columns + approval toggle */
                        [...jenisInputs.map(({ key }) => {
                          const permKey = `can_input_${key}`;
                          const isEnabled = user[permKey];
                          return (
                            <td key={key}>
                              <button
                                onClick={() => handleIndividualToggle(user, key)}
                                className={`toggle-cell ${isEnabled ? 'on' : 'off'}`}
                              >
                                {isEnabled ? '✓' : '✕'}
                              </button>
                            </td>
                          );
                        }),
                        <td key="approval">
                          <button
                            onClick={() => openScopeModal(user)}
                            className={`toggle-cell ${(user.approval_scopes?.length || 0) > 0 ? 'on' : 'off'}`}
                            title={`Izin menyetujui: ${(user.approval_scopes || []).join(', ') || 'tidak ada'} - klik untuk atur`}
                          >
                            {(user.approval_scopes?.length || 0) > 0 ? `${user.approval_scopes.length}/5` : '✕'}
                          </button>
                        </td>
                        ]
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredUsers.length === 0 && (
              <div style={{ textAlign: 'center', color: '#94a3b8', padding: '26px' }}>
                Tidak ada data yang cocok
              </div>
            )}
          </div>

          {/* Pagination same pattern as /kelola-akun (client-side slice) */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
            borderTop: '1px solid #e0e0e0', paddingTop: '16px', marginTop: '16px'
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
              <label htmlFor="izin-akun-limit">Baris per halaman:</label>
              <select
                id="izin-akun-limit"
                value={limit}
                onChange={(e) => handleLimitChange(parseInt(e.target.value, 10))}
                style={{
                  padding: '6px 10px', border: '1px solid #d0d0d0', borderRadius: '4px',
                  fontSize: '12px', background: 'white', color: '#333', cursor: 'pointer', width: 'auto'
                }}
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                style={{
                  padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                  fontSize: '12px', cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  background: page <= 1 ? '#f5f5f5' : 'white',
                  color: page <= 1 ? '#999' : '#333'
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
                    onClick={() => setPage(p)}
                    disabled={p === page}
                    style={{
                      minWidth: '30px', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: '4px',
                      fontSize: '12px', cursor: p === page ? 'default' : 'pointer',
                      background: p === page ? 'var(--blue)' : 'white',
                      color: p === page ? 'white' : '#333',
                      fontWeight: p === page ? '700' : '400'
                    }}
                  >
                    {p}
                  </button>
                )
              ))}
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                style={{
                  padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                  fontSize: '12px', cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                  background: page >= totalPages ? '#f5f5f5' : 'white',
                  color: page >= totalPages ? '#999' : '#333'
                }}
              >
                Selanjutnya →
              </button>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
            Menampilkan {from}&ndash;{to} dari {filteredUsers.length} pengguna (Halaman {page} dari {totalPages})
          </div>

          {/* Approval scope multiselect modal */}
          {scopeModalUser && (
            <div className="app-modal-overlay" style={{
              position: 'fixed',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1500
            }}>
              <div className="card" style={{ width: 420, maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto' }}>
                <h4 style={{ marginTop: 0 }}>Izin Approval - {scopeModalUser.nama}</h4>
                <button className="btn btn-danger" onClick={() => setScopeModalUser(null)} style={{ marginBottom: '10px' }}>Tutup</button>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>
                  Pilih jenis pengajuan yang boleh disetujui. Kosongkan semua untuk mencabut izin approval.
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                  <button className="btn btn-secondary" onClick={() => setScopeDraft(APPROVAL_JENIS.map((j) => j.key))} style={{ fontSize: '12px' }}>
                    Pilih Semua
                  </button>
                  <button className="btn btn-secondary" onClick={() => setScopeDraft([])} style={{ fontSize: '12px' }}>
                    Kosongkan
                  </button>
                </div>
                <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '6px 10px', marginBottom: '12px' }}>
                  {APPROVAL_JENIS.map((j) => (
                    <label key={j.key} className="scope-switch" style={{ fontSize: '13px', padding: '8px 0' }}>
                      <input
                        type="checkbox"
                        checked={scopeDraft.includes(j.key)}
                        onChange={() => toggleScopeDraft(j.key)}
                      />
                      <span className="scope-switch-track" />
                      <span className="scope-switch-label">
                        {j.label}
                        <span className="when-on"> · Aktif</span>
                        <span className="when-off"> · Non-Aktif</span>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleScopeSave}
                  disabled={savingScopes}
                >
                  {savingScopes ? 'Menyimpan...' : `Simpan (${scopeDraft.length} dipilih)`}
                </button>
              </div>
            </div>
          )}
      </>
      </div>
    </div>
  );
}

export default IzinAkun;
