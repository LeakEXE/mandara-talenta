import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import { GraduationCap, TriangleAlert, ClipboardList } from 'lucide-react';
import StudentDetail from './StudentDetail';

function TeacherWaliKelas() {
  const minIpt = useMinIptPerGrade();
  const [classData, setClassData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [showStudentDetail, setShowStudentDetail] = useState(false);

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

  const handleViewStudentDetail = (student) => {
    // StudentDetail fetches its own records/history/IPT card.
    setSelectedStudent(student);
    setShowStudentDetail(true);
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

      {/* Student Detail Modal (shared component) */}
      {showStudentDetail && selectedStudent && (
        <StudentDetail
          student={selectedStudent}
          onClose={() => { setShowStudentDetail(false); setSelectedStudent(null); }}
        />
      )}
    </div>
  );
}

export default TeacherWaliKelas;
