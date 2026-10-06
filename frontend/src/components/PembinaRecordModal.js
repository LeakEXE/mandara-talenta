import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { getRecordPhotoUrl } from '../utils/recordPhoto';
import { formatDisplayText } from '../utils/formatDisplayText';
import { EvidenceViewer } from './EvidenceViewer';
import { CATEGORY_ICONS } from './icons';
import { User, Paperclip } from 'lucide-react';

function PembinaRecordModal({ teacher, totalPoint, onClose }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evidenceImage, setEvidenceImage] = useState(null);

  useEffect(() => {
    if (!teacher?.id) return;
    setLoading(true);
    setError('');
    api.get(`/search/leaderboard/pembina/${teacher.id}/records`)
      .then((res) => setItems(res.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat record bimbingan'))
      .finally(() => setLoading(false));
  }, [teacher?.id]);

  const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    const baseUrl = API_BASE_URL.replace('/api', '');
    return imagePath.startsWith('http') ? imagePath : `${baseUrl}${imagePath.startsWith('/') ? imagePath : `/${imagePath}`}`;
  };

  const avatarUrl = getImageUrl(teacher?.foto);
  const PembinaIcon = CATEGORY_ICONS.pembina;

  // Kelompok rows (same grup_lomba) collapse into one entry with member chips.
  const groups = [];
  {
    const seen = new Map();
    (items || []).forEach((item) => {
      if (item.kategori_lomba === 'kelompok' && item.grup_lomba) {
        if (!seen.has(item.grup_lomba)) {
          const g = { groupId: item.grup_lomba, members: [] };
          seen.set(item.grup_lomba, g);
          groups.push(g);
        }
        seen.get(item.grup_lomba).members.push(item);
      } else {
        groups.push({ groupId: null, members: [item] });
      }
    });
  }

  const formatDate = (d) => d
    ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
    : '-';

  return (
    <div className="modal-overlay app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1500 }} onClick={(e) => { if (e.target === e.currentTarget) { onClose(); setEvidenceImage(null); } }}>
      <div className="modal-content modal-sheet" style={{ background: '#fff', borderRadius: '14px', width: '100%', boxShadow: '0 20px 50px rgba(15,23,42,.25)' }}>
        <div className="modal-header record-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#fff', border: '2px solid #2563eb', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', overflow: 'hidden', flexShrink: 0 }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={teacher.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <User size={16} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <PembinaIcon size={18} /> Bimbingan: {teacher.nama}
              </h3>
              <div style={{ fontSize: '.78rem', color: '#64748b' }}>
                {teacher.jabatan || teacher.detail || 'Guru'} · Total: <strong style={{ color: '#0f172a' }}>{totalPoint ?? 0} poin</strong>
              </div>
            </div>
          </div>
          <button onClick={() => { onClose(); setEvidenceImage(null); }} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s', whiteSpace: 'nowrap', flexShrink: 0 }}>Tutup</button>
        </div>

        <div style={{ padding: '16px 20px 22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : error ? (
            <div className="alert alert-danger">{error}</div>
          ) : groups.length === 0 ? (
            <div className="empty-state">Belum ada prestasi bimbingan yang disetujui.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
              {groups.map((group) => {
                const first = group.members[0];
                const isGroup = !!group.groupId;
                const fotoUrl = first.foto ? getRecordPhotoUrl(first.foto, 'prestasi') : null;
                return (
                  <div key={group.groupId || first.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    {fotoUrl && (
                      <img
                        src={fotoUrl}
                        alt="Bukti"
                        onClick={() => setEvidenceImage(first.foto)}
                        title="Klik untuk memperbesar"
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', flexShrink: 0, border: '1px solid #e2e8f0' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '2px' }}>
                        <strong style={{ fontSize: '.9rem', color: '#0f172a', wordBreak: 'break-word' }}>
                          {first.nama_lomba}
                          {isGroup && <span style={{ marginLeft: '8px', fontSize: '.72rem', fontWeight: 600, color: '#1d4ed8' }}>Kelompok · {group.members.length} siswa</span>}
                        </strong>
                        <span className="badge badge-success" style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>+{first.point} poin</span>
                      </div>
                      <div style={{ fontSize: '.8rem', color: '#64748b', marginBottom: '4px' }}>
                        {isGroup
                          ? group.members.map((m) => `${m.student_nama} (${m.student_kelas || '-'})`).join(', ')
                          : `${first.student_nama} (${first.student_nis || '-'}) · ${first.student_kelas || '-'}`}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.82rem', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}>
                        <span style={{ color: '#64748b' }}>Juara / Kategori</span>
                        <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right' }}>{formatDisplayText(first.juara)} · {formatDisplayText(first.kategori)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.82rem', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}>
                        <span style={{ color: '#64748b' }}>Tanggal</span>
                        <span style={{ color: '#0f172a', fontWeight: 600 }}>{formatDate(first.created_at)}</span>
                      </div>
                      {fotoUrl && (
                        <span onClick={() => setEvidenceImage(first.foto)} style={{ color: '#2563eb', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: '6px' }}><Paperclip size={12} /> Lihat Bukti</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {evidenceImage && (
        <div className="app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1600 }} onClick={() => setEvidenceImage(null)}>
          <div style={{ position: 'relative', width: 'min(880px, 90vw)', maxHeight: '85vh', background: '#fff', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 50px rgba(0,0,0,.4)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#0f172a' }}>Bukti Foto</div>
              <button onClick={() => setEvidenceImage(null)} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', whiteSpace: 'nowrap' }}>Tutup</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '12px' }}>
              <EvidenceViewer src={getImageUrl(evidenceImage)} alt="Bukti" pdfHeight="70vh" imgStyle={{ maxWidth: '100%', borderRadius: '8px', display: 'block' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PembinaRecordModal;
