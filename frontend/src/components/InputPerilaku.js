import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import { parseKarakterSiswa, toTitleCase } from '../utils/perilaku';
import StudentSelect from './StudentSelect';
import FilterBar from './FilterBar';
import EditModal from './EditModal';
import useEditModal from '../hooks/useEditModal';
import { StatusIcon } from './icons';
import { ClipboardList } from 'lucide-react';

function InputPerilaku() {
  const [formData, setFormData] = useState({
    nama: '',
    nis: '',
    kelas: '',
    grha: '',
    tanggung_jawab: '',
    disiplin: '',
    kepedulian: '',
    kemandirian: '',
    spiritual: '',
    kejujuran: '',
    kepercayaan_diri: ''
  });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setIsAutoFilled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [allPerilaku, setAllPerilaku] = useState([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [indexStatus, setIndexStatus] = useState('semua');
  const [indexDateFrom, setIndexDateFrom] = useState('');
  const [indexDateTo, setIndexDateTo] = useState('');
  const [indexKarakter, setIndexKarakter] = useState('semua');
  const [selectedIndexIds, setSelectedIndexIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const [canApprove, setCanApprove] = useState(false);
  const editModal = useEditModal();
  const [iptConfig, setIptConfig] = useState([]);
  const [calculatedPoints, setCalculatedPoints] = useState({});
  const [students, setStudents] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  // Server-side pagination state (same pattern as KelolaAkun)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef(indexSearch);
  searchRef.current = indexSearch;
  const limitRef = useRef(pagination.limit);
  limitRef.current = pagination.limit;
  const fetchStartedRef = useRef(false);

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  const [perilakuRatings, setPerilakuRatings] = useState([]);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserRole(user.role || '');

    // Check permission for perilaku access
    const checkPermission = async () => {
      try {
        const response = await api.get('/permissions/my-permissions');
        const canAccess = user.role === 'superadmin' || ((user.role === 'guru' || user.role === 'pegawai') && response.data.can_input_perilaku);
        setHasPermission(canAccess);
      } catch (error) {
        console.error('Error checking permission:', error);
        setHasPermission(false);
      } finally {
        setPermissionLoading(false);
      }
    };

    checkPermission();

    // Auto-fill biodata for siswa
    if (user.role === 'siswa') {
      setFormData(prev => ({
        ...prev,
        nama: user.nama || '',
        nis: user.nis || '',
        kelas: user.kelas || '',
        grha: user.grha || ''
      }));
    } else {
      // Only fetch students for guru/superadmin
      fetchStudents();
    }

    fetchIptConfig();
    fetchPerilakuRatings();
    fetchUserSubmissions();
    if (user.role === 'guru' || user.role === 'pegawai') {
      api.get('/permissions/my-permissions').then(r => { setCanApprove(!!r.data?.can_input_perilaku); }).catch(() => setCanApprove(false));
    }
  }, []);


  const fetchAllPerilaku = useCallback(async (page = 1) => {
    const isFirstLoad = !fetchStartedRef.current;
    fetchStartedRef.current = true;
    try {
      if (isFirstLoad) {
        setLoadingIndex(true);
      } else {
        setRefreshing(true);
      }
      const params = new URLSearchParams({
        page,
        limit: limitRef.current,
        search: searchRef.current,
        status: indexStatus,
        karakter_siswa: indexKarakter,
        date_from: indexDateFrom,
        date_to: indexDateTo,
      });
      const response = await api.get(`/perilaku/all?${params.toString()}`);
      // Backend menyimpan 7 trait dalam 1 kolom `karakter_siswa`
      // ("Label: nilai, ...") -> uraikan agar kolom tabel terisi
      setAllPerilaku((response.data.data || response.data || []).map((item) => ({
        ...item,
        ...parseKarakterSiswa(item.karakter_siswa),
      })));
      if (response.data.pagination) {
        setPagination(response.data.pagination);
      }
    } catch (error) {
      console.error('Error fetching all perilaku:', error);
    } finally {
      setLoadingIndex(false);
      setRefreshing(false);
    }
  }, [indexStatus, indexKarakter, indexDateFrom, indexDateTo]);

  const fetchIptConfig = async () => {
    try {
      const response = await api.get('/ipt-config/active');
      setIptConfig(response.data);
    } catch (error) {
      console.error('Error fetching IPT config:', error);
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
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=siswa&limit=500');
      const studentList = response.data.users?.filter(user => user.role === 'siswa') || [];
      setStudents(studentList);
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const fetchUserSubmissions = async () => {
    try {
      const response = await api.get('/approvals/user-submissions');
      setSubmissions(response.data.perilaku || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    }
  };

  // Point perilaku hanya bergantung pada tingkat penilaian (shared semua karakter).
  // Cocokkan field1 (format baru) atau field2 (format lama, sebelum migrasi).
  const calculatePoint = (karakter, tingkat) => {
    const perilakuConfigs = iptConfig['perilaku'] || [];
    const config = perilakuConfigs.find(
      c => c.field1 === tingkat || c.field2 === tingkat
    );
    return config ? config.point_value : 0;
  };

  const getPerilakuRatingOptions = () => {
    return perilakuRatings
      .filter(rating => rating.is_active)
      .map(rating => ({
        value: rating.name,
        label: rating.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
      }));
  };

  const karakterOptions = getPerilakuRatingOptions();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    // Reset auto-fill flag if user clears the field
    if ((name === 'nis' || name === 'nama') && value === '') {
      setIsAutoFilled(false);
    }

    // Auto-fill student data when NIS is entered
    if (name === 'nis' && value.length >= 1) {
      fetchStudentData(value);
    }

    // Auto-fill student data when nama is entered
    if (name === 'nama' && value.length >= 1) {
      fetchStudentDataByName(value);
    }

    // Calculate point when karakter values change
    const karakterFields = ['tanggung_jawab', 'disiplin', 'kepedulian', 'kemandirian', 'spiritual', 'kejujuran', 'kepercayaan_diri'];
    if (karakterFields.includes(name)) {
      const point = calculatePoint(name, value);
      setCalculatedPoints(prev => ({ ...prev, [name]: point }));
    }
  };

  const handleStudentSelect = (selectedOption) => {
    if (selectedOption) {
      setFormData(prev => ({
        ...prev,
        nama: selectedOption.nama,
        nis: selectedOption.nis,
        kelas: selectedOption.kelas || '',
        grha: selectedOption.grha || ''
      }));
      setIsAutoFilled(true);
    } else {
      setFormData(prev => ({
        ...prev,
        nama: '',
        nis: '',
        kelas: '',
        grha: ''
      }));
      setIsAutoFilled(false);
    }
  };

  const fetchStudentData = async (nis) => {
    try {
      const response = await api.get(`/users/nis/${nis}`);
      
      if (response.data) {
        setFormData(prev => ({
          ...prev,
          nama: response.data.nama || '',
          kelas: response.data.kelas || '',
          grha: response.data.grha || ''
        }));
        setIsAutoFilled(true);
      }
    } catch (error) {
      // Student not found or error, don't auto-fill
      console.log('Student not found or error fetching data');
    }
  };

  const fetchStudentDataByName = async (nama) => {
    try {
      const response = await api.get(`/users/nama/${nama}`);
      
      if (response.data) {
        setFormData(prev => ({
          ...prev,
          nis: response.data.nis || '',
          kelas: response.data.kelas || '',
          grha: response.data.grha || ''
        }));
        setIsAutoFilled(true);
      }
    } catch (error) {
      // Student not found or error, don't auto-fill
      console.log('Student not found or error fetching data');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const response = await api.post('/perilaku', formData);

      setMessage(response.data.message || 'Perilaku berhasil dikirim!');
      if (userRole === 'superadmin') {
        fetchAllPerilaku();
      }
      setFormData({
        nama: '',
        nis: '',
        kelas: '',
        grha: '',
        tanggung_jawab: '',
        disiplin: '',
        kepedulian: '',
        kemandirian: '',
        spiritual: '',
        kejujuran: '',
        kepercayaan_diri: ''
      });
      setIsAutoFilled(false);
      setShowForm(false);
      fetchUserSubmissions(); // Refresh submissions list
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengirim perilaku');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item) => {
    editModal.openEditModal({ ...item, ...parseKarakterSiswa(item.karakter_siswa) });
  };

  const handleUpdate = async () => {
    editModal.setIsLoading(true);
    try {
      const updateData = {};
      Object.keys(editModal.editFormData).forEach(key => {
        if (key !== 'id' && key !== 'created_at' && key !== 'status' && key !== 'user_id') {
          updateData[key] = editModal.editFormData[key];
        }
      });
      // Buang string gabungan lama agar backend membangun ulang
      // `karakter_siswa` dari 7 trait yang baru diedit
      delete updateData.karakter_siswa;

      await api.put(`/perilaku/${editModal.editingItem.id}`, updateData);

      setMessage('Perilaku berhasil diperbarui!');
      fetchAllPerilaku();
      editModal.closeEditModal();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal memperbarui perilaku');
    } finally {
      editModal.setIsLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus data ini? IPT akan dikembalikan jika sudah disetujui.')) {
      return;
    }

    try {
      await api.delete('/perilaku/' + id);
      setMessage('Perilaku berhasil dihapus!');
      setSelectedIndexIds(prev => prev.filter(selectedId => selectedId !== id));
      fetchAllPerilaku();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus perilaku');
    }
  };

  const resetIndexFilters = () => {
    setIndexSearch('');
    setIndexStatus('semua');
    setIndexKarakter('semua');
    setIndexDateFrom('');
    setIndexDateTo('');
  };

  // Debounced search effect for index (same pattern as KelolaAkun)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllPerilaku(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [indexSearch, indexStatus, indexKarakter, indexDateFrom, indexDateTo, fetchAllPerilaku]);

  const filteredPerilaku = allPerilaku;

  const handleLimitChange = (newLimit) => {
    limitRef.current = newLimit;
    setPagination((prev) => ({ ...prev, limit: newLimit }));
    fetchAllPerilaku(1);
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

  const toggleSelectIndex = (id) => {
    setSelectedIndexIds(prev => (
      prev.includes(id) ? prev.filter(selectedId => selectedId !== id) : [...prev, id]
    ));
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredPerilaku.map(item => item.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedIndexIds.includes(id));
    if (allSelected) {
      setSelectedIndexIds(prev => prev.filter(id => !filteredIds.includes(id)));
    } else {
      setSelectedIndexIds(prev => [...new Set([...prev, ...filteredIds])]);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIndexIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Hapus ${ids.length} data perilaku? IPT akan dikembalikan untuk data yang sudah disetujui.`)) {
      return;
    }
    setBulkDeleting(true);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await api.delete('/perilaku/' + id);
        ok += 1;
      } catch (error) {
        failed.push(id);
      }
    }
    setBulkDeleting(false);
    setSelectedIndexIds(failed);
    if (failed.length === 0) {
      setMessage(ok + ' data perilaku berhasil dihapus!');
    } else {
      setMessage(ok + ' data perilaku berhasil dihapus! ' + failed.length + ' gagal dihapus.');
    }
    fetchAllPerilaku();
  };

  const showStaffIndex = userRole === 'superadmin' || canApprove;

  if (permissionLoading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!hasPermission) {
    return (
      <div className="card">
        <h2>Akses Ditolak</h2>
        <p>Anda tidak memiliki izin untuk mengakses halaman ini. Silakan hubungi SuperAdmin.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <h2>Input Perilaku</h2>
        {showStaffIndex && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Tutup Form' : '+ Input Perilaku'}
          </button>
        )}
      </div>
      
      {message && (
        <div className="alert alert-success" style={{ marginBottom: '16px' }}>
          {message}
        </div>
      )}
      
      {/* Index Display for Superadmin */}
      {(showStaffIndex && !showForm) && (
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Index Perilaku</h3>
          {loadingIndex ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : (
            <>
            {userRole === 'superadmin' && selectedIndexIds.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
                <span style={{ fontSize: '13px' }}>{selectedIndexIds.length} dipilih</span>
                <button
                  className="btn btn-danger"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  style={{ padding: '5px 10px', fontSize: '12px' }}
                >
                  {bulkDeleting ? 'Menghapus...' : `Hapus terpilih (${selectedIndexIds.length})`}
                </button>
                <button
                  className="btn"
                  onClick={() => setSelectedIndexIds([])}
                  disabled={bulkDeleting}
                  style={{ padding: '5px 10px', fontSize: '12px' }}
                >
                  Batal
                </button>
              </div>
            )}
          
          {/* Filter Bar */}
          <FilterBar
            searchPlaceholder="Cari nama, NIS..."
            searchValue={indexSearch}
            onSearchChange={(e) => setIndexSearch(e.target.value)}
            filters={
              [
                {
                  key: 'status',
                  type: 'select',
                  label: 'Status',
                  value: indexStatus,
                  onChange: setIndexStatus,
                  options: [
                    { value: 'semua', label: 'Semua Status' },
                    { value: 'pending', label: 'Menunggu' },
                    { value: 'approved', label: 'Disetujui' },
                    { value: 'rejected', label: 'Ditolak' }
                  ]
                },
                {
                  key: 'karakter',
                  type: 'select',
                  label: 'Karakter',
                  value: indexKarakter,
                  onChange: setIndexKarakter,
                  options: [
                    { value: 'semua', label: 'Semua Karakter' },
                    { value: 'Tanggung Jawab', label: 'Tanggung Jawab' },
                    { value: 'Disiplin', label: 'Disiplin' },
                    { value: 'Kepedulian', label: 'Kepedulian' },
                    { value: 'Kemandirian', label: 'Kemandirian' },
                    { value: 'Spiritual', label: 'Spiritual' },
                    { value: 'Kejujuran', label: 'Kejujuran' },
                    { value: 'Kepercayaan Diri', label: 'Kepercayaan Diri' }
                  ]
                },
                {
                  key: 'dateFrom',
                  type: 'date',
                  label: 'Tanggal Dari',
                  value: indexDateFrom,
                  onChange: setIndexDateFrom,
                  placeholder: 'Dari'
                },
                {
                  key: 'dateTo',
                  type: 'date',
                  label: 'Tanggal Sampai',
                  value: indexDateTo,
                  onChange: setIndexDateTo,
                  placeholder: 'Sampai'
                }
              ]
            }
            onReset={resetIndexFilters}
          />
          
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', overflowY: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    {userRole === 'superadmin' && (
                    <th>
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) {
                            const filteredIds = filteredPerilaku.map(item => item.id);
                            el.indeterminate = filteredIds.length > 0
                              && filteredIds.some(id => selectedIndexIds.includes(id))
                              && !filteredIds.every(id => selectedIndexIds.includes(id));
                          }
                        }}
                        checked={filteredPerilaku.length > 0 && filteredPerilaku.every(item => selectedIndexIds.includes(item.id))}
                        onChange={toggleSelectAllFiltered}
                      />
                    </th>
                    )}
                    <th>Tanggal</th>
                    <th>Nama</th>
                    <th>NIS</th>
                    <th>Tanggung Jawab</th>
                    <th>Disiplin</th>
                    <th>Kepedulian</th>
                    <th>Kemandirian</th>
                    <th>Spiritual</th>
                    <th>Kejujuran</th>
                    <th>Kepercayaan Diri</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPerilaku.map(item => (
                    <tr key={item.id}>
                      {userRole === 'superadmin' && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIndexIds.includes(item.id)}
                          onChange={() => toggleSelectIndex(item.id)}
                        />
                      </td>
                      )}
                      <td>{new Date(item.created_at).toLocaleDateString('id-ID')}</td>
                      <td>{item.nama}</td>
                      <td>{item.nis}</td>
                      <td>{toTitleCase(item.tanggung_jawab)}</td>
                      <td>{toTitleCase(item.disiplin)}</td>
                      <td>{toTitleCase(item.kepedulian)}</td>
                      <td>{toTitleCase(item.kemandirian)}</td>
                      <td>{toTitleCase(item.spiritual)}</td>
                      <td>{toTitleCase(item.kejujuran)}</td>
                      <td>{toTitleCase(item.kepercayaan_diri)}</td>
                      <td>
                        <button 
                          className="btn btn-info" 
                          onClick={() => handleEdit(item)} 
                          style={{ padding: '3px 8px', fontSize: '12px' }}
                        >
                          Edit
                        </button>
                        {userRole === 'superadmin' && (
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDelete(item.id)}
                          style={{ padding: '3px 8px', fontSize: '12px', marginLeft: '5px' }}
                        >
                          Hapus
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allPerilaku.length === 0 && (
                <p className="text-muted">Belum ada data perilaku</p>
              )}
              {allPerilaku.length > 0 && filteredPerilaku.length === 0 && (
                <p className="text-muted">Tidak ada data yang cocok dengan pencarian</p>
              )}
            </div>

            {/* Pagination (KelolaAkun pattern) */}
            {!loadingIndex && filteredPerilaku.length > 0 && (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: '12px', marginTop: '16px'
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
                    <label htmlFor="perilaku-limit">Baris per halaman:</label>
                    <select
                      id="perilaku-limit"
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
                      onClick={() => fetchAllPerilaku(pagination.page - 1)}
                      disabled={pagination.page <= 1 || loadingIndex || refreshing}
                      style={{
                        padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                        fontSize: '12px', cursor: pagination.page <= 1 || loadingIndex || refreshing ? 'not-allowed' : 'pointer',
                        background: pagination.page <= 1 || loadingIndex || refreshing ? '#f5f5f5' : 'white',
                        color: pagination.page <= 1 || loadingIndex || refreshing ? '#999' : '#333'
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
                          onClick={() => fetchAllPerilaku(p)}
                          disabled={loadingIndex || refreshing || p === pagination.page}
                          style={{
                            minWidth: '30px', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: '4px',
                            fontSize: '12px', cursor: loadingIndex || refreshing || p === pagination.page ? 'default' : 'pointer',
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
                      onClick={() => fetchAllPerilaku(pagination.page + 1)}
                      disabled={pagination.page >= pagination.totalPages || loadingIndex || refreshing}
                      style={{
                        padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                        fontSize: '12px', cursor: pagination.page >= pagination.totalPages || loadingIndex || refreshing ? 'not-allowed' : 'pointer',
                        background: pagination.page >= pagination.totalPages || loadingIndex || refreshing ? '#f5f5f5' : 'white',
                        color: pagination.page >= pagination.totalPages || loadingIndex || refreshing ? '#999' : '#333'
                      }}
                    >
                      Selanjutnya →
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                  Menampilkan {(pagination.page - 1) * pagination.limit + 1}&ndash;{Math.min(pagination.page * pagination.limit, pagination.total)} dari {pagination.total} data (Halaman {pagination.page} dari {pagination.totalPages})
                  {refreshing && <span style={{ marginLeft: '8px', color: 'var(--blue)' }}>Memuat…</span>}
                </div>
              </>
            )}
            </>
          )}
        </div>
      )}
      
      {/* Input Form - Show for non-superadmin or when showForm is true */}
      {((userRole !== 'superadmin' && !canApprove) || showForm) && (
        <form onSubmit={handleSubmit}>
        <StudentSelect
          students={students}
          nama={formData.nama}
          nis={formData.nis}
          onSelect={handleStudentSelect}
          isSiswa={userRole === 'siswa'}
        />

        <div className="form-grid-2">
          <div className="form-group">
            <label>Kelas</label>
            <input 
              type="text" 
              name="kelas" 
              value={formData.kelas} 
              onChange={handleChange} 
              placeholder="Data diisi otomatis"
              required
              disabled
              style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
            />
          </div>
          <div className="form-group">
            <label>Grha</label>
            <select name="grha" value={formData.grha} disabled required onChange={handleChange}>
              <option value="" disabled hidden>Data diisi otomatis</option>
              {grhaOptions.map(grha => (
                <option key={grha} value={grha}>{grha}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '16px', fontWeight: '600' }}>Perkembangan Karakter</h3>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Tanggung Jawab <span className="required">*</span></label>
              <select name="tanggung_jawab" value={formData.tanggung_jawab} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.tanggung_jawab === karakter.value && calculatedPoints.tanggung_jawab ? `(${calculatedPoints.tanggung_jawab} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Disiplin <span className="required">*</span></label>
              <select name="disiplin" value={formData.disiplin} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.disiplin === karakter.value && calculatedPoints.disiplin ? `(${calculatedPoints.disiplin} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Kepedulian <span className="required">*</span></label>
              <select name="kepedulian" value={formData.kepedulian} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.kepedulian === karakter.value && calculatedPoints.kepedulian ? `(${calculatedPoints.kepedulian} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Kemandirian <span className="required">*</span></label>
              <select name="kemandirian" value={formData.kemandirian} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.kemandirian === karakter.value && calculatedPoints.kemandirian ? `(${calculatedPoints.kemandirian} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Spiritual <span className="required">*</span></label>
              <select name="spiritual" value={formData.spiritual} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.spiritual === karakter.value && calculatedPoints.spiritual ? `(${calculatedPoints.spiritual} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Kejujuran <span className="required">*</span></label>
              <select name="kejujuran" value={formData.kejujuran} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.kejujuran === karakter.value && calculatedPoints.kejujuran ? `(${calculatedPoints.kejujuran} point)` : ''}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Kepercayaan Diri <span className="required">*</span></label>
              <select name="kepercayaan_diri" value={formData.kepercayaan_diri} onChange={handleChange} required>
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label} {formData.kepercayaan_diri === karakter.value && calculatedPoints.kepercayaan_diri ? `(${calculatedPoints.kepercayaan_diri} point)` : ''}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="form-group" style={{ 
          padding: '12px', 
          background: '#EAFBF3',
          borderRadius: '4px',
          marginTop: '12px'
        }}>
          <label style={{ fontWeight: '600', marginBottom: '4px', display: 'block' }}>
            Total Point IPT yang akan didapatkan:
          </label>
          <span style={{ 
            fontSize: '18px', 
            fontWeight: '700',
            color: '#0F7A55'
          }}>
            +{Object.values(calculatedPoints).reduce((a, b) => a + b, 0)}
          </span>
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? 'Mengirim...' : 'Kirim'}
        </button>
      </form>
      )}

      <EditModal
        isOpen={editModal.showEditModal}
        title="Edit Perilaku"
        onClose={editModal.closeEditModal}
        onSave={handleUpdate}
        isLoading={editModal.isLoading}
      >
        <div className="form-group">
          <label>Nama</label>
          <input
            type="text"
            value={editModal.editFormData.nama || ''}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, nama: e.target.value })}
            placeholder="Nama siswa"
            disabled
          />
        </div>
        <div className="form-group">
          <label>NIS</label>
          <input
            type="text"
            value={editModal.editFormData.nis || ''}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, nis: e.target.value })}
            placeholder="NIS"
            disabled
          />
        </div>

        <div className="form-group">
          <label>Kelas</label>
          <input 
            type="text" 
            value={editModal.editFormData.kelas || ''} 
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, kelas: e.target.value })}
            disabled
            required
            placeholder="Data diisi otomatis"
            style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
          />
        </div>

        <div className="form-group">
          <label>Grha</label>
          <select 
            value={editModal.editFormData.grha || ''} 
            disabled required
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, grha: e.target.value })}
          >
            <option value="" disabled hidden>Data diisi otomatis</option>
            {grhaOptions.map(grha => (
              <option key={grha} value={grha}>{grha}</option>
            ))}
          </select>
        </div>

        <div className="form-grid-2">
          {['tanggung_jawab', 'disiplin', 'kepedulian', 'kemandirian', 'spiritual', 'kejujuran', 'kepercayaan_diri'].map(field => (
            <div key={field} className="form-group">
              <label>{field.replace(/_/g, ' ').charAt(0).toUpperCase() + field.replace(/_/g, ' ').slice(1)}</label>
              <select 
                value={editModal.editFormData[field] || ''} 
                onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, [field]: e.target.value })}
              >
                <option value="" disabled hidden>Pilih Nilai</option>
                {karakterOptions.map(karakter => (
                  <option key={karakter.value} value={karakter.value}>{karakter.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </EditModal>

      {/* Submission History - Hidden for Superadmin and approvers */}
      {userRole !== 'superadmin' && !canApprove && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Riwayat Pengajuan Perilaku</h3>
          {submissions.length === 0 ? (
            <p className="text-muted">Belum ada pengajuan</p>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {submissions.map((sub, index) => (
                <div key={sub.id || index} style={{
                  padding: '15px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '10px',
                  alignItems: 'center'
                }}>
                  <div>
                    <strong style={{ fontSize: '14px' }}>Penilaian Perilaku</strong>
                    <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                      {sub.nama} ({sub.nis}) - {sub.kelas}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                      Diajukan: {new Date(sub.created_at).toLocaleDateString('id-ID')}
                    </p>
                  </div>
                  <div>
                    {getStatusBadge(sub.status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function getStatusBadge(status) {
  const styles = {
    pending: { background: 'var(--warning-color)', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    approved: { background: 'var(--success-color)', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '6px' },
    rejected: { background: 'var(--danger-color)', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '500', display: 'inline-flex', alignItems: 'center', gap: '6px' }
  };

  const labels = {
    pending: 'Menunggu',
    approved: 'Disetujui',
    rejected: 'Ditolak'
  };

  const style = styles[status] || styles.pending;
  const label = labels[status] || 'Menunggu';

  return <span style={style}><StatusIcon status={status} /> {label}</span>;
}

export default InputPerilaku;
