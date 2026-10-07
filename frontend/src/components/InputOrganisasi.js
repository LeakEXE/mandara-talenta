import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import Select from 'react-select';
import EditModal from './EditModal';
import useEditModal from '../hooks/useEditModal';
import API_BASE_URL from '../config';
import { StatusIcon } from './icons';
import { ClipboardList, ShieldAlert } from 'lucide-react';
import { validateEvidenceFile } from '../utils/evidence';

function InputOrganisasi() {
  const [formData, setFormData] = useState({
    nama: '',
    nis: '',
    kelas: '',
    grha: '',
    jabatan_organisasi: '',
    kategori_organisasi: ''
  });
  const [foto, setFoto] = useState(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [userRole, setUserRole] = useState('');
  const [hasAccess, setHasAccess] = useState(true);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [accessMessage, setAccessMessage] = useState('');
  const [, setIsAutoFilled] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [allOrganisasi, setAllOrganisasi] = useState([]);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [indexSearch, setIndexSearch] = useState('');
  const [selectedIndexIds, setSelectedIndexIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const editModal = useEditModal();
  const [iptConfig, setIptConfig] = useState([]);
  const [calculatedPoint, setCalculatedPoint] = useState(0);
  const [students, setStudents] = useState([]);

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  const jabatanOptions = [
    { value: 'ketua', label: 'Ketua' },
    { value: 'wakil ketua', label: 'Wakil Ketua' },
    { value: 'sekretaris', label: 'Sekretaris' },
    { value: 'bendahara', label: 'Bendahara' },
    { value: 'koordinator', label: 'Koordinator' },
    { value: 'anggota', label: 'Anggota' }
  ];

  const [organisasiOptions, setOrganisasiOptions] = useState([]);

  // useEffect(() => {
  //   checkPermission();
  // }, []);

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
    } else {
      // Only fetch students for guru/superadmin
      fetchStudents();
    }

    fetchUserSubmissions();
    checkAccess();
    fetchIptConfig();
    fetchOrganisasiOptions();
    if (user.role === 'superadmin') {
      fetchAllOrganisasi();
    } else if (user.role === 'guru' || user.role === 'pegawai') {
      api.get('/permissions/my-permissions').then(r => { const scopes = r.data?.approval_scopes || []; const allowed = scopes.includes('organisasi'); setCanApprove(allowed); if (allowed) fetchAllOrganisasi(); }).catch(() => setCanApprove(false));
    }
  }, []);

  const fetchOrganisasiOptions = async () => {
    try {
      const response = await api.get('/ipt-config/organisasi-options');
      setOrganisasiOptions(response.data.filter(option => option.is_active));
    } catch (error) {
      console.error('Error fetching organisasi options:', error);
    }
  };

  const fetchStudents = async () => {
    try {
      const response = await api.get('/users?role=siswa&limit=500');
      setStudents(response.data.users?.filter(user => user.role === 'siswa') || []);
    } catch (error) {
      console.error('Error fetching students:', error);
    }
  };

  const fetchAllOrganisasi = async () => {
    try {
      setLoadingIndex(true);
      const response = await api.get('/organisasi/all');
      setAllOrganisasi(response.data);
    } catch (error) {
      console.error('Error fetching all organisasi:', error);
    } finally {
      setLoadingIndex(false);
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
      
      const canInputOrganisasi = response.data.organisasi;
      setHasAccess(canInputOrganisasi);
      
      if (!canInputOrganisasi) {
        setAccessMessage('Anda tidak memiliki izin untuk input data organisasi. Silakan hubungi SuperAdmin.');
      }
    } catch (error) {
      console.error('Error checking access:', error);
      setHasAccess(true);
    } finally {
      setCheckingAccess(false);
    }
  };

  const fetchUserSubmissions = async () => {
    try {
      const response = await api.get('/approvals/user-submissions');
      setSubmissions(response.data.organisasi || []);
    } catch (error) {
      console.error('Error fetching submissions:', error);
    }
  };

  const fetchIptConfig = async () => {
    try {
      const response = await api.get('/ipt-config/active');
      setIptConfig(response.data);
    } catch (error) {
      console.error('Error fetching IPT config:', error);
    }
  };

  const calculatePoint = useCallback((kategori, jabatan) => {
    const organisasiConfigs = iptConfig['organisasi'] || [];
    const config = organisasiConfigs.find(
      c => c.field1?.trim().toLowerCase() === kategori?.trim().toLowerCase() &&
        c.field2?.trim().toLowerCase() === jabatan?.trim().toLowerCase()
    );
    return config ? config.point_value : 0;
  }, [iptConfig]);

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

    // Calculate point when kategori_organisasi or jabatan_organisasi changes
    if (name === 'kategori_organisasi' || name === 'jabatan_organisasi') {
      const newFormData = name === 'kategori_organisasi' || name === 'jabatan_organisasi' 
        ? { ...formData, [name]: value } 
        : formData;
      const point = calculatePoint(newFormData.kategori_organisasi, newFormData.jabatan_organisasi);
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

      const response = await api.post('/approvals/organisasi/submit', data);

      // Backend decides direct-add vs queue (scope-based); use its message.
      setMessage(response.data?.message || 'Organisasi berhasil dikirim!');
      if (response.data?.direct) {
        fetchAllOrganisasi();
      }
      setFormData({
        nama: '',
        nis: '',
        kelas: '',
        grha: '',
        jabatan_organisasi: '',
        kategori_organisasi: ''
      });
      setFoto(null);
      setIsAutoFilled(false);
      setShowForm(false);
      fetchUserSubmissions(); // Refresh submissions list
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal mengirim organisasi');
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
      await api.delete(`/organisasi/${id}`);
      setMessage('Organisasi berhasil dihapus!');
      setSelectedIndexIds(prev => prev.filter(selectedId => selectedId !== id));
      fetchAllOrganisasi();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menghapus organisasi');
    }
  };

  const filteredOrganisasi = allOrganisasi.filter((item) => {
    const q = indexSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      String(item.nama || '').toLowerCase().includes(q) ||
      String(item.nis || '').toLowerCase().includes(q) ||
      String(item.kategori_organisasi || '').toLowerCase().includes(q) ||
      String(item.jabatan_organisasi || '').toLowerCase().includes(q) ||
      String(item.point ?? '').toLowerCase().includes(q) ||
      String(item.status || '').toLowerCase().includes(q)
    );
  });

  const toggleSelectIndex = (id) => {
    setSelectedIndexIds(prev => prev.includes(id) ? prev.filter(selectedId => selectedId !== id) : [...prev, id]);
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredOrganisasi.map(item => item.id);
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
    if (!window.confirm(`Hapus ${ids.length} data organisasi? IPT akan dikembalikan untuk data yang sudah disetujui.`)) {
      return;
    }
    setBulkDeleting(true);
    let ok = 0;
    const failed = [];
    for (const id of ids) {
      try {
        await api.delete('/organisasi/' + id);
        ok += 1;
      } catch (error) {
        failed.push(id);
      }
    }
    setBulkDeleting(false);
    setSelectedIndexIds(failed);
    if (failed.length === 0) {
      setMessage(ok + ' data organisasi berhasil dihapus!');
    } else {
      setMessage(ok + ' data organisasi berhasil dihapus! ' + failed.length + ' gagal dihapus.');
    }
    fetchAllOrganisasi();
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

      await api.put(`/organisasi/${editModal.editingItem.id}`, data);

      setMessage('Organisasi berhasil diperbarui!');
      fetchAllOrganisasi();
      editModal.closeEditModal();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal memperbarui organisasi');
    } finally {
      editModal.setIsLoading(false);
    }
  };

  const getStatusBadge = (status) => {
    const styles = {
      pending: { background: 'var(--warning-color)', color: 'white' },
      approved: { background: 'var(--success-color)', color: 'white' },
      rejected: { background: 'var(--danger-color)', color: 'white' }
    };
    const labels = {
      pending: 'Menunggu',
      approved: 'Disetujui',
      rejected: 'Ditolak'
    };
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '500',
        ...styles[status]
      }}>
        <StatusIcon status={status} /> {labels[status] || status}
      </span>
    );
  };

  const showStaffIndex = userRole === 'superadmin' || canApprove;

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

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <h2>Input Organisasi</h2>
        {showStaffIndex && (
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Tutup Form' : '+ Input Organisasi'}
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
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Index Organisasi</h3>
          {loadingIndex ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : (
            <>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={indexSearch}
                onChange={(e) => setIndexSearch(e.target.value)}
                placeholder="Cari nama, NIS, kategori, jabatan..."
                style={{ flex: 1, minWidth: '200px', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px' }}
              />
              {userRole === 'superadmin' && selectedIndexIds.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#555' }}>{selectedIndexIds.length} dipilih</span>
                  <button
                    className="btn btn-danger"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                  >
                    {bulkDeleting ? 'Menghapus...' : `Hapus terpilih (${selectedIndexIds.length})`}
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setSelectedIndexIds([])}
                    disabled={bulkDeleting}
                    style={{ padding: '6px 12px', fontSize: '13px' }}
                  >
                    Batal
                  </button>
                </div>
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
                        checked={filteredOrganisasi.length > 0 && filteredOrganisasi.every(item => selectedIndexIds.includes(item.id))}
                        ref={(el) => { if (el) el.indeterminate = filteredOrganisasi.some(item => selectedIndexIds.includes(item.id)) && !filteredOrganisasi.every(item => selectedIndexIds.includes(item.id)); }}
                        onChange={toggleSelectAllFiltered}
                      />
                    </th>
                    )}
                    <th>Tanggal</th>
                    <th>Nama</th>
                    <th>NIS</th>
                    <th>Kategori</th>
                    <th>Jabatan</th>
                    <th>Point</th>
                    <th>Status</th>
                    <th>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrganisasi.map(item => (
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
                      <td>{item.kategori_organisasi}</td>
                      <td>{item.jabatan_organisasi}</td>
                      <td>{item.point}</td>
                      <td>{getStatusBadge(item.status)}</td>
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
              {allOrganisasi.length === 0 ? (
                <p className="text-muted">Belum ada data organisasi</p>
              ) : filteredOrganisasi.length === 0 ? (
                <p className="text-muted">Tidak ada data yang cocok dengan pencarian</p>
              ) : null}
            </div>
            </>
          )}
        </div>
      )}
      
      {/* Input Form - Show for non-superadmin or when showForm is true */}
      {((userRole !== 'superadmin' && !canApprove) || showForm) && (
        <form onSubmit={handleSubmit}>
        <div className="form-grid-2">
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
          <label>Kategori Organisasi</label>
          <select name="kategori_organisasi" value={formData.kategori_organisasi} onChange={handleChange} required>
            <option value="" disabled hidden>Pilih Organisasi</option>
            {organisasiOptions.map(org => (
              <option key={org.id} value={org.name}>{org.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Jabatan Organisasi</label>
          <select name="jabatan_organisasi" value={formData.jabatan_organisasi} onChange={handleChange} required>
            <option value="" disabled hidden>Pilih Jabatan</option>
            {jabatanOptions.map(jabatan => (
              <option key={jabatan.value} value={jabatan.value}>{jabatan.label} {formData.jabatan_organisasi === jabatan.value && calculatedPoint ? `(${calculatedPoint} point)` : ''}</option>
            ))}
          </select>
        </div>

        <div className="form-group" style={{ 
          padding: '12px', 
          background: '#EAFBF3',
          borderRadius: '4px',
          marginTop: '12px'
        }}>
          <label style={{ fontWeight: '600', marginBottom: '4px', display: 'block' }}>
            Point IPT yang akan didapatkan:
          </label>
          <span style={{ 
            fontSize: '18px', 
            fontWeight: '700',
            color: '#0F7A55'
          }}>
            +{calculatedPoint}
          </span>
        </div>

        <div className="form-group">
          <label>Foto/Dokumen Bukti (JPG, PNG, GIF, WebP, PDF - maks 10MB)</label>
          <input type="file" onChange={handleFileChange} accept="image/*,.pdf" />
        </div>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Mengirim...' : (userRole === 'superadmin' ? 'Kirim' : 'Ajukan untuk Persetujuan')}
        </button>
      </form>
      )}

      <EditModal
        isOpen={editModal.showEditModal}
        title="Edit Organisasi"
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
            style={{ backgroundColor: '#f0f0f0', cursor: 'not-allowed' }}
          />
        </div>

        <div className="form-group">
          <label>Grha</label>
          <select 
            value={editModal.editFormData.grha || ''} 
            disabled
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, grha: e.target.value })}
          >
            <option value="" disabled hidden>Pilih Grha</option>
            {grhaOptions.map(grha => (
              <option key={grha} value={grha}>{grha}</option>
            ))}
          </select>
          <small style={{ color: '#666', fontSize: '12px' }}>Auto-filled from student data</small>
        </div>

        <div className="form-group">
          <label>Kategori Organisasi</label>
          <select
            value={editModal.editFormData.kategori_organisasi || ''}
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, kategori_organisasi: e.target.value })}
          >
            <option value="" disabled hidden>Pilih Organisasi</option>
            {editModal.editFormData.kategori_organisasi &&
              !organisasiOptions.some(org => org.name === editModal.editFormData.kategori_organisasi) && (
                <option value={editModal.editFormData.kategori_organisasi}>
                  {editModal.editFormData.kategori_organisasi}
                </option>
              )}
            {organisasiOptions.map(org => (
              <option key={org.id} value={org.name}>{org.name}</option>
            ))}
          </select>
        </div>
        
        <div className="form-group">
          <label>Jabatan Organisasi</label>
          <select 
            value={editModal.editFormData.jabatan_organisasi || ''} 
            onChange={(e) => editModal.setEditFormData({ ...editModal.editFormData, jabatan_organisasi: e.target.value })}
          >
            <option value="" disabled hidden>Pilih Jabatan</option>
            {jabatanOptions.map(jabatan => (
              <option key={jabatan.value} value={jabatan.value}>{jabatan.label}</option>
            ))}
          </select>
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

      {/* Submission History - Hidden for approvers */}
      {!canApprove && submissions.length > 0 && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={18} /> Riwayat Pengajuan Organisasi</h3>
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
                  <strong style={{ fontSize: '14px' }}>{sub.kategori_organisasi}</strong>
                  <p style={{ margin: '4px 0', fontSize: '13px', color: '#666' }}>
                    {sub.nama} ({sub.nis}) - {sub.jabatan_organisasi}
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
        </div>
      )}
    </div>
  );
}

export default InputOrganisasi;
