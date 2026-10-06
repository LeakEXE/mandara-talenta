import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { getRecordPhotoUrl } from '../utils/recordPhoto';
import { toTitleCase } from '../utils/perilaku';
import { formatDisplayText } from '../utils/formatDisplayText';
import { EvidenceViewer } from './EvidenceViewer';
import { CATEGORY_ICONS } from './icons';
import { User, FileText, Paperclip } from 'lucide-react';

const CATEGORY_LABELS = {
  prestasi: 'Prestasi',
  organisasi: 'Organisasi',
  kepanitiaan: 'Kepanitiaan',
  event: 'Event',
  pelanggaran: 'Pelanggaran',
  perilaku: 'Perilaku'
};

function Field({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '.82rem', padding: '5px 0', borderTop: '1px solid #f1f5f9' }}>
      <span style={{ color: '#64748b', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function PointBadge({ value, negative }) {
  return (
    <span
      className={`badge ${negative ? 'badge-danger' : 'badge-success'}`}
      style={{ fontSize: '.78rem' }}
    >
      {negative ? `${value} poin` : `+${value} poin`}
    </span>
  );
}

// Full field set per category — more detailed than the summary cards in
// StudentRecordsHistory. Returns { title, subtitle, fields, point, negative, foto }.
function describeRecord(item, category) {
  switch (category) {
    case 'prestasi':
      return {
        title: item.nama_lomba,
        subtitle: `${formatDisplayText(item.jenis_lomba || 'akademik')} · ${item.kategori_lomba === 'kelompok' ? 'Kelompok' : 'Individu'}`,
        fields: [
          ['Juara', formatDisplayText(item.juara)],
          ['Kategori', formatDisplayText(item.kategori)],
          ['Pembina', (item.pembina_list && item.pembina_list.length > 0 ? item.pembina_list : [item.pembina]).filter(Boolean).join(', ') || '-'],
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point,
        negative: false,
        foto: item.foto
      };
    case 'organisasi':
      return {
        title: item.kategori_organisasi,
        subtitle: `Jabatan: ${item.jabatan_organisasi || '-'}`,
        fields: [
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point,
        negative: false,
        foto: item.foto
      };
    case 'kepanitiaan':
      return {
        title: item.kategori_kepanitiaan,
        subtitle: `Jabatan: ${item.jabatan_kepanitiaan || '-'}`,
        fields: [
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point,
        negative: false,
        foto: item.foto
      };
    case 'event':
      return {
        title: item.nama_event,
        subtitle: `Tingkat: ${formatDisplayText(item.tingkat)}`,
        fields: [
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point,
        negative: false,
        foto: item.foto
      };
    case 'pelanggaran':
      return {
        title: formatDisplayText(item.keterangan),
        subtitle: `Jenis: ${item.jenis_pelanggaran || '-'}`,
        fields: [
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point_dikurangi,
        negative: true,
        foto: item.foto
      };
    case 'perilaku':
      return {
        title: 'Perilaku Positif',
        subtitle: toTitleCase(item.karakter_siswa || '-'),
        fields: [
          ['Kelas', item.kelas || '-'],
          ['Tanggal', item.created_at ? new Date(item.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-']
        ],
        point: item.point,
        negative: false,
        foto: null
      };
    default:
      return { title: '-', subtitle: '', fields: [], point: 0, negative: false, foto: null };
  }
}

function CategoryRecordModal({ student, category, totalPoint, onClose }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [evidenceImage, setEvidenceImage] = useState(null);

  useEffect(() => {
    if (!student?.id || !category) return;
    setLoading(true);
    setError('');
    api.get(`/users/${student.id}/records`)
      .then((res) => setItems(res.data?.[category] || []))
      .catch((err) => setError(err.response?.data?.message || 'Gagal memuat record'))
      .finally(() => setLoading(false));
  }, [student?.id, category]);

  const getImageUrl = (imagePath) => {
    if (!imagePath) return null;
    const baseUrl = API_BASE_URL.replace('/api', '');
    return imagePath.startsWith('http') ? imagePath : `${baseUrl}${imagePath.startsWith('/') ? imagePath : `/${imagePath}`}`;
  };

  const avatarUrl = getImageUrl(student?.foto);
  const CatIcon = CATEGORY_ICONS[category] || FileText;
  const label = CATEGORY_LABELS[category] || category;

  return (
    <div className="modal-overlay app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1500 }} onClick={(e) => { if (e.target === e.currentTarget) { onClose(); setEvidenceImage(null); } }}>
      <div className="modal-content modal-sheet" style={{ background: '#fff', borderRadius: '14px', width: '100%', boxShadow: '0 20px 50px rgba(15,23,42,.25)' }}>
        <div className="modal-header record-modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
            <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#fff', border: '2px solid #2563eb', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', overflow: 'hidden', flexShrink: 0 }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt={student.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <User size={16} />
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <CatIcon size={18} /> {label}: {student.nama}
              </h3>
              <div style={{ fontSize: '.78rem', color: '#64748b' }}>
                {student.kelas || '-'} · {student.grha || '-'} · Total {label}: <strong style={{ color: '#0f172a' }}>{totalPoint ?? 0} poin</strong>
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
          ) : items.length === 0 ? (
            <div className="empty-state">Belum ada record {label.toLowerCase()} yang disetujui.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto' }}>
              {items.map((item) => {
                const d = describeRecord(item, category);
                const fotoUrl = d.foto ? getRecordPhotoUrl(d.foto, category) : null;
                return (
                  <div key={item.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    {fotoUrl && (
                      <img
                        src={fotoUrl}
                        alt="Bukti"
                        onClick={() => setEvidenceImage(d.foto)}
                        title="Klik untuk memperbesar"
                        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, cursor: 'pointer', flexShrink: 0, border: '1px solid #e2e8f0' }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '2px' }}>
                        <strong style={{ fontSize: '.9rem', color: '#0f172a', wordBreak: 'break-word' }}>{d.title}</strong>
                        <PointBadge value={d.point} negative={d.negative} />
                      </div>
                      {d.subtitle && <div style={{ fontSize: '.8rem', color: '#64748b', marginBottom: '4px' }}>{d.subtitle}</div>}
                      <div>
                        {d.fields.map(([fl, fv]) => (
                          <Field key={fl} label={fl} value={fv} />
                        ))}
                      </div>
                      {fotoUrl && (
                        <span onClick={() => setEvidenceImage(d.foto)} style={{ color: '#2563eb', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: '6px' }}><Paperclip size={12} /> Lihat Bukti</span>
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

export default CategoryRecordModal;
