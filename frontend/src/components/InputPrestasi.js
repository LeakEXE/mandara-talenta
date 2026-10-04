import { useState, useEffect } from 'react';
import api from '../utils/api';
import { formatDisplayText } from '../utils/formatDisplayText';
import EditModal from './EditModal';
import useEditModal from '../hooks/useEditModal';
import { validateEvidenceFile } from '../utils/evidence';
import API_BASE_URL from '../config';
import Select from 'react-select';
import SearchableTeacherSelect from './SearchableTeacherSelect';
import { ClipboardList, ShieldAlert } from 'lucide-react';

function InputPrestasi() {
  const [formData, setFormData] = useState({
    nama: '',
    nis: '',
    nama_lomba: '',
    jenis_lomba: 'akademik',
    kategori_lomba: 'individu',
    kelas: '',
    pembina_id: '',
    grha: '',
    juara: 'juara_i',
    kategori: 'sekolah'
  });
  const [foto, setFoto] = useState(null);
  const [message, setMessage] = useState('');
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [hasAccess, setHasAccess] = useState(true);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessMessage, setAccessMessage] = useState('');
  const [, setIsAutoFilled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [allPrestasi, setAllPrestasi] = useState([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [selectedIndexIds, setSelectedIndexIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [canApprove, setCanApprove] = useState(false);
  const editModal = useEditModal();
  const [iptConfig, setIptConfig] = useState([]);
  const [calculatedPoint, setCalculatedPoint] = useState(0);
  const FIXED_TINGKAT_OPTIONS = [
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

  const tingkatLombaOptions = FIXED_TINGKAT_OPTIONS;
  const juaraLombaOptions = FIXED_JUARA_LOMBA_OPTIONS;
  const [students, setStudents] = useState([]);

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    setUserRole(user.role || '');

    // Auto-fill biodata for siswa
    if (user.role === 'siswa') {
      setFormData(prev => ({
        ...prev,
        nama: user.nama || '',
        nis: user.nis || '',
        kelas: user.kelas || '',
        grha: user.grha || ''
      }));
    }
    // Student list is needed by the kelompok member picker for every role
    fetchStudents();

    fetchTeachers();
    fetchUserSubmissions();
    fetchIptConfig();
    checkAccess();
    if (user.role === 'superadmin') {
      fetchAllPrestasi();
    } else if (user.role === 'guru' || user.role === 'pegawai') {
      api.get('/permissions/my-permissions').then(r => { const scopes = r.data?.approval_scopes || []; const allowed = scopes.includes('prestasi'); setCanApprove(allowed); if (allowed) fetchAllPrestasi(); }).catch(() => setCanApprove(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllPrestasi = async () => {
    try {
      setLoadingIndex(true);
      const response = await api.get('/prestasi/all');
      setAllPrestasi(response.data);
    } catch (error) {
      console.error('Error fetching all prestasi:', error);
    } finally {
      setLoadingIndex(false);
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
      await api.delete(`/prestasi/${id}`);
      setMessage('Prestasi berhasil dihapus!');
      setSelectedIndexIds(prev => prev.filter(selectedId => selectedId !== id));
      fetchAllPrestasi();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus prestasi');
    }
  };

  const filteredPrestasi = allPrestasi.filter((item) => {
    const q = indexSearch.trim().toLowerCase();
    if (!q) return true;
    const fields = [
      item.nama,
      item.nis,
      item.nama_lomba,
      item.jenis_lomba,
      item.kategori_lomba,
      item.juara,
      item.kategori,
      item.pembina,
      item.point,
      item.status
    ];
    return fields.some((field) => String(field ?? '').toLowerCase().includes(q));
  });

  const toggleSelectIndex = (id) => {
    setSelectedIndexIds(prev => (
      prev.includes(id) ? prev.filter(selectedId => selectedId !== id) : [...prev, id]
    ));
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredPrestasi.map(item => item.id);
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
    if (!window.confirm(`Hapus ${ids.length} data prestasi? IPT akan dikembalikan untuk data yang sudah disetujui.`)) {
      return;
    }
    setBulkDeleting(true);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await api.delete('/prestasi/' + id);
        ok += 1;
      } catch (error) {
        failed.push(id);
      }
    }
    setBulkDeleting(false);
    setSelectedIndexIds(failed);
    if (failed.length === 0) {
      setMessage(ok + ' data prestasi berhasil dihapus!');
    } else {
      setMessage(ok + ' data prestasi berhasil dihapus! ' + failed.length + ' gagal dihapus.');
    }
    fetchAllPrestasi();
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
      
      await api.put(`/prestasi/${editModal.editingItem.id}`, updateData);
      setMessage('Prestasi berhasil diperbarui!');
      fetchAllPrestasi();
      editModal.closeEditModal();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal memperbarui prestasi');
    } finally {
      editModal.setIsLoading(false);
    }
  };

  const checkAccess = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      
      // Superadmin always has access
      if (user.role === 'superadmin') {
        setHasAccess(true);
        setCheckingAccess(false);
        return;
      }
      
      const response = await api.get('/input-access/status/my-access');
      
      const canInputPrestasi = response.data.prestasi;
      setHasAccess(canInputPrestasi);
      
      if (!canInputPrestasi) {
        setAccessMessage('Anda tidak memiliki izin untuk input data prestasi. Silakan hubungi SuperAdmin.');
      }
    } catch (error) {
      console.error('Error checking access:', error);
      // Fail open - allow access if error
      setHasAccess(true);
    } finally {
      setCheckingAccess(false);
    }
  };

  // const checkPermission = async () => {
  //   const user = JSON.parse(localStorage.getItem('user'));
  //   if (user?.role === 'superadmin') {
  //     setHasPermission(true);
  //     setCheckingPermission(false);
  //     return;
  //   }

  //   try {
  //     //     const response = await api.get('/permissions/' + user.id, {
  //       headers: { Authorization: `Bearer ${token}` }
  //     });
  //     setHasPermission(response.data.can_input_prestasi === true);
  //   } catch (error) {
  //     console.error('Error checking permission:', error);
  //     setHasPermission(false);
  //   } finally {
  //     setCheckingPermission(false);
  //   }
  // };

  const fetchUserSubmissions = async () => {
    try {
      const response = await api.get('/approvals/user-submissions');
      setSubmissions(response.data.prestasi || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    }
  };

  const fetchTeachers = async () => {
    try {
      const response = await api.get('/prestasi/teachers');
      setTeachers(response.data);
    } catch (error) {
      console.error('Error fetching teachers:', error);
    }
  };

  const fetchIptConfig = async () => {
    try {
      const response = await api.get('/ipt-config/active');
      setIptConfig(response.data);
      const firstTingkat = response.data.prestasi?.[0]?.field1 || 'sekolah';
      const firstJuara = response.data.prestasi?.[0]?.field2 || 'juara_i';
      setFormData(prev => ({ ...prev, kategori: firstTingkat, juara: firstJuara }));
      setCalculatedPoint(calculatePoint(firstTingkat, firstJuara, response.data));
    } catch (error) {
      console.error('Error fetching IPT config:', error);
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=siswa&limit=500');
      // Use the new pagination format
      const studentList = response.data.users || [];
      setStudents(studentList);
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const calculatePoint = (tingkat, juara, configData = iptConfig) => {
    const config = (configData.prestasi || []).find(
      c => c.field1 === tingkat && c.field2 === juara
    );
    return config ? config.point_value : 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    // Switching back to individu discards the kelompok member list
    if (name === 'kategori_lomba' && value !== 'kelompok') {
      setSelectedMembers([]);
    }

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

    // Calculate point when tingkat lomba or juara changes
    if (name === 'kategori' || name === 'juara') {
      const newFormData = { ...formData, [name]: value };
      // When tingkat changes, keep juara only if it exists for that tingkat
      if (name === 'kategori') {
        const juaraForTingkat = (iptConfig.prestasi || [])
          .filter(c => c.field1 === value)
          .map(c => c.field2);
        if (!juaraForTingkat.includes(newFormData.juara)) {
          newFormData.juara = juaraForTingkat[0] || '';
          setFormData(newFormData);
        }
      }
      const point = calculatePoint(newFormData.kategori, newFormData.juara);
      setCalculatedPoint(point);
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
      // Student not found or error, don't show error to user and don't auto-fill
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
      // Student not found or error, don't show error to user and don't auto-fill
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
      // Kelompok mode needs at least 2 members picked from the dropdown
      if (formData.kategori_lomba === 'kelompok' && selectedMembers.length < 2) {
        setMessage('Lomba kelompok membutuhkan minimal 2 anggota');
        setLoading(false);
        return;
      }
      const data = new FormData();
      Object.keys(formData).forEach(key => {
        data.append(key, formData[key]);
      });
      if (formData.kategori_lomba === 'kelompok') {
        data.append('anggota', JSON.stringify(selectedMembers.map(m => ({ nama: m.nama, nis: m.nis }))));
      }
      if (foto) {
        // Prepend NIS to filename if NIS exists
        const fileToUpload = formData.nis
          ? new File([foto], `${formData.nis}_${foto.name}`, { type: foto.type })
          : foto;
        data.append('foto', fileToUpload);
      }

      const response = await api.post('/approvals/prestasi/submit', data);

      // Use message from backend response (different for superadmin vs regular user)
      setMessage(response.data?.message || 'Data prestasi berhasil dikirim!');
      fetchUserSubmissions();
      if (userRole === 'superadmin') {
        fetchAllPrestasi();
      }
      setFormData({
        nama: '',
        nis: '',
        nama_lomba: '',
        jenis_lomba: 'akademik',
        kategori_lomba: 'individu',
        kelas: '',
        pembina_id: '',
        grha: '',
        juara: 'juara_i',
        kategori: 'sekolah'
      });
      setFoto(null);
      setSelectedMembers([]);
      setIsAutoFilled(false);
      setShowForm(false);
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengirim prestasi');
    } finally {
      setLoading(false);
    }
  };

  // Permission checking disabled for now
  // if (checkingPermission) {
  //   return <div className="loading"><div className="spinner"></div></div>;
  // }

  if (checkingAccess) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  if (!hasAccess) {
    return (
      <div className="card">
        <h2><ShieldAlert size={22} style={{ verticalAlign: '-4px', marginRight: '8px' }} />Akses Ditolak</h2>
        <div className="alert alert-danger" style={{ marginTop: '15px' }}>
          {accessMessage || 'Anda tidak memiliki izin untuk mengakses halaman ini. Silakan hubungi SuperAdmin.'}
        </div>
      </div>
    );
  }

  const showStaffIndex = userRole === 'superadmin' || canApprove;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <h2>Input Prestasi</h2>
        {showStaffIndex && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            + Input Prestasi
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
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Index Prestasi</h3>
          {loadingIndex ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : (
            <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input
                type="text"
                placeholder="Cari nama, NIS, lomba, kategori..."
                value={indexSearch}
                onChange={(e) => setIndexSearch(e.target.value)}
                style={{ flex: '1 1 200px', minWidth: 0, padding: '6px 10px', fontSize: '13px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
              {userRole === 'superadmin' && selectedIndexIds.length > 0 && (
                <>
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
                </>
              )}
            </div>
            <div style={{ maxHeight: '400px', overflowX: 'auto', overflowY: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    {userRole === 'superadmin' && (
                    <th>
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el) {
                            const filteredIds = filteredPrestasi.map(item => item.id);
                            el.indeterminate = filteredIds.length > 0
                              && filteredIds.some(id => selectedIndexIds.includes(id))
                              && !filteredIds.every(id => selectedIndexIds.includes(id));
                          }
                        }}
                        checked={filteredPrestasi.length > 0 && filteredPrestasi.every(item => selectedIndexIds.includes(item.id))}
                        onChange={toggleSelectAllFiltered}
                      />
                    </th>
                    )}
                    <th>Tanggal</th>
                    <th>Nama</th>
                    <th>NIS</th>
                    <th>Lomba</th>
                    <th>Jenis</th>
                    <th>Kategori</th>
                    <th>Juara</th>
                    <th>Tingkat Lomba</th>
                    <th>Pembina</th>
                    <th>Point</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPrestasi.map(item => (
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
                      <td>{item.nama_lomba}</td>
                      <td>{formatDisplayText(item.jenis_lomba || 'akademik')}</td>
                      <td>{formatDisplayText(item.kategori_lomba || 'individu')}</td>
                      <td>{formatDisplayText(item.juara)}</td>
                      <td>{formatDisplayText(item.kategori)}</td>
                      <td>{item.pembina || '-'}</td>
                      <td>{item.point}</td>
                      <td>{getStatusBadge(item)}</td>
                      <td>
                        <button className="btn btn-info" onClick={() => handleEdit(item)} style={{ padding: '3px 8px', fontSize: '12px', marginRight: '5px' }}>Edit</button>
                        {userRole === 'superadmin' && (<button className="btn btn-danger" onClick={() => handleDelete(item.id)} style={{ padding: '3px 8px', fontSize: '12px' }}>Hapus</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allPrestasi.length === 0 && (
                <p className="text-muted">Belum ada data prestasi</p>
              )}
              {allPrestasi.length > 0 && filteredPrestasi.length === 0 && (
                <p className="text-muted">Tidak ada data yang cocok dengan pencarian</p>
              )}
            </div>
            </>
          )}
        </div>
      )}
      
      {/* Input Form - Show for non-superadmin or when showForm is true */}
      {((userRole !== 'superadmin' && !canApprove) || showForm) && (
        <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label>Kategori Lomba</label>
            <select name="kategori_lomba" value={formData.kategori_lomba} onChange={handleChange} required>
              <option value="individu">Individu</option>
              <option value="kelompok">Kelompok</option>
            </select>
          </div>
          <div className="form-group">
            <label>Jenis Lomba</label>
            <select name="jenis_lomba" value={formData.jenis_lomba} onChange={handleChange} required>
              <option value="akademik">Akademik</option>
              <option value="non_akademik">Non-akademik</option>
            </select>
          </div>
        </div>

        {formData.kategori_lomba !== 'kelompok' && (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label>Nama <span className="required">*</span></label>
            {userRole === 'siswa' ? (
              <input
                type="text"
                value={formData.nama}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d0d0d0',
                  borderRadius: '4px',
                  backgroundColor: '#f5f5f5',
                  color: '#666'
                }}
              />
            ) : (
              <Select
                value={students.find(s => s.nama === formData.nama && s.nis === formData.nis) ? { value: formData.nama, label: formData.nama, nama: formData.nama, nis: formData.nis, kelas: formData.kelas, grha: formData.grha } : null}
                onChange={(selected) => handleStudentSelect(selected)}
                options={students.map(student => ({ value: student.nama, label: `${student.nama} (${student.nis})`, nama: student.nama, nis: student.nis, kelas: student.kelas, grha: student.grha }))}
                placeholder="Cari nama siswa..."
                isSearchable
                isClearable
                styles={{
                  control: (provided) => ({
                    ...provided,
                    minHeight: '40px'
                  })
                }}
              />
            )}
          </div>
          <div className="form-group">
            <label>NIS <span className="required">*</span></label>
            {userRole === 'siswa' ? (
              <input
                type="text"
                value={formData.nis}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d0d0d0',
                  borderRadius: '4px',
                  backgroundColor: '#f5f5f5',
                  color: '#666'
                }}
              />
            ) : (
              <Select
                value={students.find(s => s.nis === formData.nis) ? { value: formData.nis, label: formData.nis, nama: formData.nama, nis: formData.nis, kelas: formData.kelas, grha: formData.grha } : null}
                onChange={(selected) => handleStudentSelect(selected)}
                options={students.map(student => ({ value: student.nis, label: `${student.nis} - ${student.nama}`, nama: student.nama, nis: student.nis, kelas: student.kelas, grha: student.grha }))}
                placeholder="Cari NIS siswa..."
                isSearchable
                isClearable
                styles={{
                  control: (provided) => ({
                    ...provided,
                    minHeight: '40px'
                  })
                }}
              />
            )}
          </div>
        </div>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label>Kelas</label>
            <input 
              type="text" 
              name="kelas" 
              value={formData.kelas} 
              onChange={handleChange} 
              placeholder="Data diisi otomatis"
              disabled
              style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
            />
          </div>
          <div className="form-group">
            <label>Grha</label>
            <select name="grha" value={formData.grha} disabled onChange={handleChange}>
              {grhaOptions.map(grha => (
                <option key={grha} value={grha}>{grha}</option>
              ))}
            </select>
          </div>
        </div>
        </>
        )}

        {formData.kategori_lomba === 'kelompok' && (
          <div className="form-group">
            <label>Anggota Kelompok (minimal 2) <span className="required">*</span></label>
            <Select
              isMulti
              value={selectedMembers}
              onChange={(selected) => setSelectedMembers(selected || [])}
              options={students.map(student => ({ value: student.nis, label: `${student.nama} (${student.nis})`, nama: student.nama, nis: student.nis, kelas: student.kelas, grha: student.grha }))}
              placeholder="Pilih 2 siswa atau lebih..."
              isSearchable
              styles={{
                control: (provided) => ({
                  ...provided,
                  minHeight: '40px'
                })
              }}
            />
            {selectedMembers.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '13px', color: '#666' }}>
                {selectedMembers.length} siswa dipilih: {selectedMembers.map(m => m.nama).join(', ')}
              </div>
            )}
          </div>
        )}

        <div className="form-group">
          <label>Nama Lomba</label>
          <input
            type="text"
            name="nama_lomba"
            value={formData.nama_lomba}
            onChange={handleChange}
            placeholder="Nama lomba"
            required
          />
        </div>

        <div className="form-group">
          <label>Pembina</label>
          <SearchableTeacherSelect
            value={formData.pembina_id || ''}
            teachers={teachers}
            onChange={(id) => handleChange({ target: { name: 'pembina_id', value: id } })}
            placeholder="Cari nama pembina..."
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label>Juara</label>
            <select name="juara" value={formData.juara} onChange={handleChange}>
              {juaraLombaOptions.map(juara => (
                <option key={juara} value={juara}>{formatDisplayText(juara)}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Tingkat Lomba</label>
            <select name="kategori" value={formData.kategori} onChange={handleChange}>
              {tingkatLombaOptions.map(tingkat => (
                <option key={tingkat} value={tingkat}>{formatDisplayText(tingkat)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-group" style={{ 
          padding: '12px', 
          background: calculatedPoint > 0 ? '#EAFBF3' : '#FEE2E2',
          borderRadius: '4px',
          marginTop: '12px'
        }}>
          <label style={{ fontWeight: '600', marginBottom: '4px', display: 'block' }}>
            Point IPT yang akan didapatkan:
          </label>
          <span style={{ 
            fontSize: '18px', 
            fontWeight: '700',
            color: calculatedPoint > 0 ? '#0F7A55' : '#DC2626'
          }}>
            {calculatedPoint > 0 ? '+' : ''}{calculatedPoint}
          </span>
        </div>
        
        <div className="form-group">
          <label>Foto/Dokumen Bukti (JPG, PNG, GIF, WebP, PDF — maks 10MB)</label>
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
          {loading ? 'Mengirim...' : (JSON.parse(localStorage.getItem('user') || '{}').role === 'superadmin' ? 'Kirim' : 'Ajukan untuk Persetujuan')}
        </button>
      </form>
      )}

      <EditModal
        isOpen={editModal.showEditModal}
        title="Edit Prestasi"
        onClose={editModal.closeEditModal}
        onSave={handleUpdate}
        isLoading={editModal.isLoading}
        photoPreview={editModal.editingItem?.foto ? `${API_BASE_URL.replace('/api', '')}/${editModal.editingItem.foto}` : null}
      >
        <div className="form-group">
          <label>Nama</label>
          <input
            type="text"
            value={editModal.editFormData.nama || ''}
            required
            disabled={true}
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
            disabled
            placeholder="NIS"
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
            value={editModal.editFormData.grha || ''} 
            disabled={true}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, grha: e.target.value })}
          >
            <option value="" disabled hidden>Pilih Grha</option>
            {grhaOptions.map(grha => (
              <option key={grha} value={grha}>{grha}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Nama Lomba</label>
          <input
            type="text"
            name="nama_lomba"
            value={editModal.editFormData.nama_lomba || ''} 
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, nama_lomba: e.target.value })}
            placeholder="Nama lomba"
            required
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="form-group">
            <label>Jenis Lomba</label>
            <select name="jenis_lomba" value={editModal.editFormData.jenis_lomba || 'akademik'} onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, jenis_lomba: e.target.value })}>
              <option value="akademik">Akademik</option>
              <option value="non_akademik">Non-akademik</option>
            </select>
          </div>
          <div className="form-group">
            <label>Kategori Lomba</label>
            <select name="kategori_lomba" value={editModal.editFormData.kategori_lomba || 'individu'} onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, kategori_lomba: e.target.value })}>
              <option value="individu">Individu</option>
              <option value="kelompok">Kelompok</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Pembina</label>
          <SearchableTeacherSelect
            value={editModal.editFormData.pembina_id || ''}
            teachers={teachers}
            onChange={(id) => editModal.setEditFormData({ ...editModal.editFormData, pembina_id: id })}
            placeholder="Cari nama pembina..."
          />
        </div>

        <div className="form-group">
          <label>Juara</label>
          <select name="juara" value={editModal.editFormData.juara} onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, juara: e.target.value })}>
            {FIXED_JUARA_LOMBA_OPTIONS.map(juara => (
              <option key={juara} value={juara}>{formatDisplayText(juara)}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Tingkat Lomba</label>
          <select name="kategori" value={editModal.editFormData.kategori} onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, kategori: e.target.value })}>
            {FIXED_TINGKAT_OPTIONS.map(tingkat => (
              <option key={tingkat} value={tingkat}>{formatDisplayText(tingkat)}</option>
            ))}
          </select>
        </div>
      </EditModal>

      {/* Submission History - Hidden for Superadmin and approvers */}
      {userRole !== 'superadmin' && !canApprove && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Riwayat Pengajuan Prestasi</h3>
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
                    <strong style={{ fontSize: '14px' }}>{sub.nama_lomba}</strong>
                    <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                      {sub.nama} ({sub.nis}) - {formatDisplayText(sub.juara)} · {formatDisplayText(sub.jenis_lomba || 'akademik')} · {formatDisplayText(sub.kategori_lomba || 'individu')}
                    </p>
                    <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                      Pembina: {sub.pembina || '-'}
                    </p>
                    <p style={{ margin: 0, fontSize: '12px', color: '#999' }}>
                      Diajukan: {new Date(sub.created_at).toLocaleDateString('id-ID')}
                    </p>
                  </div>
                  <div>
                    {getStatusBadge(sub)}
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

function getStatusBadge(item) {
  if (item.status === 'rejected') {
    return <span className="badge badge-danger">Ditolak</span>;
  }
  if (item.status === 'approved') {
    return <span className="badge badge-success">Disetujui</span>;
  }
  return <span className="badge badge-warning">Menunggu</span>;
}

export default InputPrestasi;
