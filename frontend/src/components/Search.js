import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import { formatDisplayText } from '../utils/formatDisplayText';

function Search() {
  const minIpt = useMinIptPerGrade();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search query (300ms delay)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    const searchStudents = async () => {
      setLoading(true);
      try {
        const response = await api.get(`/search/students?query=${encodeURIComponent(debouncedQuery)}`);
        setResults(response.data);
      } catch (error) {
        console.error('Error searching:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    };

    searchStudents();
  }, [debouncedQuery]);

  const handleViewDetails = useCallback(async (student) => {
    try {
      const response = await api.get(`/search/student/${student.id}`);
      setSelectedStudent(response.data);
    } catch (error) {
      console.error('Error fetching details:', error);
    }
  }, []);

  return (
    <div>
      <h2>Search Siswa</h2>
      <div className="card">
        <div className="form-row" style={{ alignItems: 'center' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari berdasarkan nama atau NIS..."
            style={{ flex: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
          />
          {loading && <span style={{ fontSize: '12px', color: '#666' }}>Mencari...</span>}
        </div>
      </div>

      {results.length > 0 && (
        <div className="card">
          <h3>Hasil Pencarian</h3>
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>NIS</th>
                <th>Kelas</th>
                <th>Grha</th>
                <th>IPT</th>
                <th>Prestasi</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {results.map(student => (
                <tr key={student.id}>
                  <td>{student.nama}</td>
                  <td>{student.nis}</td>
                  <td>{student.kelas}</td>
                  <td>{student.grha}</td>
                  <td style={isBelowMinIpt(student.ipt_total, minIptFor(minIpt, student.kelas)) ? { color: '#dc2626', fontWeight: 'bold' } : undefined}>{student.ipt_total}</td>
                  <td>{student.total_prestasi}</td>
                  <td>
                    <button className="btn btn-info" onClick={() => handleViewDetails(student)} style={{ padding: '5px 10px' }}>
                      Lihat Detail
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {selectedStudent && (
        <div className="card">
          <h3>Detail Siswa: {selectedStudent.student.nama}</h3>
          <button className="btn btn-danger" onClick={() => setSelectedStudent(null)} style={{ marginBottom: '20px' }}>Tutup</button>
          
          <div style={{ marginBottom: '20px' }}>
            <p><strong>NIS:</strong> {selectedStudent.student.nis}</p>
            <p><strong>Kelas:</strong> {selectedStudent.student.kelas}</p>
            <p><strong>Grha:</strong> {selectedStudent.student.grha}</p>
            <p><strong>IPT Total:</strong> <span style={isBelowMinIpt(selectedStudent.student.ipt_total, minIptFor(minIpt, selectedStudent.student.kelas)) ? { color: '#dc2626', fontWeight: 'bold' } : undefined}>{selectedStudent.student.ipt_total}</span></p>
          </div>

          <h4>Prestasi: {selectedStudent.total_prestasi}</h4>
          {selectedStudent.prestasi.length > 0 ? (
            <div className="table-wrap">
            <table className="table" style={{ marginBottom: '20px' }}>
              <thead>
                <tr>
                  <th>Nama Lomba</th>
                  <th>Juara</th>
                  <th>Kategori</th>
                  <th>Point</th>
                </tr>
              </thead>
              <tbody>
                {selectedStudent.prestasi.map(p => (
                  <tr key={p.id}>
                    <td>{p.nama_lomba}</td>
                    <td>{formatDisplayText(p.juara)}</td>
                    <td>{formatDisplayText(p.kategori)}</td>
                    <td>{p.point}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <p style={{ marginBottom: '20px' }}>Tidak ada prestasi</p>
          )}
        </div>
      )}
    </div>
  );
}

export default Search;
