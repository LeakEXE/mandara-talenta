import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import StudentDetail from './StudentDetail';
import SearchableTeacherSelect from './SearchableTeacherSelect';
import { GraduationCap, BarChart3, Users, User, Settings, Search, Pencil, Lightbulb, CircleCheck, TriangleAlert } from 'lucide-react';

function getCurrentAcademicYear() {
  const now = new Date();
  const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${startYear + 1}`;
}

function getAcademicYearOptions() {
  const options = [];
  for (let startYear = 2024; startYear <= 2034; startYear += 1) {
    options.push(`${startYear}-${startYear + 1}`);
  }
  return options;
}

function getIptDetailRows(points = {}) {
  return [
    ['Prestasi', Number(points.prestasi) || 0],
    ['Perilaku', ['tanggung_jawab', 'disiplin', 'kepedulian', 'kemandirian', 'spiritual', 'kejujuran', 'kepercayaan_diri']
      .reduce((sum, key) => sum + (Number(points[key]) || 0), 0)],
    ['Organisasi', Number(points.organisasi) || 0],
    ['Kepanitiaan', Number(points.kepanitiaan) || 0],
    ['Event', Number(points.event) || 0],
    ['Pelanggaran', -(['pelanggaran_ringan', 'pelanggaran_sedang', 'pelanggaran_berat']
      .reduce((sum, key) => sum + (Number(points[key]) || 0), 0))]
  ];
}

function WaliKelas() {
  const minIpt = useMinIptPerGrade();
  const [assignments, setAssignments] = useState([]);
  const [classStats, setClassStats] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [selectedClass, setSelectedClass] = useState(null);
  const [showClassDetail, setShowClassDetail] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showStudentDetail, setShowStudentDetail] = useState(false);
  const [showMismatches, setShowMismatches] = useState(false);
  const [mismatches, setMismatches] = useState(null);
  const [loadingMismatches, setLoadingMismatches] = useState(false);
  
  const currentAcademicYear = getCurrentAcademicYear();
  const academicYearOptions = getAcademicYearOptions();
  const [selectedAcademicYear, setSelectedAcademicYear] = useState(currentAcademicYear);
  const [formData, setFormData] = useState({
    guru_id: '',
    kelas: '',
    tahun_ajaran: currentAcademicYear
  });

  const kelasOptions = [
    'X TKJ 1', 'X TKJ 2', 'X TKR 1', 'X TKR 2',
    'X DPIB 1', 'X DPIB 2',
    'XI TKJ 1', 'XI TKJ 2', 'XI TKR 1', 'XI TKR 2',
    'XI DPIB 1', 'XI DPIB 2',
    'XII TKJ 1', 'XII TKJ 2', 'XII TKR 1', 'XII TKR 2',
    'XII DPIB 1', 'XII DPIB 2'
  ];

  const fetchAssignments = useCallback(async () => {
    try {
      const response = await api.get('/wali-kelas');
      setAssignments(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching assignments:', err);
      setError('Gagal mengambil data assignment');
    }
  }, []);

  const fetchClassStatistics = useCallback(async () => {
    try {
      const response = await api.get('/wali-kelas/class-statistics', {
        params: { tahun_ajaran: selectedAcademicYear }
      });
      setClassStats(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching class statistics:', err);
      setError('Gagal mengambil statistik kelas');
    } finally {
      setLoading(false);
    }
  }, [selectedAcademicYear]);

  const fetchTeachers = useCallback(async () => {
    try {
      const response = await api.get('/wali-kelas/available-teachers', {
        params: { tahun_ajaran: selectedAcademicYear }
      });
      setTeachers(response.data);
      setError(null);
    } catch (err) {
      console.error('Error fetching teachers:', err);
      setError('Gagal mengambil data guru');
    }
  }, [selectedAcademicYear]);

  useEffect(() => {
    fetchAssignments();
  }, [fetchAssignments]);

  useEffect(() => {
    setLoading(true);
    fetchTeachers();
    fetchClassStatistics();
  }, [selectedAcademicYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      const response = await api.post('/wali-kelas', formData);
      alert(response.data.message);
      setShowForm(false);
      setFormData({ guru_id: '', kelas: '', tahun_ajaran: selectedAcademicYear });
      fetchAssignments();
      fetchClassStatistics();
      fetchTeachers();
      setError(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Gagal membuat assignment');
      console.error('Error creating assignment:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus assignment ini?')) return;
    
    try {
      const response = await api.delete(`/wali-kelas/${id}`);
      alert(response.data.message);
      fetchAssignments();
      fetchClassStatistics();
      fetchTeachers();
      setError(null);
    } catch (err) {
      alert(err.response?.data?.message || 'Gagal menghapus assignment');
      console.error('Error deleting assignment:', err);
    }
  };

  const handleViewClassDetail = (cls) => {
    setSelectedClass(cls);
    setShowClassDetail(true);
  };

  const handleViewStudentDetail = (student) => {
    // StudentDetail fetches its own history/records/evidence.
    // Carry the class context for the below-minimum IPT badge.
    setSelectedStudent({ ...student, kelas: student.kelas || student.current_kelas || selectedClass?.kelas });
    setShowStudentDetail(true);
  };

  const handleCheckMismatches = async () => {
    setLoadingMismatches(true);
    try {
      const response = await api.get('/wali-kelas/class-mismatches', {
        params: { tahun_ajaran: selectedAcademicYear }
      });
      setMismatches(response.data);
      setShowMismatches(true);
      setError(null);
    } catch (err) {
      console.error('Error checking mismatches:', err);
      alert('Gagal mengecek ketidaksesuaian kelas');
    } finally {
      setLoadingMismatches(false);
    }
  };

  const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    const baseUrl = API_BASE_URL.replace('/api', '');
    return `${baseUrl}${imagePath}`;
  };

  if (loading) {
    return (
      <div data-aos="fade-up">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><GraduationCap size={26} /> Manajemen Wali Kelas</h2>
        <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
          <div className="spinner" style={{ marginBottom: '20px' }}></div>
          <p>Memuat data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div data-aos="fade-up">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><GraduationCap size={26} /> Manajemen Wali Kelas</h2>
        <div className="card" style={{ textAlign: 'center', padding: '60px', color: '#ef4444' }}>
          <p style={{ fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><TriangleAlert size={20} /> {error}</p>
          <button onClick={() => { setError(null); setLoading(true); fetchClassStatistics(); }} 
            style={{ marginTop: '20px', padding: '8px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  // Calculate totals
  const totalSiswa = classStats.reduce((sum, cls) => sum + cls.totalSiswa, 0);
  const totalPrestasi = classStats.reduce((sum, cls) => sum + cls.totalPrestasi, 0);
  const totalEvent = classStats.reduce((sum, cls) => sum + cls.totalEvent, 0);
  const totalOrganisasi = classStats.reduce((sum, cls) => sum + cls.totalOrganisasi, 0);
  const totalKepanitiaan = classStats.reduce((sum, cls) => sum + cls.totalKepanitiaan, 0);
  const totalPelanggaran = classStats.reduce((sum, cls) => sum + cls.totalPelanggaran, 0);

  return (
    <div style={{ padding: '4px 4px 40px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px', animation: 'waliFade 0.3s ease-out' }}>
      <style>{`
        @keyframes waliFade {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .stat-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 25px rgba(15,23,42,.12);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .kelas-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 8px 25px rgba(15,23,42,.12);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,.15);
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .btn:active {
          transform: translateY(0);
        }
        @media (max-width: 1024px) {
          .stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
          .kelas-grid { grid-template-columns: 1fr !important; }
          .detail-stats-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 480px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px; }
          .stat-card { padding: 14px 8px; }
          .stat-card .num { font-size: 1.3rem; }
          .panel { padding: 16px; }
          .kelas-card-footer .btn { width: 100%; }
          table { min-width: 520px; }
          .detail-stats-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px; }
          .detail-stats-grid > div { padding: 12px 8px; }
          .detail-stats-grid > div > div:first-child { font-size: 1.2rem; }
        }
        /* Modal responsive */
        @media (max-width: 1024px) {
          .modal-content { max-width: 95% !important; }
          .modal-header { flex-direction: column !important; align-items: flex-start !important; gap: 10px !important; }
          .modal-header .btn { width: 100% !important; }
        }
        @media (max-width: 480px) {
          .modal-content { max-width: 100% !important; margin: 0 !important; border-radius: 0 !important; }
          .modal-overlay { padding: 0 !important; }
          .modal-header { padding: 16px !important; }
          .modal-header > div:first-child { font-size: 1rem !important; }
          .modal-body { padding: 16px !important; }
          .modal-body > div:nth-child(2), .modal-body > div:nth-child(3) { font-size: .85rem !important; }
        }
      `}</style>

      {/* HEADER */}
      <div style={{
        background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
        borderRadius: '14px',
        padding: '24px 28px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        color: '#fff',
        boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 1px 8px rgba(15,23,42,.05)'
      }}>
        <div style={{
          width: '52px',
          height: '52px',
          borderRadius: '12px',
          background: 'rgba(255,255,255,.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '26px',
          flexShrink: 0
        }}>
          <GraduationCap size={26} />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, letterSpacing: '-0.01em', color: '#fff' }}>Manajemen Wali Kelas</h1>
          <p style={{ margin: '2px 0 0', fontSize: '.85rem', color: 'rgba(255,255,255,0.92)', fontWeight: 400 }}>Kelola wali kelas dan lihat statistik seluruh kelas</p>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '14px' }}>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#2563eb', marginBottom: '6px' }}>{classStats.length}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL KELAS</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#3B82F6', marginBottom: '6px' }}>{totalSiswa}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL SISWA</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#16a34a', marginBottom: '6px' }}>{totalPrestasi}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL PRESTASI</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#7c3aed', marginBottom: '6px' }}>{totalEvent}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL EVENT</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f59e0b', marginBottom: '6px' }}>{totalOrganisasi}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL ORGANISASI</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#f59e0b', marginBottom: '6px' }}>{totalKepanitiaan}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL KEPANITIAAN</div>
        </div>
        <div className="stat-card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '18px 12px', textAlign: 'center', boxShadow: '0 1px 2px rgba(15,23,42,.04)', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }}>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: totalPelanggaran > 0 ? '#ef4444' : '#16a34a', marginBottom: '6px' }}>{totalPelanggaran}</div>
          <div style={{ fontSize: '.7rem', color: '#64748b', fontWeight: 600 }}>TOTAL PELANGGARAN</div>
        </div>
      </div>

      {/* OVERVIEW PER KELAS */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem', fontWeight: 700, color: '#0f172a', margin: '4px 0 -6px' }}>
        <BarChart3 size={18} /> Overview per Kelas
      </div>
      <div className="kelas-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {classStats.map((cls) => (
          <div key={`${selectedAcademicYear}-${cls.kelas}`} className="kelas-card" style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderLeft: '4px solid #2563eb',
            borderRadius: '14px',
            padding: '18px 20px',
            boxShadow: '0 1px 2px rgba(15,23,42,.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{cls.kelas}</h3>
              <span style={{ background: '#2563eb', color: '#fff', fontSize: '.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: '999px' }}>{cls.totalSiswa} Siswa</span>
            </div>
            <div>
              <span style={{ fontSize: '.72rem', color: '#64748b', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Wali Kelas:</span>
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0, overflow: 'hidden' }}>
                  {cls.wali?.foto ? (
                    <img src={getImageUrl(cls.wali.foto)} alt={cls.wali.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#2563eb', fontSize: '.9rem' }}>{cls.wali?.nama}</div>
                  <div style={{ fontSize: '.75rem', color: '#64748b' }}>NIP: {cls.wali?.nip}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
              <div style={{ borderRadius: '10px', padding: '10px 6px', textAlign: 'center', background: '#dcfce7' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#16a34a' }}>{cls.totalPrestasi}</div>
                <div style={{ fontSize: '.68rem', color: '#64748b', fontWeight: 500 }}>Prestasi</div>
              </div>
              <div style={{ borderRadius: '10px', padding: '10px 6px', textAlign: 'center', background: '#f3e8ff' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#7c3aed' }}>{cls.totalEvent}</div>
                <div style={{ fontSize: '.68rem', color: '#64748b', fontWeight: 500 }}>Event</div>
              </div>
              <div style={{ borderRadius: '10px', padding: '10px 6px', textAlign: 'center', background: '#fef3c7' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b' }}>{cls.totalOrganisasi}</div>
                <div style={{ fontSize: '.68rem', color: '#64748b', fontWeight: 500 }}>Organisasi</div>
              </div>
              <div style={{ borderRadius: '10px', padding: '10px 6px', textAlign: 'center', background: '#fef3c7' }}>
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#f59e0b' }}>{cls.totalKepanitiaan}</div>
                <div style={{ fontSize: '.68rem', color: '#64748b', fontWeight: 500 }}>Kepanitiaan</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: '999px', background: cls.totalPelanggaran > 0 ? '#ffebee' : '#dcfce7', color: cls.totalPelanggaran > 0 ? '#ef4444' : '#16a34a' }}>{cls.totalPelanggaran} Pelanggaran</span>
                <span style={{ fontSize: '.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: '999px', background: '#cffafe', color: '#0891b2' }}>Rata-rata IPT: {cls.rataRataIPT}</span>
              </div>
              <button onClick={() => handleViewClassDetail(cls)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#2563eb', color: '#fff', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>Lihat Detail</button>
            </div>
          </div>
        ))}
      </div>

      {/* MANAGEMENT PANEL */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '14px', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem', fontWeight: 700 }}><Settings size={18} /> Manajemen Wali Kelas</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#64748b', marginBottom: '5px' }}>Tahun Ajaran</label>
              <select
                value={selectedAcademicYear}
                onChange={(e) => {
                  const year = e.target.value;
                  setSelectedAcademicYear(year);
                  setFormData((current) => ({ ...current, tahun_ajaran: year }));
                }}
                style={{ fontFamily: 'inherit', fontSize: '.85rem', padding: '9px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', outline: 'none' }}
              >
                {academicYearOptions.map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => { setFormData((current) => ({ ...current, tahun_ajaran: selectedAcademicYear })); setShowForm(true); }} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#2563eb', color: '#fff', whiteSpace: 'nowrap', transition: 'all 0.2s', display: 'inline-flex', alignItems: 'center', gap: '6px' }}><Pencil size={14} /> Assign Wali Kelas Baru</button>
              <button onClick={handleCheckMismatches} disabled={loadingMismatches} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#f59e0b', color: '#fff', whiteSpace: 'nowrap', transition: 'all 0.2s', opacity: loadingMismatches ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>{loadingMismatches ? 'Mengecek...' : <><Search size={14} /> Cek Ketidaksesuaian Kelas</>}</button>
            </div>
          </div>
        </div>

        {/* Assign form */}
        {showForm && (
          <div style={{ border: '1px solid #eff6ff', background: '#eff6ff', borderRadius: '10px', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}><Pencil size={15} /> Assign Wali Kelas Baru</div>
              <button onClick={() => setShowForm(false)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s' }}>Tutup</button>
            </div>
            <form onSubmit={handleCreate} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#64748b', marginBottom: '5px' }}>Guru</label>
                <SearchableTeacherSelect
                  value={formData.guru_id}
                  teachers={teachers}
                  onChange={(id) => setFormData({ ...formData, guru_id: id })}
                  placeholder="Cari nama guru..."
                  required
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#64748b', marginBottom: '5px' }}>Kelas</label>
                <select value={formData.kelas} onChange={(e) => setFormData({...formData, kelas: e.target.value})} required style={{ fontFamily: 'inherit', fontSize: '.85rem', padding: '9px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', outline: 'none', width: '100%' }}>
                  <option value="" disabled hidden>Pilih Kelas</option>
                  {kelasOptions.map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 600, color: '#64748b', marginBottom: '5px' }}>Tahun Ajaran</label>
                <select value={formData.tahun_ajaran} onChange={(e) => setFormData({...formData, tahun_ajaran: e.target.value})} required style={{ fontFamily: 'inherit', fontSize: '.85rem', padding: '9px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', outline: 'none', width: '100%' }}>
                  {academicYearOptions.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <button type="submit" className="btn" style={{ border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#16a34a', color: '#fff', width: '100%', transition: 'all 0.2s' }}>Simpan Assignment</button>
              </div>
            </form>
          </div>
        )}

        {/* Class Mismatches Modal */}
        {showMismatches && mismatches && (
          <div className="app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1500 }}>
            <div style={{ background: '#fff', borderRadius: '14px', padding: '30px', maxWidth: '900px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><Search size={18} /> Ketidaksesuaian Kelas</h3>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ background: '#e3f2fd', color: '#1976d2', padding: '6px 12px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 600 }}>Tahun Ajaran: {mismatches.tahun_ajaran}</span>
                  <button onClick={() => setShowMismatches(false)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '8px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s' }}>Tutup</button>
                </div>
              </div>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px', marginBottom: '15px' }}>
                  <div style={{ padding: '15px', backgroundColor: '#e3f2fd', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1976d2' }}>{mismatches.totalStudents}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Total Siswa Aktif</div>
                  </div>
                  <div style={{ padding: '15px', backgroundColor: mismatches.mismatchCount > 0 ? '#ffebee' : '#e8f5e9', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: mismatches.mismatchCount > 0 ? '#c62828' : '#2e7d32' }}>{mismatches.mismatchCount}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>Siswa Kelas Tidak Sesuai</div>
                  </div>
                </div>
                {mismatches.mismatchCount > 0 && mismatches.mismatches ? (
                  <div style={{ marginBottom: '15px' }}>
                    <p style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>Siswa-siswa berikut memiliki kelas yang tidak sesuai dengan perhitungan otomatis berdasarkan tahun pelajaran:</p>
                    <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
                        <thead>
                          <tr style={{ background: '#f8fafc' }}>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Nama</th>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>NIS</th>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Kelas Saat Ini</th>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Kelas Sesuai Tahun</th>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Tahun Pelajaran</th>
                            <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Jurusan</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mismatches.mismatches.map((mismatch, index) => (
                            <tr key={index} style={{ backgroundColor: index % 2 === 0 ? '#fff' : '#f8f9fa' }}>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{mismatch.nama}</td>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{mismatch.nis}</td>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#c62828', fontWeight: 'bold' }}>{mismatch.current_kelas}</td>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#2e7d32', fontWeight: 'bold' }}>{mismatch.expected_kelas}</td>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{mismatch.tahun_pelajaran}</td>
                              <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{mismatch.jurusan}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div style={{ marginTop: '15px', padding: '10px', backgroundColor: '#fff3cd', borderRadius: '4px', fontSize: '12px' }}>
                      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Lightbulb size={13} /> Solusi:</strong> Gunakan fitur "Validasi Kelas" di halaman Kelola Akun untuk memperbaiki ketidaksesuaian ini secara otomatis.
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '20px', backgroundColor: '#e8f5e9', borderRadius: '8px', textAlign: 'center', color: '#2e7d32' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', color: '#16a34a' }}><CircleCheck size={48} /></div>
                    <strong>Semua siswa memiliki kelas yang sesuai dengan perhitungan tahun pelajaran!</strong>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Guru</th>
                <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>NIP</th>
                <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Kelas</th>
                <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Tahun Ajaran</th>
                <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {assignments.filter(assignment => assignment.tahun_ajaran === selectedAcademicYear).map(assignment => (
                <tr key={assignment.id}>
                  <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, color: '#0f172a' }}>
                      <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', overflow: 'hidden' }}>
                        {assignment.guru_foto ? (
                          <img src={getImageUrl(assignment.guru_foto)} alt={assignment.guru_nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <User size={16} />
                        )}
                      </div>
                      {assignment.guru_nama}
                    </div>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{assignment.nip}</td>
                  <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                    <span style={{ background: '#2563eb', color: '#fff', fontSize: '.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: '999px' }}>{assignment.kelas}</span>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{assignment.tahun_ajaran}</td>
                  <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                    <button onClick={() => handleDelete(assignment.id)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s' }}>Copot</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* DETAIL KELAS MODAL */}
      {showClassDetail && selectedClass && (
        <div className="modal-overlay app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1500 }} onClick={(e) => { if (e.target === e.currentTarget) setShowClassDetail(false) }}>
          <div className="modal-content" style={{ background: '#fff', borderRadius: '14px', maxWidth: '900px', width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(15,23,42,.25)' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '20px 22px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}><BarChart3 size={18} /> Detail Kelas {selectedClass.kelas}</div>
              <button onClick={() => setShowClassDetail(false)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '9px 16px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>Tutup</button>
            </div>

            <div className="modal-body" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="detail-stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '14px' }}>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#eff6ff' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: '#2563eb' }}>{selectedClass.totalSiswa}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Siswa</div>
                </div>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#dcfce7' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: '#16a34a' }}>{selectedClass.totalPrestasi}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Prestasi</div>
                </div>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#f3e8ff' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: '#7c3aed' }}>{selectedClass.totalEvent}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Event</div>
                </div>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#fef3c7' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: '#f59e0b' }}>{selectedClass.totalOrganisasi}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Organisasi</div>
                </div>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#fef3c7' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: '#f59e0b' }}>{selectedClass.totalKepanitiaan}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Kepanitiaan</div>
                </div>
                <div style={{ borderRadius: '10px', padding: '16px 10px', textAlign: 'center', background: '#dcfce7' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '4px', color: selectedClass.totalPelanggaran > 0 ? '#ef4444' : '#16a34a' }}>{selectedClass.totalPelanggaran}</div>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#334155' }}>Pelanggaran</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '.95rem', fontWeight: 700, color: '#0f172a' }}><Users size={17} /> Daftar Siswa</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '.85rem', color: '#64748b' }}>Wali Kelas: <strong style={{ color: '#2563eb' }}>{selectedClass.wali?.nama}</strong> (NIP: {selectedClass.wali?.nip})</div>

              <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                  <thead>
                    <tr>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>No</th>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Nama</th>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>NIS</th>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Detail IPT</th>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>IPT</th>
                      <th style={{ background: '#f8fafc', textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedClass.students?.map((student, index) => (
                      <tr key={student.id}>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{index + 1}</td>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, color: '#0f172a' }}>
                            <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', overflow: 'hidden' }}>
                              {student.foto ? (
                                <img src={getImageUrl(student.foto)} alt={student.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <User size={16} />
                              )}
                            </div>
                            {student.nama}
                          </div>
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{student.nis}</td>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '.8rem' }}>
                            {getIptDetailRows(student.ipt_points).map(([label, value]) => (
                              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '24px', color: '#334155' }}>
                                <span>{label}</span>
                                <span style={{ fontWeight: 700, color: '#0f172a' }}>{value > 0 ? '+' : ''}{value}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '38px', height: '38px', borderRadius: '50%', background: isBelowMinIpt(student.ipt_total || 80, minIptFor(minIpt, selectedClass?.kelas)) ? '#dc2626' : '#0891b2', color: '#fff', fontWeight: 700, fontSize: '.85rem' }}>{student.ipt_total || 80}</span>
                        </td>
                        <td style={{ padding: '13px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                          <button onClick={() => handleViewStudentDetail(student)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#2563eb', color: '#fff', transition: 'all 0.2s' }}>Detail</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL SISWA MODAL shared StudentDetail component */}
      {showStudentDetail && selectedStudent && (
        <StudentDetail student={selectedStudent} onClose={() => setShowStudentDetail(false)} />
      )}
    </div>
  );
}

export default WaliKelas;