import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { Folder, FileText } from 'lucide-react';
import { EvidenceViewer, isPdfPath } from './EvidenceViewer';

function DriveViewer() {
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [previewImage, setPreviewImage] = useState(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [folderError, setFolderError] = useState('');
  const [filters, setFilters] = useState({
    fileType: '',
    searchQuery: '',
    minSize: '',
    maxSize: '',
    kelas: '',
    grha: '',
    refStatus: ''
  });
  const [studentsData, setStudentsData] = useState({});

  const kelasOptions = [
    'X TKJ 1', 'X TKJ 2', 'X DPIB 1', 'X DPIB 2', 'X TKR 1', 'X TKR 2',
    'XI TKJ 1', 'XI TKJ 2', 'XI DPIB 1', 'XI DPIB 2', 'XI TKR 1', 'XI TKR 2',
    'XII TKJ 1', 'XII TKJ 2', 'XII DPIB 1', 'XII DPIB 2', 'XII TKR 1', 'XII TKR 2'
  ];

  const grhaOptions = [
    'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
  ];

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const response = await api.get('/file-viewer/folders');
      setFolders(response.data);
    } catch (error) {
      console.error('Error fetching folders:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFiles = async (folderName) => {
    try {
      setLoading(true);
      setFolderError('');
      const response = await api.get(`/file-viewer/files/${folderName}`);
      setFiles(response.data);
      setSelectedFolder(folderName);
      setPage(1);
      // Load student data for files
      loadStudentsDataForFiles(response.data);
    } catch (error) {
      console.error('Error fetching files:', error);
      setFolderError(error.response?.data?.message || `Gagal membuka folder ${folderName}`);
    } finally {
      setLoading(false);
    }
  };

  const deleteFile = async (file) => {
    const subpath = file.subfolder ? `${file.subfolder}/${file.name}` : file.name;
    if (!window.confirm(`Apakah Anda yakin ingin menghapus ${subpath}?`)) {
      return;
    }

    try {
      const encoded = subpath.split('/').map(encodeURIComponent).join('/');
      await api.delete(`/file-viewer/file/${selectedFolder}/${encoded}`);
      // Refresh file list
      fetchFiles(selectedFolder);
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Gagal menghapus file');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('id-ID', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const viewImage = (file) => {
    const imageUrl = `${API_BASE_URL.replace('/api', '')}${file.path}`;
    setPreviewImage(imageUrl);
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setPage(1);
  };

  const resetFilters = () => {
    setFilters({ fileType: '', searchQuery: '', minSize: '', maxSize: '', kelas: '', grha: '', refStatus: '' });
    setPage(1);
  };

  const extractNISFromFilename = (filename) => {
    // Try to extract NIS from filename pattern like "12345_prestasi.jpg" or "12345-event.png"
    const match = filename.match(/^(\d+)[_-]/);
    return match ? match[1] : null;
  };

  // Single batch lookup per folder open (replaces one request per NIS)
  const loadStudentsDataForFiles = async (fileList) => {
    const nisSet = new Set();
    fileList.forEach(file => {
      const nis = extractNISFromFilename(file.name);
      if (nis) nisSet.add(nis);
    });

    if (nisSet.size === 0) {
      setStudentsData({});
      return;
    }

    try {
      const response = await api.post('/users/nis-batch', { nis: Array.from(nisSet) });
      setStudentsData(response.data || {});
    } catch (error) {
      console.error('Error batch fetching students:', error);
      setStudentsData({});
    }
  };

  const filteredFiles = files.filter(file => {
    if (filters.fileType && !file.name.toLowerCase().endsWith(filters.fileType.toLowerCase())) {
      return false;
    }
    if (filters.searchQuery && !file.name.toLowerCase().includes(filters.searchQuery.toLowerCase())) {
      return false;
    }
    if (filters.minSize && file.size < parseInt(filters.minSize) * 1024) {
      return false;
    }
    if (filters.maxSize && file.size > parseInt(filters.maxSize) * 1024) {
      return false;
    }

    // DB cross-check from the backend: hide files no record references
    if (filters.refStatus === 'used' && !file.referenced) {
      return false;
    }
    if (filters.refStatus === 'orphan' && file.referenced !== false) {
      return false;
    }

    // Filter by student attributes extracted from filename
    const nis = extractNISFromFilename(file.name);
    if (nis && studentsData[nis]) {
      const student = studentsData[nis];
      if (filters.kelas && student.kelas !== filters.kelas) {
        return false;
      }
      if (filters.grha && student.grha !== filters.grha) {
        return false;
      }
    } else if (filters.kelas || filters.grha) {
      // If student filters are active but we can't find student data, exclude this file
      return false;
    }

    return true;
  });

  // Distinct file extensions in this folder (for the type filter)
  const fileTypeOptions = [...new Set(
    files.map((f) => {
      const m = f.name.toLowerCase().match(/\.([a-z0-9]+)$/);
      return m ? m[1] : null;
    }).filter(Boolean)
  )].sort();

  // Client-side paging (same pattern as IzinAkun: backend returns all files)
  const totalPages = Math.max(Math.ceil(filteredFiles.length / limit), 1);
  const safePage = Math.min(page, totalPages);
  const pagedFiles = filteredFiles.slice((safePage - 1) * limit, safePage * limit);
  const from = filteredFiles.length === 0 ? 0 : (safePage - 1) * limit + 1;
  const to = Math.min(safePage * limit, filteredFiles.length);

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const candidates = new Set([1, 2, safePage - 1, safePage, safePage + 1, totalPages - 1, totalPages]);
    const nums = [...candidates].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) out.push('...');
      out.push(n);
    });
    return out;
  };

  // Only images and PDFs can be previewed in-app
  const isViewable = (fileName) => /\.(jpe?g|png|gif|webp|pdf)$/i.test(fileName);

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h2 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}><Folder size={24} /> File Manager (Local Storage)</h2>
      
      {!selectedFolder ? (
        <div>
          <h3 style={{ marginBottom: '15px' }}>Folders</h3>
          {folderError && (
            <div className="alert alert-danger" style={{ marginBottom: '15px' }}>{folderError}</div>
          )}
          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
          ) : folders.length === 0 ? (
            <div style={{ padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px', textAlign: 'center' }}>
              No folders found in uploads directory
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              {folders.map((folder) => (
                <div
                  key={folder.name}
                  onClick={() => fetchFiles(folder.name)}
                  style={{
                    padding: '20px',
                    backgroundColor: 'white',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px'
                  }}
                  onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f0f0'}
                  onMouseLeave={(e) => e.target.style.backgroundColor = 'white'}
                >
                  <span style={{ display: 'inline-flex', color: 'var(--warning-color)' }}><Folder size={24} /></span>
                  <span style={{ fontWeight: '500' }}>{folder.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <button
            onClick={() => {
              setSelectedFolder(null);
              setFiles([]);
              setStudentsData({});
              setPage(1);
            }}
            style={{
              marginBottom: '15px',
              padding: '8px 16px',
              backgroundColor: 'var(--blue)',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer'
            }}
          >
            ← Back to Folders
          </button>
          
          <h3 style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Folder size={19} /> {selectedFolder} ({filteredFiles.length} dari {files.length} file)
          </h3>

          {/* Filters */}
          <div className="card" style={{ marginBottom: '20px', padding: '15px' }}>
            <h4>Filter</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', alignItems: 'end' }}>
              <div style={{ gridColumn: 'span 2' }}>
                <label>Cari Nama File</label>
                <input
                  type="text"
                  value={filters.searchQuery}
                  onChange={(e) => handleFilterChange('searchQuery', e.target.value)}
                  placeholder="cth: 12345 atau lomba"
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label>Tipe File</label>
                <select
                  value={filters.fileType}
                  onChange={(e) => handleFilterChange('fileType', e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                >
                  <option value="">Semua Tipe</option>
                  {fileTypeOptions.map((ext) => <option key={ext} value={`.${ext}`}>.{ext}</option>)}
                </select>
              </div>
              <div>
                <label>Min (KB)</label>
                <input
                  type="number"
                  min="0"
                  value={filters.minSize}
                  onChange={(e) => handleFilterChange('minSize', e.target.value)}
                  placeholder="0"
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label>Maks (KB)</label>
                <input
                  type="number"
                  min="0"
                  value={filters.maxSize}
                  onChange={(e) => handleFilterChange('maxSize', e.target.value)}
                  placeholder="-"
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label>Kelas</label>
                <select
                  value={filters.kelas}
                  onChange={(e) => handleFilterChange('kelas', e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                >
                  <option value="">Semua Kelas</option>
                  {kelasOptions.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label>Grha</label>
                <select
                  value={filters.grha}
                  onChange={(e) => handleFilterChange('grha', e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                >
                  <option value="">Semua Grha</option>
                  {grhaOptions.map(grha => <option key={grha} value={grha}>{grha}</option>)}
                </select>
              </div>
              <div>
                <label>Status</label>
                <select
                  value={filters.refStatus}
                  onChange={(e) => handleFilterChange('refStatus', e.target.value)}
                  className="form-control"
                  style={{ width: '100%' }}
                >
                  <option value="">Semua Status</option>
                  <option value="used">Terpakai</option>
                  <option value="orphan">Yatim</option>
                </select>
              </div>
              <div>
                <button className="btn btn-secondary" onClick={resetFilters} style={{ width: '100%' }}>Reset</button>
              </div>
            </div>
            <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
              Filter Kelas/Grha memakai NIS dari awal nama file (cth: 12345_prestasi.jpg). File tanpa pola tersebut disembunyikan saat filter Kelas/Grha aktif.
            </div>
          </div>

          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>Loading...</div>
          ) : filteredFiles.length === 0 ? (
            <div style={{ padding: '20px', backgroundColor: '#f5f5f5', borderRadius: '8px', textAlign: 'center' }}>
              {files.length === 0 ? 'No files in this folder' : 'No files match your filters'}
            </div>
          ) : (
            <div style={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #ddd', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--blue)', color: 'white' }}>
                    <th style={{ padding: '12px', textAlign: 'left' }}>File Name</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Lokasi</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Size</th>
                    <th style={{ padding: '12px', textAlign: 'left' }}>Created</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedFiles.map((file, index) => (
                    <tr
                      key={file.path}
                      style={{ backgroundColor: index % 2 === 0 ? 'white' : '#f9f9f9' }}
                    >
                      <td style={{ padding: '12px' }}>
                        {isViewable(file.name) ? (
                          <button
                            onClick={() => viewImage(file)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--blue)',
                              textDecoration: 'none',
                              fontWeight: '500',
                              cursor: 'pointer',
                              padding: 0,
                              textAlign: 'left'
                            }}
                          >
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={14} /> {file.name}</span>
                          </button>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: '500', color: '#333' }}><FileText size={14} /> {file.name}</span>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: '#666' }}>
                        {file.subfolder || '-'}
                        {file.referenced === false && (
                          <span style={{
                            display: 'inline-block', marginLeft: '6px', fontSize: '10.5px', fontWeight: '700',
                            background: '#fef3c7', color: '#a86a05', padding: '2px 8px', borderRadius: '999px',
                            verticalAlign: 'middle'
                          }}>
                            Yatim
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px', color: '#666' }}>{formatFileSize(file.size)}</td>
                      <td style={{ padding: '12px', color: '#666' }}>{formatDate(file.created)}</td>
                      <td style={{ padding: '12px', textAlign: 'center' }}>
                        <button
                          onClick={() => deleteFile(file)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--danger-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination client-side, same pattern as IzinAkun */}
          {!loading && filteredFiles.length > 0 && (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                flexWrap: 'wrap', gap: '12px', marginTop: '16px'
              }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
                  <label htmlFor="drive-limit">Baris per halaman:</label>
                  <select
                    id="drive-limit"
                    value={limit}
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
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage <= 1}
                    style={{
                      padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                      fontSize: '12px', cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                      background: safePage <= 1 ? '#f5f5f5' : 'white',
                      color: safePage <= 1 ? '#999' : '#333'
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
                        disabled={p === safePage}
                        style={{
                          minWidth: '30px', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: '4px',
                          fontSize: '12px', cursor: p === safePage ? 'default' : 'pointer',
                          background: p === safePage ? 'var(--blue)' : 'white',
                          color: p === safePage ? 'white' : '#333',
                          fontWeight: p === safePage ? '700' : '400'
                        }}
                      >
                        {p}
                      </button>
                    )
                  ))}
                  <button
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= totalPages}
                    style={{
                      padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                      fontSize: '12px', cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                      background: safePage >= totalPages ? '#f5f5f5' : 'white',
                      color: safePage >= totalPages ? '#999' : '#333'
                    }}
                  >
                    Selanjutnya →
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                Menampilkan {from}&ndash;{to} dari {filteredFiles.length} file (Halaman {safePage} dari {totalPages})
              </div>
            </>
          )}
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="app-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1500,
            cursor: 'pointer'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              width: isPdfPath(previewImage) ? 'min(880px, 90vw)' : undefined,
              position: 'relative'
            }}
          >
            {isPdfPath(previewImage) ? (
              <EvidenceViewer src={previewImage} alt="Preview" pdfHeight="70vh" />
            ) : (
            <img
              src={previewImage}
              alt="Preview"
              style={{
                maxWidth: '100%',
                maxHeight: '90vh',
                borderRadius: '8px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
              }}
              onError={() => {
                alert('Failed to load image');
                setPreviewImage(null);
              }}
            />
            )}
            <button
              onClick={() => setPreviewImage(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: 0,
                background: 'white',
                color: 'black',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '20px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DriveViewer;
