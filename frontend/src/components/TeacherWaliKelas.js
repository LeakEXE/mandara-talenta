import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import { GraduationCap, TriangleAlert, ClipboardList, User } from 'lucide-react';

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

function TeacherWaliKelas() {
  const minIpt = useMinIptPerGrade();
  const [classData, setClassData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showStudentDetail, setShowStudentDetail] = useState(false);
  const [loadingIptDetail, setLoadingIptDetail] = useState(false);
  const [iptDetail, setIptDetail] = useState(null);

  useEffect(() => {
    fetchMyClass();
  }, []);

  const fetchMyClass = async () => {
    try {
      const response = await api.get('/wali-kelas/my-class');
      setClassData(response.data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching class data:', error);
      setError(error.response?.data?.message || 'Gagal mengambil data kelas');
      setLoading(false);
    }
  };

  const handleViewStudentDetail = async (student) => {
    setSelectedStudent(student);
    setShowStudentDetail(true);
    setLoadingIptDetail(true);
    setIptDetail(null);
    
    try {
      const response = await api.get(`/reports/ipt-card/${student.id}`);
      setIptDetail(response.data);
    } catch (error) {
      console.error('Error fetching IPT detail:', error);
    } finally {
      setLoadingIptDetail(false);
    }
  };

  const getIptColor = (ipt) => {
    if (ipt >= 90) return 'var(--success-color)';
    if (ipt >= 80) return 'var(--teal)';
    if (ipt >= 70) return 'var(--warning-color)';
    return 'var(--danger-color)';
  };

  if (loading) {
    return (
      <div className="loading" style={{ textAlign: 'center', padding: '50px' }}>
        <div className="spinner" style={{ 
          border: '4px solid var(--bg-tertiary)',
          borderTop: '4px solid var(--blue)',
          borderRadius: '50%',
          width: '40px',
          height: '40px',
          animation: 'spin 1s linear infinite',
          margin: '0 auto'
        }}></div>
        <p>Memuat data kelas...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div className="alert alert-warning" style={{ 
          padding: '20px', 
          backgroundColor: 'var(--amber-bg)', 
          border: '1px solid var(--amber-border)',
          borderRadius: '8px'
        }}>
          <h4 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}><TriangleAlert size={18} /> {error}</h4>
          <p>Anda belum ditunjuk sebagai Wali Kelas untuk tahun ajaran ini.</p>
          <p>Silakan hubungi SuperAdmin untuk informasi lebih lanjut.</p>
        </div>
      </div>
    );
  }

  if (!classData) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <p>Data kelas tidak tersedia.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px' }}>
      {/* Header */}
      <div style={{ 
        background: 'linear-gradient(135deg, var(--primary-color), var(--primary-dark))',
        color: 'white',
        padding: '30px',
        borderRadius: '15px',
        marginBottom: '30px'
      }}>
        <h2 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '10px' }}><GraduationCap size={28} /> Dashboard Wali Kelas</h2>
        <p style={{ margin: 0, fontSize: '18px' }}>
          {classData.kelas} | Tahun Ajaran {classData.tahunAjaran}
        </p>
      </div>

      {/* Statistics Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '20px',
        marginBottom: '30px'
      }}>
        {/* Total Siswa */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', fontWeight: 'bold', color: 'var(--blue)' }}>
            {classData.totalSiswa}
          </div>
          <div style={{ color: 'var(--slate)' }}>Total Siswa</div>
        </div>

        {/* Total Prestasi */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', fontWeight: 'bold', color: 'var(--success-color)' }}>
            {classData.totalPrestasi}
          </div>
          <div style={{ color: 'var(--slate)' }}>Total Prestasi</div>
        </div>

        {/* Total Event */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', fontWeight: 'bold', color: 'var(--purple)' }}>
            {classData.totalEvent}
          </div>
          <div style={{ color: 'var(--slate)' }}>Total Event</div>
        </div>

        {/* Total Organisasi */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '36px', fontWeight: 'bold', color: 'var(--warning-color)' }}>
            {classData.totalOrganisasi}
          </div>
          <div style={{ color: 'var(--slate)' }}>Total Organisasi</div>
        </div>

        {/* Total Pelanggaran */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ 
            fontSize: '36px', 
            fontWeight: 'bold', 
            color: classData.totalPelanggaran > 0 ? 'var(--danger-color)' : 'var(--success-color)'
          }}>
            {classData.totalPelanggaran}
          </div>
          <div style={{ color: 'var(--slate)' }}>Total Pelanggaran</div>
        </div>

        {/* Rata-rata IPT */}
        <div style={{ 
          background: 'var(--bg-primary)',
          padding: '20px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
          textAlign: 'center'
        }}>
          <div style={{ 
            fontSize: '36px', 
            fontWeight: 'bold', 
            color: getIptColor(classData.rataRataIPT)
          }}>
            {classData.rataRataIPT}
          </div>
          <div style={{ color: 'var(--slate)' }}>Rata-rata IPT Kelas</div>
        </div>
      </div>

      {/* Students Table */}
      <div style={{ 
        background: 'var(--bg-primary)',
        padding: '20px',
        borderRadius: '10px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}><ClipboardList size={20} /> Daftar Siswa Kelas {classData.kelas}</h3>
        
        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)' }}>No</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)' }}>Nama</th>
                <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid var(--border-color)' }}>NIS</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>Prestasi</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>Event</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>Organisasi</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>Pelanggaran</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>IPT</th>
                <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid var(--border-color)' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {classData.students.map((student, index) => (
                <tr key={student.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '12px' }}>{index + 1}</td>
                  <td style={{ padding: '12px' }}>
                    <strong>{student.nama}</strong>
                    <br />
                    <small style={{ color: 'var(--slate)' }}>{student.grha}</small>
                  </td>
                  <td style={{ padding: '12px' }}>{student.nis}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ 
                      backgroundColor: student.stats.prestasi > 0 ? 'var(--green-bg)' : 'var(--bg-tertiary)',
                      color: student.stats.prestasi > 0 ? 'var(--green-text)' : 'var(--slate)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {student.stats.prestasi}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ 
                      backgroundColor: student.stats.event > 0 ? 'var(--purple-bg)' : 'var(--bg-tertiary)',
                      color: student.stats.event > 0 ? 'var(--purple)' : 'var(--slate)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {student.stats.event}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ 
                      backgroundColor: student.stats.organisasi > 0 ? 'var(--amber-bg)' : 'var(--bg-tertiary)',
                      color: student.stats.organisasi > 0 ? 'var(--amber-text)' : 'var(--slate)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {student.stats.organisasi}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ 
                      backgroundColor: student.stats.pelanggaran > 0 ? 'var(--danger-bg)' : 'var(--green-bg)',
                      color: student.stats.pelanggaran > 0 ? 'var(--danger-dark)' : 'var(--green-text)',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {student.stats.pelanggaran}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ 
                      backgroundColor: isBelowMinIpt(student.ipt_total || 80, minIptFor(minIpt, classData?.kelas)) ? 'var(--danger-color)' : getIptColor(student.ipt_total),
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold'
                    }}>
                      {student.ipt_total || 80}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleViewStudentDetail(student)}
                      style={{
                        backgroundColor: 'var(--blue)',
                        color: 'white',
                        border: 'none',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Student Detail Modal */}
      {showStudentDetail && selectedStudent && (
        <div className="app-modal-overlay" style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1500,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '15px',
            padding: '30px',
            maxWidth: '600px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}><User size={18} /> Detail Siswa</h3>
              <button
                onClick={() => setShowStudentDetail(false)}
                style={{
                  backgroundColor: 'var(--danger-color)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Tutup
              </button>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '15px', color: 'var(--blue)' }}>Informasi Pribadi</h4>
              <table style={{ width: '100%' }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 'bold', width: '40%' }}>Nama</td>
                    <td style={{ padding: '8px' }}>{selectedStudent.nama}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>NIS</td>
                    <td style={{ padding: '8px' }}>{selectedStudent.nis}</td>
                  </tr>
                  <tr>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>Grha</td>
                    <td style={{ padding: '8px' }}>{selectedStudent.grha || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>Alamat</td>
                    <td style={{ padding: '8px' }}>{selectedStudent.alamat || '-'}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 'bold' }}>No. HP</td>
                    <td style={{ padding: '8px' }}>{selectedStudent.no_hp || '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '15px', color: 'var(--success-color)' }}>Statistik Aktivitas</h4>
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '15px'
              }}>
                <div style={{ 
                  backgroundColor: 'var(--green-bg)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--success-color)' }}>
                    {selectedStudent.stats.prestasi}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Prestasi</div>
                </div>
                <div style={{ 
                  backgroundColor: 'var(--purple-bg)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--purple)' }}>
                    {selectedStudent.stats.event}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Event</div>
                </div>
                <div style={{ 
                  backgroundColor: 'var(--amber-bg)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--warning-color)' }}>
                    {selectedStudent.stats.organisasi}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Organisasi</div>
                </div>
                <div style={{ 
                  backgroundColor: selectedStudent.stats.pelanggaran > 0 ? 'var(--danger-bg)' : 'var(--green-bg)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: selectedStudent.stats.pelanggaran > 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>
                    {selectedStudent.stats.pelanggaran}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Pelanggaran</div>
                </div>
                <div style={{ 
                  backgroundColor: 'var(--blue-light)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--blue)' }}>
                    {selectedStudent.stats.perilaku}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Perilaku Positif</div>
                </div>
                <div style={{ 
                  backgroundColor: 'var(--amber-bg)', 
                  padding: '15px', 
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--warning-color)' }}>
                    {selectedStudent.stats.kepanitiaan}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--slate)' }}>Kepanitiaan</div>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ marginBottom: '15px', color: 'var(--purple)' }}>Detail IPT</h4>
              {loadingIptDetail ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <div className="spinner" style={{ 
                    border: '4px solid var(--bg-tertiary)',
                    borderTop: '4px solid var(--purple)',
                    borderRadius: '50%',
                    width: '30px',
                    height: '30px',
                    animation: 'spin 1s linear infinite',
                    margin: '0 auto 10px'
                  }}></div>
                  <p style={{ color: 'var(--slate)' }}>Memuat detail IPT...</p>
                </div>
              ) : iptDetail ? (
                <div style={{ 
                  backgroundColor: 'var(--bg-tertiary)', 
                  padding: '15px', 
                  borderRadius: '8px'
                }}>
                  <div style={{ display: 'grid', gap: '8px', marginBottom: '15px' }}>
                    {getIptDetailRows(iptDetail.points || {}).map(([label, value]) => (
                      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '8px', backgroundColor: 'white', borderRadius: '4px' }}>
                        <span style={{ fontWeight: '500' }}>{label}</span>
                        <strong style={{ color: value < 0 ? 'var(--danger-color)' : 'var(--success-color)' }}>
                          {value > 0 ? '+' : ''}{value}
                        </strong>
                      </div>
                    ))}
                  </div>
                  <div style={{ 
                    padding: '15px', 
                    backgroundColor: isBelowMinIpt(selectedStudent.ipt_total || 80, minIptFor(minIpt, classData?.kelas)) ? 'var(--danger-color)' : getIptColor(selectedStudent.ipt_total || 80), 
                    borderRadius: '8px',
                    textAlign: 'center',
                    color: 'white'
                  }}>
                    <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '5px' }}>
                      {selectedStudent.ipt_total || 80}
                    </div>
                    <div style={{ fontSize: '14px' }}>Total IPT</div>
                  </div>
                </div>
              ) : (
                <div style={{ 
                  padding: '20px', 
                  backgroundColor: 'var(--amber-bg)', 
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: 'var(--amber-text)'
                }}>
                  Gagal memuat detail IPT
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TeacherWaliKelas;
