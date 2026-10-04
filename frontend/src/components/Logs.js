import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';

const DEFAULT_LIMIT = 50;

function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: DEFAULT_LIMIT,
    total: 0,
    totalPages: 0
  });

  // Page/limit always passed explicitly — stable identity, no stale closures.
  const fetchLogs = useCallback(async (page = 1, limit = DEFAULT_LIMIT) => {
    try {
      setLoading(true);
      const response = await api.get('/logs', { params: { page, limit } });
      setLogs(response.data.logs || []);
      setPagination(response.data.pagination || {
        page: 1,
        limit: DEFAULT_LIMIT,
        total: 0,
        totalPages: 0
      });
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs(1, DEFAULT_LIMIT);
  }, [fetchLogs]);

  const handleLimitChange = (newLimit) => {
    fetchLogs(1, newLimit);
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

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  const { page, limit, total, totalPages } = pagination;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <div>
      <h2>Activity Logs</h2>
      <p>Logs ini menampilkan semua aktivitas yang direkam dalam sistem<br /><em>*Dibuat untuk memudahkan pengembang website</em></p>
      <div className="card">
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>User</th>
              <th>Role</th>
              <th>Action</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td>{new Date(log.created_at).toLocaleString('id-ID')}</td>
                <td>{log.nama}</td>
                <td><span className={`badge badge-${log.role === 'superadmin' ? 'danger' : (log.role === 'guru' || log.role === 'pegawai') ? 'warning' : 'info'}`}>{log.role}</span></td>
                <td>{log.action}</td>
                <td>{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {logs.length === 0 && (
          <p style={{ textAlign: 'center', padding: '24px', color: '#999' }}>Belum ada activity logs.</p>
        )}

        {/* Pagination — same pattern as KelolaAkun */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px',
          borderTop: '1px solid #e0e0e0', paddingTop: '16px', marginTop: '16px'
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: '#666' }}>
            <label htmlFor="logs-limit">Baris per halaman:</label>
            <select
              id="logs-limit"
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
              onClick={() => fetchLogs(page - 1, limit)}
              disabled={page <= 1 || loading}
              style={{
                padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                fontSize: '12px', cursor: page <= 1 || loading ? 'not-allowed' : 'pointer',
                background: page <= 1 || loading ? '#f5f5f5' : 'white',
                color: page <= 1 || loading ? '#999' : '#333'
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
                  onClick={() => fetchLogs(p, limit)}
                  disabled={loading || p === page}
                  style={{
                    minWidth: '30px', padding: '6px 8px', border: '1px solid #d0d0d0', borderRadius: '4px',
                    fontSize: '12px', cursor: loading || p === page ? 'default' : 'pointer',
                    background: p === page ? 'var(--blue)' : 'white',
                    color: p === page ? 'white' : '#333',
                    fontWeight: p === page ? '700' : '400'
                  }}
                >
                  {p}
                </button>
              )
            ))}
            <button
              onClick={() => fetchLogs(page + 1, limit)}
              disabled={page >= totalPages || loading}
              style={{
                padding: '6px 12px', border: '1px solid #d0d0d0', borderRadius: '4px',
                fontSize: '12px', cursor: page >= totalPages || loading ? 'not-allowed' : 'pointer',
                background: page >= totalPages || loading ? '#f5f5f5' : 'white',
                color: page >= totalPages || loading ? '#999' : '#333'
              }}
            >
              Selanjutnya →
            </button>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
          Menampilkan {from}&ndash;{to} dari {total} logs (Halaman {page} dari {totalPages})
        </div>
      </div>
    </div>
  );
}

export default Logs;
