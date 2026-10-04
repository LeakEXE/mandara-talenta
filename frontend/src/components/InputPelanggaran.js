import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import EditModal from './EditModal';
import useEditModal from '../hooks/useEditModal';
import API_BASE_URL from '../config';
import Select from 'react-select';
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
  const jenisOptions = (iptConfig['pelanggaran'] || [])
    .filter(config => config.field2)
    .map(config => {
      const level = (iptConfig['pelanggaran'] || []).find(
        candidate => !candidate.field2 && candidate.field1 === config.field2
      );
      return { value: config.field1, label: config.field1, level: config.field2, point: level?.point_value || 0 };
    });
  // Options with level info (e.g. "mencuri (berat)") — shared by the dropdown
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
      fetchAllPelanggaran();
    } else if (user.role === 'guru' || user.role === 'pegawai') {
      api.get('/permissions/my-permissions').then(r => { const scopes = r.data?.approval_scopes || []; const allowed = scopes.includes('pelanggaran'); setCanApprove(allowed); if (allowed) fetchAllPelanggaran(); }).catch(() => setCanApprove(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAllPelanggaran = async () => {
    try {
      setLoadingIndex(true);
      const response = await api.get('/pelanggaran/all');
      setAllPelanggaran(response.data);
    } catch (error) {
      console.error('Error fetching all pelanggaran:', error);
    } finally {
      setLoadingIndex(false);
    }
  };

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

      await api.post('/approvals/pelanggaran/submit', data);

      setMessage(userRole === 'superadmin' ? 'Pelanggaran berhasil ditambahkan!' : 'Pelanggaran berhasil diajukan untuk persetujuan!');
      if (userRole === 'superadmin') {
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

  const filteredPelanggaran = allPelanggaran.filter((item) => {
    const query = indexSearch.trim().toLowerCase();
    if (!query) return true;
    return [item.nama, item.nis, item.keterangan, item.jenis_pelanggaran, item.point_dikurangi]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  });

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
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
            <input
              type="text"
              value={indexSearch}
              onChange={(e) => setIndexSearch(e.target.value)}
              placeholder="Cari nama, NIS, detail, jenis..."
              style={{ flex: '1', minWidth: '200px', padding: '8px 12px', border: '1px solid #d0d0d0', borderRadius: '4px' }}
            />
            {userRole === 'superadmin' && selectedIndexIds.length > 0 && (
              <>
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
              </>
            )}
          </div>
          {loadingIndex ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : (
            <div style={{ maxHeight: '400px', overflowX: 'auto', overflowY: 'auto' }}>
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
          )}
        </div>
      )}
      
      {/* Input Form - Show for non-superadmin or when showForm is true */}
      {((userRole !== 'superadmin' && !canApprove) || showForm) && (
        <form onSubmit={handleSubmit}>
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
          <label>Foto/Dokumen Bukti {editModal.editingItem?.foto && '(Pilih untuk ganti)'} (JPG, PNG, GIF, WebP, PDF — maks 10MB)</label>
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
