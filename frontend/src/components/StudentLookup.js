import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import StudentDetail from './StudentDetail';
import ProfilePhoto from './ProfilePhoto';

const KELAS_OPTIONS = [
  'X TKJ 1', 'X TKJ 2', 'X TKR 1', 'X TKR 2',
  'X DPIB 1', 'X DPIB 2',
  'XI TKJ 1', 'XI TKJ 2', 'XI TKR 1', 'XI TKR 2',
  'XI DPIB 1', 'XI DPIB 2',
  'XII TKJ 1', 'XII TKJ 2', 'XII TKR 1', 'XII TKR 2',
  'XII DPIB 1', 'XII DPIB 2'
];

const GRHA_OPTIONS = [
  'Airsanya', 'Daksina', 'Genya', 'Madhya', 'Nairiti', 'Pascima', 'Purwa', 'Uttara', 'Wayabhya'
];

const PAGE_SIZES = [20, 50, 80];

function academicYearOptions() {
  const options = [];
  for (let start = 2024; start <= 2034; start += 1) {
    options.push(`${start}-${start + 1}`);
  }
  return options;
}
const TAHUN_OPTIONS = academicYearOptions();

function TriRow({ label, checked, excluded, onToggleInclude, onToggleExclude }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '6px 8px',
      borderRadius: '8px',
      background: checked ? '#eff6ff' : excluded ? '#fef2f2' : 'transparent'
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleInclude}
        aria-label={'Sertakan ' + label}
        style={{ width: '16px', height: '16px', accentColor: '#2563eb', cursor: 'pointer', flexShrink: 0 }}
      />
      <span style={{ flex: 1, fontSize: '.85rem', color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <button
        type="button"
        title={excluded ? 'Batalkan pengecualian ' + label : 'Kecualikan ' + label}
        onClick={onToggleExclude}
        style={{
          width: '24px', height: '24px', borderRadius: '6px',
          border: '1px solid ' + (excluded ? '#ef4444' : '#e2e8f0'),
          background: excluded ? '#ef4444' : '#fff',
          color: excluded ? '#fff' : '#94a3b8',
          cursor: 'pointer', fontSize: '15px', fontWeight: 700, lineHeight: 1, flexShrink: 0
        }}
      >
        &#8722;
      </button>
    </div>
  );
}

function FilterChip({ label, kind, onRemove }) {
  const isExclude = kind === 'exclude';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      fontSize: '.75rem', fontWeight: 600, padding: '4px 6px 4px 10px', borderRadius: '999px',
      background: isExclude ? '#fee2e2' : '#dbeafe',
      color: isExclude ? '#b91c1c' : '#1d4ed8'
    }}>
      {isExclude ? 'Kecuali: ' : ''}{label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={'Hapus filter ' + label}
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer',
          color: 'inherit', fontSize: '.8rem', fontWeight: 700, padding: '0 4px', lineHeight: 1
        }}
      >
        &#10005;
      </button>
    </span>
  );
}

function StudentLookup() {
  const minIpt = useMinIptPerGrade();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [kelasInc, setKelasInc] = useState([]);
  const [kelasExc, setKelasExc] = useState([]);
  const [grhaInc, setGrhaInc] = useState([]);
  const [grhaExc, setGrhaExc] = useState([]);
  const [tahunPel, setTahunPel] = useState('');
  const [status, setStatus] = useState('semua');
  const [iptStatus, setIptStatus] = useState('semua');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailStudent, setDetailStudent] = useState(null);
  const fetchIdRef = useRef(0);

  let role = '';
  try {
    role = JSON.parse(localStorage.getItem('user') || '{}').role || '';
  } catch (e) {
    role = '';
  }

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchLookup = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError('');
    try {
      const params = { page, limit };
      if (debouncedQuery) params.search = debouncedQuery;
      if (kelasInc.length) params.kelas_include = kelasInc.join(',');
      if (kelasExc.length) params.kelas_exclude = kelasExc.join(',');
      if (grhaInc.length) params.grha_include = grhaInc.join(',');
      if (grhaExc.length) params.grha_exclude = grhaExc.join(',');
      if (tahunPel) params.tahun_pelajaran = tahunPel;
      if (status !== 'semua') params.status = status;
      if (iptStatus !== 'semua') params.ipt_status = iptStatus;
      const res = await api.get('/users/lookup', { params });
      if (fetchIdRef.current !== fetchId) return;
      setUsers(res.data.users || []);
      setTotal(res.data.pagination?.total ?? 0);
      setTotalPages(res.data.pagination?.totalPages ?? 1);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return;
      setError(err.response?.data?.message || 'Gagal memuat data siswa');
      setUsers([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      if (fetchIdRef.current === fetchId) setLoading(false);
    }
  }, [debouncedQuery, kelasInc, kelasExc, grhaInc, grhaExc, tahunPel, status, iptStatus, page, limit]);

  useEffect(() => {
    if (role === 'siswa') {
      setLoading(false);
      return;
    }
    fetchLookup();
  }, [fetchLookup, role]);

  const toggleList = (list, setList, otherList, setOtherList, value) => {
    setPage(1);
    if (list.includes(value)) {
      setList(list.filter((v) => v !== value));
    } else {
      setList([...list, value]);
      if (otherList.includes(value)) setOtherList(otherList.filter((v) => v !== value));
    }
  };

  const resetAll = () => {
    setQuery('');
    setDebouncedQuery('');
    setKelasInc([]);
    setKelasExc([]);
    setGrhaInc([]);
    setGrhaExc([]);
    setTahunPel('');
    setStatus('semua');
    setIptStatus('semua');
    setPage(1);
  };

  const hasActiveFilters = query.trim() || kelasInc.length || kelasExc.length || grhaInc.length || grhaExc.length
    || tahunPel || status !== 'semua' || iptStatus !== 'semua';

  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const pageWindow = () => {
    const start = Math.max(1, Math.min(page - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    const arr = [];
    for (let p = start; p <= end; p++) arr.push(p);
    return arr;
  };

  const selectStyle = {
    fontFamily: 'inherit', fontSize: '.82rem', padding: '8px 10px', borderRadius: '8px',
    border: '1px solid #e2e8f0', background: '#fff', color: '#0f172a', outline: 'none'
  };

  if (role === 'siswa') {
    return (
      <div className="card">
        <h2>Akses Ditolak</h2>
        <p>Halaman pencarian siswa hanya untuk guru, pegawai, dan superadmin.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '4px 4px 40px', maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{
        background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
        borderRadius: '14px',
        padding: '24px 28px',
        color: '#fff',
        boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 1px 8px rgba(15,23,42,.05)'
      }}>
        <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>Cari Siswa</h1>
        <p style={{ margin: '2px 0 0', fontSize: '.85rem', color: 'rgba(255,255,255,0.92)', fontWeight: 400 }}>
          Cari dan filter data siswa berdasarkan nama, NIS, kelas, dan grha
        </p>
      </div>

      <div className="card" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>&#128269;</span>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Cari nama atau NIS..."
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: '.9rem', padding: '10px 12px 10px 36px',
              borderRadius: '10px', border: '1px solid #e2e8f0', outline: 'none', color: '#0f172a'
            }}
          />
        </div>
        <select value={tahunPel} onChange={(e) => { setTahunPel(e.target.value); setPage(1); }} style={selectStyle} aria-label="Filter tahun pelajaran">
          <option value="">Semua Tahun Pelajaran</option>
          {TAHUN_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} style={selectStyle} aria-label="Filter status">
          <option value="semua">Semua Status</option>
          <option value="aktif">Aktif</option>
          <option value="lulus">Lulus</option>
        </select>
        <select value={iptStatus} onChange={(e) => { setIptStatus(e.target.value); setPage(1); }} style={selectStyle} aria-label="Filter IPT">
          <option value="semua">Semua IPT</option>
          <option value="below">Di bawah minimum</option>
          <option value="normal">Normal</option>
        </select>
        {hasActiveFilters && (
          <button type="button" onClick={resetAll} className="btn" style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 14px', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer', background: '#fff', color: '#334155' }}>
            Reset
          </button>
        )}
      </div>

      {(kelasInc.length > 0 || kelasExc.length > 0 || grhaInc.length > 0 || grhaExc.length > 0) && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {kelasInc.map((v) => <FilterChip key={'ki-' + v} label={v} kind="include" onRemove={() => setKelasInc(kelasInc.filter((x) => x !== v))} />)}
          {kelasExc.map((v) => <FilterChip key={'ke-' + v} label={v} kind="exclude" onRemove={() => setKelasExc(kelasExc.filter((x) => x !== v))} />)}
          {grhaInc.map((v) => <FilterChip key={'gi-' + v} label={v} kind="include" onRemove={() => setGrhaInc(grhaInc.filter((x) => x !== v))} />)}
          {grhaExc.map((v) => <FilterChip key={'ge-' + v} label={v} kind="exclude" onRemove={() => setGrhaExc(grhaExc.filter((x) => x !== v))} />)}
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 260px', maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="card" style={{ margin: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: '4px' }}>Kelas</div>
            <div style={{ fontSize: '.72rem', color: '#64748b', marginBottom: '8px' }}>Centang untuk menyertakan, &#8722; untuk mengecualikan</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '320px', overflowY: 'auto' }}>
              {KELAS_OPTIONS.map((k) => (
                <TriRow
                  key={k}
                  label={k}
                  checked={kelasInc.includes(k)}
                  excluded={kelasExc.includes(k)}
                  onToggleInclude={() => toggleList(kelasInc, setKelasInc, kelasExc, setKelasExc, k)}
                  onToggleExclude={() => toggleList(kelasExc, setKelasExc, kelasInc, setKelasInc, k)}
                />
              ))}
            </div>
          </div>
          <div className="card" style={{ margin: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: '4px' }}>Grha</div>
            <div style={{ fontSize: '.72rem', color: '#64748b', marginBottom: '8px' }}>Centang untuk menyertakan, &#8722; untuk mengecualikan</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {GRHA_OPTIONS.map((g) => (
                <TriRow
                  key={g}
                  label={g}
                  checked={grhaInc.includes(g)}
                  excluded={grhaExc.includes(g)}
                  onToggleInclude={() => toggleList(grhaInc, setGrhaInc, grhaExc, setGrhaExc, g)}
                  onToggleExclude={() => toggleList(grhaExc, setGrhaExc, grhaInc, setGrhaInc, g)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="card" style={{ flex: '3 1 480px', margin: 0, minWidth: 0 }}>
          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : error ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ fontWeight: 600, color: '#ef4444' }}>{error}</p>
              <button type="button" onClick={fetchLookup} className="btn btn-primary" style={{ marginTop: '12px' }}>Coba Lagi</button>
            </div>
          ) : (
            <>
              <div className="table-wrap" style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Nama</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>NIS</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Username</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Kelas</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Grha</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>IPT</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Status</th>
                      <th style={{ textAlign: 'left', fontSize: '.7rem', fontWeight: 700, color: '#64748b', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((s) => {
                      const belowMin = isBelowMinIpt(s.ipt_total, minIptFor(minIpt, s.kelas));
                      const lulus = Number(s.is_graduated) === 1;
                      const fotoUrl = s.foto ? API_BASE_URL.replace('/api', '') + s.foto : null;
                      return (
                        <tr key={s.id}>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 600, color: '#0f172a' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, overflow: 'hidden', flexShrink: 0 }}>
                                {fotoUrl ? (
                                  <ProfilePhoto src={fotoUrl} alt={s.nama} />
                                ) : (
                                  String(s.nama || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
                                )}
                              </div>
                              {s.nama}
                            </div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{s.nis || '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155', fontWeight: 600 }}>{s.username || '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{s.kelas || '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{s.grha || '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9', fontWeight: 700, color: belowMin ? '#dc2626' : '#0f172a' }}>{s.ipt_total ?? '-'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9' }}>
                            <span style={{
                              fontSize: '.72rem', fontWeight: 600, padding: '4px 10px', borderRadius: '999px',
                              background: lulus ? '#f1f5f9' : '#dcfce7', color: lulus ? '#64748b' : '#16a34a'
                            }}>
                              {lulus ? 'Lulus' : 'Aktif'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '.85rem', borderBottom: '1px solid #f1f5f9' }}>
                            <button
                              type="button"
                              onClick={() => setDetailStudent(s)}
                              className="btn btn-info"
                              style={{ padding: '6px 12px', fontSize: '.75rem', fontWeight: 600 }}
                            >
                              Detail
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {users.length === 0 && (
                <p className="text-muted" style={{ textAlign: 'center', padding: '24px' }}>Tidak ada siswa yang cocok dengan pencarian/filter.</p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginTop: '16px' }}>
                <div style={{ fontSize: '.8rem', color: '#64748b' }}>
                  Menampilkan {from}&ndash;{to} dari {total} siswa
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <select
                    value={limit}
                    onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
                    style={selectStyle}
                    aria-label="Jumlah data per halaman"
                  >
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / halaman</option>)}
                  </select>
                  <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className="btn" style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 12px', fontSize: '.8rem', fontWeight: 600, cursor: page <= 1 ? 'not-allowed' : 'pointer', background: '#fff', color: '#334155', opacity: page <= 1 ? 0.5 : 1 }}>
                    &lsaquo; Prev
                  </button>
                  {pageWindow().map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      style={{
                        border: '1px solid ' + (p === page ? '#2563eb' : '#e2e8f0'), borderRadius: '8px', padding: '6px 12px',
                        fontSize: '.8rem', fontWeight: 600, cursor: 'pointer',
                        background: p === page ? '#2563eb' : '#fff', color: p === page ? '#fff' : '#334155'
                      }}
                    >
                      {p}
                    </button>
                  ))}
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="btn" style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '6px 12px', fontSize: '.8rem', fontWeight: 600, cursor: page >= totalPages ? 'not-allowed' : 'pointer', background: '#fff', color: '#334155', opacity: page >= totalPages ? 0.5 : 1 }}>
                    Next &rsaquo;
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {detailStudent && (
        <StudentDetail student={detailStudent} onClose={() => setDetailStudent(null)} />
      )}
    </div>
  );
}

export default StudentLookup;
