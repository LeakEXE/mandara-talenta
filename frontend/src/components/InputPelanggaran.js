import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import EditModal from './EditModal';
import useEditModal from '../hooks/useEditModal';
import API_BASE_URL from '../config';
import Select from 'react-select';
import StudentSelect from './StudentSelect';
import FilterBar from './FilterBar';
import { StatusIcon } from './icons';
import { ClipboardList } from 'lucide-react';
import { validateEvidenceFile } from '../utils/evidence';

function InputPelanggaran() {
  const [formData, setFormData] = useState({
    nama: '',
    nis: '',
    kelas: '',
    grha: '',
    keterangan: '',
    jenis_pelanggaran: ''
  });
  const [foto, setFoto] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setIsAutoFilled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [allPelanggaran, setAllPelanggaran] = useState([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [indexStatus, setIndexStatus] = useState('semua');
  const [indexDateFrom, setIndexDateFrom] = useState('');
  const [indexDateTo, setIndexDateTo] = useState('');
  const [indexJenis, setIndexJenis] = useState('semua');
  const [selectedIndexIds, setSelectedIndexIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [canApprove, setCanApprove] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const [permissionLoading, setPermissionLoading] = useState(true);
  const editModal = useEditModal();
  const [iptConfig, setIptConfig] = useState([]);
  const [calculatedPoint, setCalculatedPoint] = useState(0);
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
  const jenisOptions = (iptConfig['pelanggaran'] || [])
    .filter(config => config.field2)
    .map(config => {
      const level = (iptConfig['pelanggaran'] || []).find(
        candidate => !candidate.field2 && candidate.field1 === config.field2
      );
      return { value: config.field1, label: config.field1, level: config.field2, point: level?.point_value || 0 };
    });
  // Options with level info (e.g. "mencuri (berat)") - shared by the dropdown
  // list and the selected-value display of both add and edit forms.
  const jenisSelectOptions = jenisOptions.map((jenis) => ({
    value: jenis.value,
    label: jenis.level ? `${jenis.label} (${jenis.level})` : jenis.label,
  }));

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserRole(user.role || '');

    // Check permission for pelanggaran access
    const checkPermission = async () => {
      try {
        const response = await api.get('/permissions/my-permissions');
        const canAccess = user.role === 'superadmin' || ((user.role === 'guru' || user.role === 'pegawai') && response.data.can_input_pelanggaran);
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
    fetchUserSubmissions();
    if (user.role === 'superadmin') {
      fetchAllPelanggaran(1);
    } else if (user.role === 'guru' || user.role === 'pegawai') {
      api.get('/permissions/my-permissions').then(r => { const scopes = r.data?.approval_scopes || []; const allowed = scopes.includes('pelanggaran'); setCanApprove(allowed); if (allowed) fetchAllPelanggaran(); }).catch(() => setCanApprove(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllPelanggaran = useCallback(async (page = 1) => {
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
        jenis_pelanggaran: indexJenis,
        date_from: indexDateFrom,
        date_to: indexDateTo,
      });
      const response = await api.get(`/pelanggaran/all?${params.toString()}`);
      setAllPelanggaran(response.data.data || response.data || []);
      if (response.data.pagination) {
        setPagination(response.data.pagination);
      }
    } catch (error) {
      console.error('Error fetching all pelanggaran:', error);
    } finally {
      setLoadingIndex(false);
      setRefreshing(false);
    }
  }, [indexStatus, indexJenis, indexDateFrom, indexDateTo]);

  const fetchIptConfig = async () => {
    try {
      const response = await api.get('/ipt-config/active');
      setIptConfig(response.data);
      const firstDetail = (response.data.pelanggaran || []).find(config => config.field2);
      if (firstDetail) {
        setFormData(prev => ({ ...prev, jenis_pelanggaran: firstDetail.field1 }));
        setCalculatedPoint(calculatePoint(firstDetail.field1, response.data));
      }
    } catch (error) {
      console.error('Error fetching IPT config:', error);
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
      setSubmissions(response.data.pelanggaran || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    }
  };

  const calculatePoint = (jenis, configData = iptConfig) => {
    const pelanggaranConfigs = configData.pelanggaran || [];
    const config = pelanggaranConfigs.find(
      c => c.field1 === jenis
    );
    if (!config) return 0;
    if (config.field2) {
      const level = pelanggaranConfigs.find(
        candidate => !candidate.field2 && candidate.field1 === config.field2
      );
      return level?.point_value || 0;
    }
    return config.point_value;
  };

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

  const handleJenisSelect = (selectedOption) => {
    if (selectedOption) {
      setFormData(prev => ({ ...prev, jenis_pelanggaran: selectedOption.value }));
      setCalculatedPoint(calculatePoint(selectedOption.value));
    } else {
      setFormData(prev => ({ ...prev, jenis_pelanggaran: '' }));
      setCalculatedPoint(0);
    }
  };

  const handleEditJenisSelect = (selectedOption) => {
    if (selectedOption) {
      editModal.setEditFormData({ ...editModal.editFormData, jenis_pelanggaran: selectedOption.value });
    } else {
      editModal.setEditFormData({ ...editModal.editFormData, jenis_pelanggaran: '' });
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

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      setFoto(null);
      return;
    }
    const err = validateEvidenceFile(file);
    if (err) {
      setMessage(err);
      setFoto(null);
      e.target.value = '';
      return;
    }
    setFoto(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      const data = new FormData();
      Object.keys(formData).forEach(key => {
        data.append(key, formData[key]);
      });
      if (foto) {
        // Prepend NIS to filename if NIS exists
        const fileToUpload = formData.nis
          ? new File([foto], `${formData.nis}_${foto.name}`, { type: foto.type })
          : foto;
        data.append('foto', fileToUpload);
      }

      const response = await api.post('/approvals/pelanggaran/submit', data);

      // Backend decides direct-add vs queue (scope-based); use its message.
      setMessage(response.data?.message || 'Pelanggaran berhasil dikirim!');
      if (response.data?.direct) {
        fetchAllPelanggaran();
      }
      setFormData({
        nama: '',
        nis: '',
        kelas: '',
        grha: '',
        keterangan: '',
        jenis_pelanggaran: ''
      });
      setFoto(null);
      setIsAutoFilled(false);
      setShowForm(false);
      fetchUserSubmissions(); // Refresh submissions list
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengirim pelanggaran');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (item) => {
    editModal.openEditModal(item);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus data ini? IPT akan dikembalikan jika sudah disetujui.')) {
      return;
    }

    try {
      await api.delete(`/pelanggaran/${id}`);
      setMessage('Pelanggaran berhasil dihapus!');
      setSelectedIndexIds((prev) => prev.filter((selectedId) => selectedId !== id));
      fetchAllPelanggaran();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus pelanggaran');
    }
  };

  const resetIndexFilters = () => {
    setIndexSearch('');
    setIndexStatus('semua');
    setIndexDateFrom('');
    setIndexDateTo('');
    setIndexJenis('semua');
  };

  // Debounced search effect for index (same pattern as KelolaAkun)
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAllPelanggaran(1);
    }, 500);
    return () => clearTimeout(timer);
  }, [indexSearch, indexStatus, indexJenis, indexDateFrom, indexDateTo, fetchAllPelanggaran]);

  const filteredPelanggaran = allPelanggaran;

  const handleLimitChange = (newLimit) => {
    limitRef.current = newLimit;
    setPagination((prev) => ({ ...prev, limit: newLimit }));
    fetchAllPelanggaran(1);
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
    setSelectedIndexIds((prev) => (
      prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]
    ));
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredPelanggaran.map((item) => item.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIndexIds.includes(id));
    if (allSelected) {
      setSelectedIndexIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    } else {
      setSelectedIndexIds((prev) => [...new Set([...prev, ...filteredIds])]);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIndexIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Hapus ${ids.length} data pelanggaran? IPT akan dikembalikan untuk data yang sudah disetujui.`)) {
      return;
    }
    setBulkDeleting(true);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await api.delete('/pelanggaran/' + id);
        ok += 1;
      } catch (error) {
        failed.push(id);
      }
    }
    setBulkDeleting(false);
    setSelectedIndexIds(failed);
    if (failed.length === 0) {
      setMessage(`${ok} data pelanggaran berhasil dihapus!`);
    } else {
      setMessage(`${ok} data pelanggaran berhasil dihapus, ${failed.length} gagal dihapus.`);
    }
    fetchAllPelanggaran();
  };

  const handleEditFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      editModal.setEditFoto(null);
      return;
    }
    const err = validateEvidenceFile(file);
    if (err) {
      setMessage(err);
      editModal.setEditFoto(null);
      e.target.value = '';
      return;
    }
    editModal.setEditFoto(file);
  };

  const handleUpdate = async () => {
    editModal.setIsLoading(true);
    try {
      const data = new FormData();
      Object.keys(editModal.editFormData).forEach(key => {
        if (key !== 'id' && key !== 'created_at' && key !== 'status' && key !== 'user_id') {
          data.append(key, editModal.editFormData[key]);
        }
      });
      if (editModal.editFoto) {
        const fileToUpload = editModal.editFormData.nis
          ? new File([editModal.editFoto], `${editModal.editFormData.nis}_${editModal.editFoto.name}`, { type: editModal.editFoto.type })
          : editModal.editFoto;
        data.append('foto', fileToUpload);
      }

      await api.put(`/pelanggaran/${editModal.editingItem.id}`, data);

      setMessage('Pelanggaran berhasil diperbarui!');
      fetchAllPelanggaran();
      editModal.closeEditModal();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal memperbarui pelanggaran');
    } finally {
      editModal.setIsLoading(false);
    }
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
        <h2>Input Pelanggaran</h2>
        {showStaffIndex && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Tutup Form' : '+ Input Pelanggaran'}
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
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Index Pelanggaran</h3>
          {userRole === 'superadmin' && selectedIndexIds.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: '#666' }}>{selectedIndexIds.length} dipilih</span>
              <button
                className="btn btn-danger"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                style={{ padding: '6px 12px', fontSize: '13px' }}
              >
                {bulkDeleting ? 'Menghapus...' : `Hapus terpilih (${selectedIndexIds.length})`}
              </button>
              <button
                className="btn"
                onClick={() => setSelectedIndexIds([])}
                disabled={bulkDeleting}
                style={{ padding: '6px 12px', fontSize: '13px' }}
              >
                Batal
              </button>
            </div>
          )}
          
          {/* Filter Bar */}
          <FilterBar
            searchPlaceholder="Cari nama, NIS, detail, jenis..."
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
                  key: 'jenis',
                  type: 'select',
                  label: 'Jenis',
                  value: indexJenis,
                  onChange: setIndexJenis,
                  options: [
                    { value: 'semua', label: 'Semua Jenis' },
                    ...jenisOptions.map(j => ({ value: j.value, label: j.value }))
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
          
          {loadingIndex ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : (
            <>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', overflowY: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    {userRole === 'superadmin' && (
                    <th>
                      <input
                        type="checkbox"
                        checked={filteredPelanggaran.length > 0 && filteredPelanggaran.every((item) => selectedIndexIds.includes(item.id))}
                        ref={(el) => {
                          if (el) {
                            const filteredIds = filteredPelanggaran.map((item) => item.id);
                            const selectedCount = filteredIds.filter((id) => selectedIndexIds.includes(id)).length;
                            el.indeterminate = selectedCount > 0 && selectedCount < filteredIds.length;
                          }
                        }}
                        onChange={toggleSelectAllFiltered}
                      />
                    </th>
                    )}
                    <th>Tanggal</th>
                    <th>Nama</th>
                    <th>NIS</th>
                    <th>Detail</th>
                    <th>Jenis</th>
                    <th>Point</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPelanggaran.map(item => (
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
                      <td>{item.keterangan}</td>
                      <td>{item.jenis_pelanggaran}</td>
                      <td style={{ color: 'red' }}>{item.point_dikurangi}</td>
                      <td>
                        <button 
                          className="btn btn-info" 
                          onClick={() => handleEdit(item)} 
                          style={{ padding: '3px 8px', fontSize: '12px', marginRight: '5px' }}
                        >
                          Edit
                        </button>
                        {userRole === 'superadmin' && (
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDelete(item.id)}
                          style={{ padding: '3px 8px', fontSize: '12px' }}
                        >
                          Hapus
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allPelanggaran.length === 0 ? (
                <p className="text-muted">Belum ada data pelanggaran</p>
              ) : filteredPelanggaran.length === 0 ? (
                <p className="text-muted">Tidak ada data yang cocok dengan pencarian</p>
              ) : null}
            </div>

            {/* Pagination (KelolaAkun pattern) */}
            {!loadingIndex && filteredPelanggaran.length > 0 && (
              <>
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: '12px', marginTop: '16px'
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
                    <label htmlFor="pelanggaran-limit">Baris per halaman:</label>
                    <select
                      id="pelanggaran-limit"
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
                      onClick={() => fetchAllPelanggaran(pagination.page - 1)}
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
                          onClick={() => fetchAllPelanggaran(p)}
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
                      onClick={() => fetchAllPelanggaran(pagination.page + 1)}
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
              disabled
              required
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

        <div className="form-group">
          <label>Jenis Pelanggaran</label>
          <Select
            value={jenisSelectOptions.find(jenis => jenis.value === formData.jenis_pelanggaran) || null}
            onChange={handleJenisSelect}
            options={jenisSelectOptions}
            placeholder="Pilih Jenis Pelanggaran"
            isSearchable
            isClearable
            styles={{
              control: (provided) => ({
                ...provided,
                minHeight: '40px'
              })
            }}
          />
        </div>

        <div className="form-group" style={{ 
          padding: '12px', 
          background: '#FEE2E2',
          borderRadius: '4px',
          marginTop: '12px'
        }}>
          <label style={{ fontWeight: '600', marginBottom: '4px', display: 'block' }}>
            Point IPT yang akan dikurangi:
          </label>
          <span style={{ 
            fontSize: '18px', 
            fontWeight: '700',
            color: '#DC2626'
          }}>
            {calculatedPoint}
          </span>
        </div>
        
        <div className="form-group">
          <label>Detail Pelanggaran</label>
          <textarea
            name="keterangan"
            value={formData.keterangan}
            onChange={handleChange}
            placeholder="Jelaskan pelanggaran yang dilakukan"
            rows="3"
            required
          />
        </div>

        <div className="form-group">
          <label>Foto/Dokumen Bukti (JPG, PNG, GIF, WebP, PDF - maks 10MB)</label>
          <input
            type="file"
            onChange={handleFileChange}
            accept="image/*,.pdf"
          />
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
        title="Edit Pelanggaran"
        onClose={editModal.closeEditModal}
        onSave={handleUpdate}
        isLoading={editModal.isLoading}
        photoPreview={editModal.editingItem?.foto ? `${API_BASE_URL.replace('/api', '')}/${editModal.editingItem.foto}` : null}
      >
        <div className="form-group">
          <label>Nama</label>
          <input
            type="text"
            disabled
            value={editModal.editFormData.nama || ''}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, nama: e.target.value })}
            placeholder="Nama siswa"
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
            style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
          />
        </div>

        <div className="form-group">
          <label>Grha</label>
          <select 
          disabled
            value={editModal.editFormData.grha || ''} 
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, grha: e.target.value })}
          >
            <option value="" disabled hidden>Pilih Grha</option>
            {grhaOptions.map(grha => (
              <option key={grha} value={grha}>{grha}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>Jenis Pelanggaran</label>
          <Select
            value={jenisSelectOptions.find(jenis => jenis.value === editModal.editFormData.jenis_pelanggaran) || null}
            onChange={handleEditJenisSelect}
            options={jenisSelectOptions}
            placeholder="Pilih Jenis Pelanggaran"
            isSearchable
            isClearable
            styles={{
              control: (provided) => ({
                ...provided,
                minHeight: '40px'
              })
            }}
          />
        </div>

        <div className="form-group">
          <label>Detail Pelanggaran</label>
          <textarea
            value={editModal.editFormData.keterangan || ''}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, keterangan: e.target.value })}
            placeholder="Jelaskan pelanggaran yang dilakukan"
            rows="3"
          />
        </div>

        <div className="form-group">
          <label>Foto/Dokumen Bukti {editModal.editingItem?.foto && '(Pilih untuk ganti)'} (JPG, PNG, GIF, WebP, PDF - maks 10MB)</label>
          <input
            type="file"
            onChange={handleEditFileChange}
            accept="image/*,.pdf"
          />
        </div>
      </EditModal>

      {/* Submission History - Hidden for Superadmin and approvers */}
      {userRole !== 'superadmin' && !canApprove && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Riwayat Pengajuan Pelanggaran</h3>
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
                    <strong style={{ fontSize: '14px' }}>{sub.jenis_pelanggaran}</strong>
                    <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                      {sub.nama} ({sub.nis}) - {sub.kelas}
                    </p>
                    <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                      Keterangan: {sub.keterangan || '-'}
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

export default InputPelanggaran;
