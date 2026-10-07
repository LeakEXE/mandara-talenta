import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { Trophy, Users, Award, Clock, ClipboardList, RefreshCw, Eye } from 'lucide-react';
import { CATEGORY_ICONS, MedalIcon } from './icons';
import CategoryRecordModal from './CategoryRecordModal';
import PembinaRecordModal from './PembinaRecordModal';

const SLATE = "var(--slate)";

const CATEGORIES = [
  { key: 'prestasi', label: 'Prestasi', icon: CATEGORY_ICONS.prestasi },
  { key: 'organisasi', label: 'Organisasi', icon: CATEGORY_ICONS.organisasi },
  { key: 'kepanitiaan', label: 'Kepanitiaan', icon: CATEGORY_ICONS.kepanitiaan },
  { key: 'event', label: 'Event', icon: CATEGORY_ICONS.event },
  { key: 'pelanggaran', label: 'Pelanggaran', icon: CATEGORY_ICONS.pelanggaran },
  { key: 'perilaku', label: 'Perilaku', icon: CATEGORY_ICONS.perilaku },
  { key: 'pembina', label: 'Pembina', icon: CATEGORY_ICONS.pembina }
];

function Leaderboard() {
  const [activeCategory, setActiveCategory] = useState('prestasi');
  const [dataByCategory, setDataByCategory] = useState({});
  const [loadingMap, setLoadingMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [recordTarget, setRecordTarget] = useState(null);
  // Record detail is visible to every authenticated role (the backing
  // endpoints serve approved records only, same exposure as the ranking).
  const showRecordButton = true;

  useEffect(() => {
    fetchCategory('prestasi');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCategory = async (category) => {
    setLoadingMap(prev => ({ ...prev, [category]: true }));
    setError('');
    try {
      const res = await api.get(`/search/leaderboard/category/${category}`);
      console.log(`Fetched ${category} data:`, res.data);
      setDataByCategory(prev => ({ ...prev, [category]: res.data }));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      setError('Gagal memuat data peringkat');
    } finally {
      setLoadingMap(prev => ({ ...prev, [category]: false }));
      setLoading(false);
    }
  };

  const handleSelectCategory = (category) => {
    setActiveCategory(category);
    if (!dataByCategory[category] && !loadingMap[category]) {
      fetchCategory(category);
    }
  };

  function initials(name) {
    return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  }

  const activeLabel = CATEGORIES.find(c => c.key === activeCategory)?.label || activeCategory;
  const currentData = dataByCategory[activeCategory] || [];
  const categoryLoading = !!loadingMap[activeCategory];
  const title = `Peringkat ${activeLabel}`;
  // Pelanggaran memakai poin negatif (pengurangan), jadi peringkat 1
  // adalah total terendah bukan tertinggi seperti kategori lain.
  const superlative = activeCategory === 'pelanggaran' ? 'terendah' : 'tertinggi';
  const top3 = currentData.filter((s) => s.rank <= 3).sort((a, b) => a.rank - b.rank);
  const totalPoints = currentData.reduce((sum, s) => sum + (s.total_point || 0), 0);
  const isPembina = activeCategory === 'pembina';

  // Debug log untuk pembina data
  if (isPembina && currentData.length > 0) {
    console.log('Pembina currentData:', currentData);
    console.log('First pembina entry:', currentData[0]);
  }

  if (loading) {
    return (
      <div className="lb-scope" style={{
        fontFamily: "var(--font-sans)",
        background: "var(--bg-secondary)",
        padding: "4px 4px 40px",
        color: "var(--ink)",
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <div className="inline-loading"><div className="spinner" style={{ margin: '0 auto 12px' }}></div>Memuat data...</div>
      </div>
    );
  }

  if (error && currentData.length === 0) {
    return (
      <div className="lb-scope" style={{
        fontFamily: "var(--font-sans)",
        background: "var(--bg-secondary)",
        padding: "4px 4px 40px",
        color: "var(--ink)",
      }}>
        <div style={{ padding: '12px 16px', background: 'var(--danger-bg)', color: 'var(--danger-dark)', borderRadius: '10px', marginBottom: '16px', fontSize: '14px', fontWeight: 600 }}>{error}</div>
        <button onClick={() => fetchCategory(activeCategory)} style={{ padding: '10px 16px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}>
          Coba Lagi
        </button>
      </div>
    );
  }

  return (
    <div
      className="lb-scope"
      style={{
        fontFamily: "var(--font-sans)",
        background: "var(--bg-secondary)",
        padding: "4px 4px 40px",
        maxWidth: '100%',
        margin: '0 auto',
        color: "var(--ink)",
      }}
    >
      <style>{`
        /* Shared tokens from index.css only alias DIFFERENT names here.
           NOTE: never self-map like --blue:var(--blue), it is cyclic and
           invalid, kills the blue bg and leaves white-on-white text. */
        .lb-scope{
          --gray-50:var(--bg-secondary);
          --gray-100:var(--bg-tertiary);
          --gray-200:var(--border-color);
          --gray-400:var(--muted-light);
          --gray-500:var(--slate);
          --gray-700:var(--text-primary);
          --gray-900:var(--ink);
          --white:var(--bg-primary);
          --radius:var(--card-radius);
          --radius-sm:10px;
          --shadow:var(--shadow-card);
        }
        .header-row{
          display:flex;
          align-items:flex-start;
          gap:12px;
          margin-bottom:20px;
        }
        @media (max-width: 480px){
          .header-row{gap:10px;margin-bottom:16px;}
        }
        .header-icon{
          flex:0 0 auto;
          width:clamp(36px, 5vw, 40px);
          height:clamp(36px, 5vw, 40px);
          border-radius:10px;
          background:var(--amber-bg);
          display:flex;align-items:center;justify-content:center;
          font-size:clamp(18px, 4vw, 20px);
        }
        .header-text h1{
          margin:0 0 2px;
          font-size:clamp(16px, 4vw, 22px);
          font-weight:700;
          line-height:1.3;
        }
        .header-text p{
          margin:0;
          font-size:clamp(12px, 2.5vw, 13.5px);
          color:var(--gray-500);
          line-height:1.4;
        }
        .controls{
          display:flex;
          flex-wrap:wrap;
          gap:12px;
          align-items:center;
          justify-content:space-between;
          margin-bottom:20px;
        }
        @media (max-width: 768px){
          .controls{
            flex-direction:column;
            align-items:stretch;
            gap:10px;
            margin-bottom:16px;
          }
        }
        .cat-chips{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          flex:1;
          min-width:0;
        }
        .chip{
          display:inline-flex;
          align-items:center;
          gap:8px;
          border:1px solid var(--gray-200);
          background:var(--white);
          padding:clamp(8px, 2vw, 9px) clamp(12px, 2vw, 14px);
          border-radius:999px;
          cursor:pointer;
          font-family:inherit;
          box-shadow:var(--shadow);
          transition:background .15s ease, color .15s ease, border-color .15s ease;
          color:var(--gray-700);
        }
        .chip:disabled{opacity:.6;cursor:wait;}
        .chip.active:disabled{opacity:1;cursor:wait;}
        .chip-icon{font-size:clamp(14px, 3vw, 16px);line-height:1;}
        .chip-text{display:flex;flex-direction:column;align-items:flex-start;line-height:1.25;}
        .chip-text strong{font-size:clamp(12px, 2.5vw, 13.5px);font-weight:700;}
        .chip-text span{font-size:clamp(10px, 2vw, 11.5px);opacity:.85;}
        .chip.active{
          background:var(--blue);
          border-color:var(--blue);
          color:#fff;
        }
        .chip.active .chip-text strong,
        .chip.active .chip-text span{
          color:#fff;
          opacity:1;
        }
        .chip.active .chip-text span{opacity:.92;}
        .refresh-btn{
          display:inline-flex;
          align-items:center;
          gap:8px;
          background:var(--blue);
          color:#fff;
          border:none;
          padding:10px 16px;
          border-radius:10px;
          font-family:inherit;
          font-size:clamp(12px, 2.5vw, 13.5px);
          font-weight:600;
          cursor:pointer;
          box-shadow:var(--shadow);
          transition:background .15s ease, transform .1s ease;
          white-space:nowrap;
        }
        @media (max-width: 768px){
          .refresh-btn{justify-content:center;width:100%;}
        }
        .refresh-btn:hover{background:var(--blue-dark);}
        .refresh-btn:active{transform:scale(.97);}
        .refresh-btn svg{
          width:15px;height:15px;
          transition:transform .5s ease;
        }
        .refresh-btn.spinning svg{transform:rotate(360deg);}
        .chip-icon svg,.header-icon svg,.podium-medal svg,.points-pill svg,.stat-value svg,.card-head h2 svg,.m-total svg{display:block;flex-shrink:0;}
        .card{
          background:var(--white);
          border-radius:var(--radius);
          box-shadow:var(--shadow);
          overflow:hidden;
          margin-bottom:20px;
        }
        .card-head{
          padding:clamp(16px, 3vw, 18px) clamp(16px, 3vw, 20px);
          border-bottom:1px solid var(--gray-100);
        }
        .card-head h2{
          margin:0 0 3px;
          font-size:clamp(14px, 3vw, 16px);
          display:flex;
          align-items:center;
          gap:8px;
          line-height:1.3;
        }
        .card-head p{
          margin:0;
          font-size:clamp(12px, 2.5vw, 13px);
          color:var(--gray-500);
          line-height:1.4;
        }
        .table-wrap{
          display:block;
          overflow-x:auto;
          -webkit-overflow-scrolling:touch;
        }
        table{
          width:100%;
          border-collapse:collapse;
          min-width:600px;
        }
        thead th{
          text-align:left;
          font-size:clamp(11px, 2.5vw, 12.5px);
          font-weight:600;
          color:var(--gray-500);
          background:var(--gray-50);
          padding:clamp(10px, 2vw, 12px) clamp(16px, 3vw, 20px);
          border-bottom:1px solid var(--gray-200);
          white-space:nowrap;
        }
        tbody td{
          padding:clamp(12px, 2vw, 16px) clamp(16px, 3vw, 20px);
          border-bottom:1px solid var(--gray-100);
          vertical-align:middle;
          font-size:clamp(13px, 2.5vw, 14px);
        }
        tbody tr:last-child td{border-bottom:none;}
        .pos-badge{
          width:clamp(26px, 4vw, 30px);
          height:clamp(26px, 4vw, 30px);
          border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-weight:700;
          font-size:clamp(11px, 2.5vw, 13px);
          background:var(--gray-100);
          color:var(--gray-700);
          flex-shrink:0;
        }
        .pos-badge.top{
          background:var(--amber-bg);
          color:var(--amber-text);
          border:1px solid var(--amber-border);
        }
        .student{
          display:flex;
          align-items:center;
          gap:10px;
          min-width:0;
        }
        .avatar{
          width:clamp(30px, 5vw, 34px);
          height:clamp(30px, 5vw, 34px);
          border-radius:50%;
          background:var(--blue-light);
          color:var(--blue);
          display:flex;align-items:center;justify-content:center;
          font-weight:700;
          font-size:clamp(12px, 2.5vw, 14px);
          flex:0 0 auto;
          overflow:hidden;
          position:relative;
          z-index:0;
        }
        .student-name{
          font-weight:600;
          font-size:clamp(13px, 2.5vw, 14px);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .student-nis{
          font-size:clamp(11px, 2vw, 12px);
          color:var(--gray-500);
        }
        .pill{
          display:inline-block;
          padding:3px 10px;
          border-radius:999px;
          font-size:clamp(11px, 2vw, 12.5px);
          font-weight:600;
          white-space:nowrap;
        }
        .pill.kelas{background:var(--green-bg);color:var(--green-text);}
        .pill.grha{background:var(--amber-bg);color:var(--amber-text);}
        .pill.jabatan{background:#e0f2fe;color:#0369a1;}
        .points-pill{
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:4px 12px;
          border-radius:999px;
          background:var(--blue-light);
          color:var(--blue);
          font-weight:700;
          font-size:clamp(12px, 2.5vw, 13.5px);
          white-space:nowrap;
        }
        .mobile-list{display:none;}
        .m-item{
          padding:clamp(14px, 3vw, 16px) clamp(16px, 3vw, 18px);
          border-bottom:1px solid var(--gray-100);
        }
        .m-item:last-child{border-bottom:none;}
        .m-top{
          display:flex;
          align-items:center;
          gap:12px;
          margin-bottom:10px;
        }
        .m-top .student{flex:1;min-width:0;}
        .m-top .student-name{
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        }
        .m-tags{
          display:flex;
          flex-wrap:wrap;
          gap:8px;
          margin-bottom:10px;
        }
        .m-total{
          display:flex;
          align-items:center;
          gap:6px;
          font-size:clamp(11px, 2vw, 12.5px);
          color:var(--gray-500);
          margin-bottom:2px;
        }
        .podium-card .card-head{
          background:linear-gradient(135deg, var(--amber-bg), var(--white));
        }
        .podium{
          display:flex;
          align-items:flex-end;
          justify-content:center;
          gap:clamp(8px, 3vw, 20px);
          padding:clamp(20px, 4vw, 28px) clamp(16px, 3vw, 24px) 0;
        }
        .podium-slot{
          display:flex;
          flex-direction:column;
          align-items:center;
          text-align:center;
          flex:1;
          max-width:200px;
          min-width:0;
        }
        .podium-slot.first{order:2;}
        .podium-slot.second{order:1;}
        .podium-slot.third{order:3;}
        .podium-medal{
          font-size:clamp(20px, 4vw, 26px);
          margin-bottom:8px;
          line-height:1;
        }
        .podium-avatar{
          width:clamp(48px, 8vw, 64px);
          height:clamp(48px, 8vw, 64px);
          border-radius:50%;
          background:var(--blue-light);
          color:var(--blue);
          display:flex;align-items:center;justify-content:center;
          font-weight:700;
          font-size:clamp(16px, 3vw, 20px);
          flex:0 0 auto;
          overflow:hidden;
          margin-bottom:10px;
          border:3px solid var(--white);
          box-shadow:0 0 0 2px var(--amber-border), var(--shadow);
        }
        .podium-slot.second .podium-avatar,
        .podium-slot.third .podium-avatar{
          width:clamp(42px, 7vw, 56px);
          height:clamp(42px, 7vw, 56px);
          font-size:clamp(14px, 2.5vw, 18px);
          box-shadow:0 0 0 2px var(--gray-200), var(--shadow);
        }
        .podium-name{
          font-weight:700;
          font-size:clamp(13px, 2.5vw, 14.5px);
          color:var(--gray-900);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          max-width:100%;
          margin-bottom:2px;
        }
        .podium-meta{
          font-size:clamp(11px, 2vw, 12px);
          color:var(--gray-500);
          margin-bottom:6px;
        }
        .podium-total{
          display:inline-flex;
          align-items:center;
          gap:5px;
          background:var(--blue-light);
          color:var(--blue);
          border-radius:999px;
          padding:4px 12px;
          font-size:clamp(11px, 2vw, 12.5px);
          font-weight:700;
          margin-bottom:12px;
        }
        .podium-step{
          width:100%;
          border-radius:10px 10px 0 0;
          display:flex;
          align-items:flex-start;
          justify-content:center;
          padding-top:clamp(8px, 2vw, 12px);
          font-weight:800;
          font-size:clamp(14px, 3vw, 18px);
        }
        .podium-slot.first .podium-step{
          height:clamp(64px, 12vw, 88px);
          background:linear-gradient(180deg, var(--amber-bg), #fffbeb);
          color:var(--amber-text);
          border:1px solid var(--amber-border);
          border-bottom:none;
        }
        .podium-slot.second .podium-step{
          height:clamp(44px, 9vw, 64px);
          background:var(--gray-100);
          color:var(--gray-700);
          border:1px solid var(--gray-200);
          border-bottom:none;
        }
        .podium-slot.third .podium-step{
          height:clamp(32px, 7vw, 48px);
          background:var(--gray-50);
          color:var(--gray-500);
          border:1px solid var(--gray-200);
          border-bottom:none;
        }
        .stats-strip{
          display:grid;
          grid-template-columns:repeat(3, 1fr);
          gap:clamp(8px, 2vw, 12px);
          background:var(--white);
          border-radius:var(--radius);
          box-shadow:var(--shadow);
          padding:clamp(14px, 3vw, 18px) clamp(16px, 3vw, 20px);
          margin-bottom:20px;
        }
        .stat-item{
          display:flex;
          flex-direction:column;
          align-items:center;
          text-align:center;
          gap:3px;
          padding:clamp(6px, 1.5vw, 10px) clamp(6px, 1.5vw, 10px);
          border-right:1px solid var(--gray-100);
        }
        .stat-item:last-child{border-right:none;}
        .stat-value{
          font-weight:800;
          font-size:clamp(18px, 4vw, 24px);
          color:var(--gray-900);
          line-height:1.2;
          display:flex;
          align-items:center;
          gap:6px;
        }
        .stat-label{
          font-size:clamp(11px, 2vw, 12.5px);
          color:var(--gray-500);
          line-height:1.3;
        }
        .empty-podium{
          background:var(--white);
          border-radius:var(--radius);
          box-shadow:var(--shadow);
          padding:clamp(24px, 5vw, 36px);
          text-align:center;
          color:var(--gray-500);
          font-size:clamp(13px, 2.5vw, 14px);
          margin-bottom:20px;
        }
        .inline-loading{
          background:var(--white);
          border-radius:var(--radius);
          box-shadow:var(--shadow);
          padding:clamp(24px, 5vw, 36px);
          text-align:center;
          color:var(--gray-500);
          font-size:clamp(13px, 2.5vw, 14px);
          margin-bottom:20px;
        }
        @media (max-width: 768px){
          .table-wrap{display:none;}
          .mobile-list{display:block;}
        }
        @media (max-width: 480px){
          .stats-strip{grid-template-columns:1fr;gap:0;}
          .stat-item{
            flex-direction:row;
            justify-content:space-between;
            border-right:none;
            border-bottom:1px solid var(--gray-100);
            padding:10px 4px;
          }
          .stat-item:last-child{border-bottom:none;}
          .stat-value{font-size:clamp(16px, 4vw, 20px);}
        }
      `}</style>

      {/* Header */}
      <div className="header-row">
        <div className="header-icon"><Trophy size={20} /></div>
        <div className="header-text">
          <h1>Peringkat Top 20</h1>
          <p>Peringkat siswa berdasarkan poin IPT per kategori</p>
        </div>
      </div>

      {/* Controls */}
      <div className="controls">
        <div className="cat-chips">
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              className={`chip ${activeCategory === cat.key ? 'active' : ''}`}
              onClick={() => handleSelectCategory(cat.key)}
              disabled={!!loadingMap[cat.key]}
            >
              <span className="chip-icon"><cat.icon size={16} /></span>
              <span className="chip-text">
                <strong>{cat.label}</strong>
                {dataByCategory[cat.key] && <span>{dataByCategory[cat.key].length} {cat.key === 'pembina' ? 'pembina' : 'siswa'}</span>}
              </span>
            </button>
          ))}
        </div>

        <button
          className="refresh-btn"
          onClick={() => fetchCategory(activeCategory)}
        >
          <RefreshCw size={15} />
          Refresh data
        </button>
      </div>

      {categoryLoading && currentData.length === 0 ? (
        <div className="inline-loading">Memuat peringkat {activeLabel}...</div>
      ) : (
        <>
          {/* Podium top 3 */}
          {top3.length > 0 ? (
            <div className="card podium-card" style={{ marginBottom: '12px' }}>
              <div className="card-head">
                <h2><Trophy size={16} /> Podium Top 3</h2>
                <p>{title} - {isPembina ? 'pembina' : 'siswa'} dengan poin {superlative}</p>
              </div>
              <div className="podium">
                {[
                  { student: top3.find((s) => s.rank === 2), cls: 'second', rank: 2 },
                  { student: top3.find((s) => s.rank === 1), cls: 'first', rank: 1 },
                  { student: top3.find((s) => s.rank === 3), cls: 'third', rank: 3 },
                ].filter((slot) => slot.student).map((slot) => {
                  const s = slot.student;
                  return (
                    <div key={s.id} className={`podium-slot ${slot.cls}`}>
                      <div className="podium-medal"><MedalIcon rank={slot.rank} /></div>
                      <div className="podium-avatar">
                        {s.foto ? (
                          <img
                            src={`${API_BASE_URL.replace('/api', '')}${s.foto}`}
                            alt={s.nama}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span>{initials(s.nama)}</span>
                        )}
                      </div>
                      <div className="podium-name" title={s.nama}>{s.nama}</div>
                      <div className="podium-meta">
                        {isPembina ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="pill jabatan" style={{ fontSize: '10px', padding: '2px 8px' }}>{s.jabatan || s.detail || 'Guru'}</span>
                          </span>
                        ) : (
                          <>{s.kelas} · {s.grha || '-'}</>
                        )}
                      </div>
                      <div className="podium-total"><Award size={13} /> {s.total_point} poin</div>
                      <div className="podium-step">{s.rank}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty-podium">Belum ada data peringkat untuk ditampilkan.</div>
          )}

          {/* Stats strip */}
          <div className="stats-strip">
            <div className="stat-item">
              <div className="stat-value"><Users size={20} /> {currentData.length}</div>
              <div className="stat-label">{isPembina ? 'Guru' : 'Siswa'} dalam peringkat</div>
            </div>
            <div className="stat-item">
              <div className="stat-value"><Award size={20} /> {totalPoints}</div>
              <div className="stat-label">Total poin {activeLabel}</div>
            </div>
            <div className="stat-item">
              <div className="stat-value"><Clock size={20} /> {lastUpdated ? lastUpdated.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</div>
              <div className="stat-label">Terakhir diperbarui</div>
            </div>
          </div>

          {/* Ranking card */}
          <div className="card">
            <div className="card-head">
              <h2 id="cardTitle"><ClipboardList size={16} /> {title}</h2>
              <p id="cardSub">Top 20 {isPembina ? 'pembina' : 'siswa'} dengan poin {activeLabel} {superlative} yang telah disetujui</p>
            </div>

            {/* Desktop table */}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Posisi</th>
                    <th>Nama</th>
                    <th>{isPembina ? 'NIP' : 'Kelas'}</th>
                    <th>{isPembina ? 'Jabatan' : 'Grha'}</th>
                    <th>Total Poin</th>
                    {showRecordButton && <th>Aksi</th>}
                  </tr>
                </thead>
                <tbody>
                  {currentData.length === 0 ? (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center', color: SLATE, padding: '32px' }}>Belum ada data</td>
                    </tr>
                  ) : (
                    currentData.map((s) => {
                      return (
                        <tr key={s.id}>
                          <td><span className={`pos-badge ${s.rank <= 3 ? 'top' : ''}`}>{s.rank}</span></td>
                          <td>
                            <div className="student">
                              <div className="avatar">
                                {s.foto ? (
                                  <img
                                    src={`${API_BASE_URL.replace('/api', '')}${s.foto}`}
                                    alt={s.nama}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                  />
                                ) : (
                                  <span>{initials(s.nama)}</span>
                                )}
                              </div>
                              <div>
                                <div className="student-name">{s.nama}</div>
                                <div className="student-nis">{isPembina ? `NIP ${s.nip}` : `NIS ${s.nis}`}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className="pill kelas">{isPembina ? (s.nip || '-') : s.kelas}</span></td>
                          <td><span className={`pill ${isPembina ? 'jabatan' : 'grha'}`}>{isPembina ? (s.jabatan || s.detail || 'Guru') : (s.grha || '-')}</span></td>
                          <td><span className="points-pill"><Award size={13} /> {s.total_point} poin</span></td>
                          {showRecordButton && (
                            <td>
                              <button
                                onClick={() => setRecordTarget(s)}
                                title={`Lihat record ${activeLabel}`}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
                              >
                                <Eye size={14} /> Detail
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="mobile-list">
              {currentData.length === 0 ? (
                <div className="m-item" style={{ textAlign: 'center', color: SLATE }}>Belum ada data</div>
              ) : (
                currentData.map((s) => {
                  return (
                    <div key={s.id} className="m-item">
                      <div className="m-top">
                        <span className={`pos-badge ${s.rank <= 3 ? 'top' : ''}`}>{s.rank}</span>
                        <div className="student">
                          <div className="avatar">
                            {s.foto ? (
                              <img
                                src={`${API_BASE_URL.replace('/api', '')}${s.foto}`}
                                alt={s.nama}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <span>{initials(s.nama)}</span>
                            )}
                          </div>
                          <div>
                            <div className="student-name">{s.nama}</div>
                            <div className="student-nis">{isPembina ? `NIP ${s.nip}` : `NIS ${s.nis}`}</div>
                          </div>
                        </div>
                      </div>
                      <div className="m-tags">
                        <span className="pill kelas">{isPembina ? (s.nip || '-') : s.kelas}</span>
                        <span className={`pill ${isPembina ? 'jabatan' : 'grha'}`}>{isPembina ? (s.jabatan || s.detail || 'Guru') : (s.grha || '-')}</span>
                      </div>
                      <div className="m-total"><ClipboardList size={13} /> Total poin: <span className="points-pill"><Award size={13} /> {s.total_point} poin</span></div>
                      {showRecordButton && (
                        <button
                          onClick={() => setRecordTarget(s)}
                          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginTop: '10px', width: '100%', padding: '10px 12px', background: 'var(--blue)', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          <Eye size={15} /> Detail {activeLabel}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
      {recordTarget && activeCategory !== 'pembina' && (
        <CategoryRecordModal
          student={recordTarget}
          category={activeCategory}
          totalPoint={recordTarget.total_point}
          onClose={() => setRecordTarget(null)}
        />
      )}
      {recordTarget && activeCategory === 'pembina' && (
        <PembinaRecordModal
          teacher={recordTarget}
          totalPoint={recordTarget.total_point}
          onClose={() => setRecordTarget(null)}
        />
      )}
    </div>
  );
}

export default Leaderboard;
