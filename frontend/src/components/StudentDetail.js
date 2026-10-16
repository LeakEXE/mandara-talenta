import React, { useState, useEffect, useMemo } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import { formatDisplayText } from '../utils/formatDisplayText';
import { buildEvidenceMap } from '../utils/historyEvidence';
import { EvidenceViewer } from './EvidenceViewer';
import { CATEGORY_ICONS } from './icons';
import { User, Pencil, FileText, History, Paperclip } from 'lucide-react';

function getIptDetailRows(points = {}) {
  // Backend stores pelanggaran buckets already negative (point_dikurangi:
  // -1, -5, -25), so no negation here - negating would flip them positive.
  const pelanggaranTotal = ['pelanggaran_ringan', 'pelanggaran_sedang', 'pelanggaran_berat', 'pelanggaran_lainnya']
    .reduce((sum, key) => sum + (Number(points[key]) || 0), 0);
  return [
    ['Prestasi', Number(points.prestasi) || 0],
    ['Perilaku', ['tanggung_jawab', 'disiplin', 'kepedulian', 'kemandirian', 'spiritual', 'kejujuran', 'kepercayaan_diri']
      .reduce((sum, key) => sum + (Number(points[key]) || 0), 0)],
    ['Organisasi', Number(points.organisasi) || 0],
    ['Kepanitiaan', Number(points.kepanitiaan) || 0],
    ['Event', Number(points.event) || 0],
    ['Pelanggaran', pelanggaranTotal > 0 ? -pelanggaranTotal : pelanggaranTotal]
  ];
}

function StudentDetail({ student, onClose }) {
    const minIpt = useMinIptPerGrade();
    const [records, setRecords] = useState(null);
    const [iptHistory, setIptHistory] = useState([]);
    const [iptCard, setIptCard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [evidenceImage, setEvidenceImage] = useState(null);

    useEffect(() => {
        if (!student?.id) return;

        const fetchData = async () => {
            try {
                const [recordsRes, historyRes] = await Promise.all([
                    api.get(`/users/${student.id}/records`),
                    api.get(`/users/${student.id}/ipt-history`)
                ]);
                setRecords(recordsRes.data);
                setIptHistory(historyRes.data || []);
                const iptCardRes = await api.get(`/reports/ipt-card/${student.id}`);
                setIptCard(iptCardRes.data);
            } catch (err) {
                setError(err.response?.data?.message || 'Gagal memuat detail siswa');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [student?.id]);

    // Evidence photo per history row, matched by exact keterangan text.
    const evidenceMap = useMemo(() => buildEvidenceMap(records), [records]);

    const groupHistoryByCategory = (history = []) => {
        const grouped = {};
        const categoryOrder = ['prestasi', 'perilaku', 'organisasi', 'kepanitiaan', 'event', 'pelanggaran', 'initial', 'manual'];

        categoryOrder.forEach(cat => {
            grouped[cat] = [];
        });

        history.forEach(record => {
            const jenis = record.jenis_perubahan || 'initial';
            if (!grouped[jenis]) {
                grouped[jenis] = [];
            }
            grouped[jenis].push(record);
        });

        return categoryOrder
            .filter(cat => grouped[cat] && grouped[cat].length > 0)
            .map(cat => ({ category: cat, records: grouped[cat] }));
    };

    const getImageUrl = (imagePath) => {
        if (!imagePath) return null;
        const baseUrl = API_BASE_URL.replace('/api', '');
        return `${baseUrl}${imagePath}`;
    };

    const avatarUrl = getImageUrl(student?.foto);
    const detailRows = getIptDetailRows(student?.ipt_points || iptCard?.points || {});

    return (
        <div className="modal-overlay app-modal-overlay" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', zIndex: 1500 }} onClick={(e) => { if (e.target === e.currentTarget) { onClose(); setEvidenceImage(null); } }}>
          <div className="modal-content" style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(15,23,42,.25)' }}>
            <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '52px', height: '52px', borderRadius: '50%', background: '#fff', border: '2px solid #2563eb', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', overflow: 'hidden' }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={student.nama} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}><User size={18} /> Detail Siswa</h3>
              </div>
              <button onClick={() => { onClose(); setEvidenceImage(null); }} className="btn" style={{ border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', background: '#ef4444', color: '#fff', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>Tutup</button>
            </div>

            <div style={{ padding: '16px 20px 22px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : error ? (
                <div className="alert alert-danger">{error}</div>
              ) : (
                <>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Nama</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.nama}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>NIS</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.nis}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Username</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.username || '-'}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Grha</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.grha || '-'}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Jenis Kelamin</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.jenis_kelamin === 'L' ? 'Laki-laki' : student.jenis_kelamin === 'P' ? 'Perempuan' : (student.jenis_kelamin || '-')}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Desil</div>
                    <div style={{ fontSize: '.95rem', fontWeight: 600, color: '#0f172a' }}>{student.desil ?? '-'}</div>
                  </div>
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Detail IPT</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {detailRows.map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.88rem', fontWeight: 400, color: '#334155' }}>
                          <span>{label}</span>
                          <span style={{ fontWeight: 700, color: '#0f172a' }}>{value > 0 ? '+' : ''}{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '8px' }}>Riwayat IPT</div>
                    {iptHistory.length === 0 ? (
                      <div style={{ fontSize: '.85rem', color: '#94a3b8', textAlign: 'center', padding: '6px' }}>Belum ada riwayat</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
                        {groupHistoryByCategory(iptHistory).map(group => {
                          const categoryIcons = {
                            prestasi: CATEGORY_ICONS.prestasi,
                            perilaku: CATEGORY_ICONS.perilaku,
                            organisasi: CATEGORY_ICONS.organisasi,
                            kepanitiaan: CATEGORY_ICONS.kepanitiaan,
                            event: CATEGORY_ICONS.event,
                            pelanggaran: CATEGORY_ICONS.pelanggaran,
                            initial: History,
                            manual: Pencil
                          };
                          const categoryLabels = {
                            prestasi: 'Prestasi',
                            perilaku: 'Perilaku',
                            organisasi: 'Organisasi',
                            kepanitiaan: 'Kepanitiaan',
                            event: 'Event',
                            pelanggaran: 'Pelanggaran',
                            initial: 'Initial',
                            manual: 'Manual'
                          };
                          return (
                            <div key={group.category} style={{ border: '1px solid #e2e8f0', borderRadius: '8px'}}>
                              <div style={{ background: '#f1f5f9', padding: '8px 12px', fontSize: '.75rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {(() => { const CatIcon = categoryIcons[group.category] || FileText; return <CatIcon size={14} />; })()}
                                <span>{categoryLabels[group.category] || group.category}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#64748b' }}>{group.records.length} record</span>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {group.records.map(record => {
                                  const evidenceFoto = evidenceMap[record.keterangan];
                                  return (
                                  <div key={record.id} style={{ padding: '10px 12px', borderTop: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                      <span style={{ color: '#334155', fontSize: '.78rem', wordBreak: 'break-word', flex: 1 }}>
                                        {formatDisplayText(record.keterangan || '-')}
                                      </span>
                                      <span style={{ fontWeight: 700, color: record.point_change > 0 ? '#16a34a' : record.point_change < 0 ? '#ef4444' : '#64748b', fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                                        {record.point_change > 0 ? '+' : ''}{record.point_change}
                                      </span>
                                    </div>
                                    {evidenceFoto && (
                                      <span onClick={() => setEvidenceImage(evidenceFoto)} style={{ color: '#2563eb', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Paperclip size={12} /> Lihat Bukti</span>
                                    )}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.68rem', color: '#94a3b8' }}>
                                      <span>{new Date(record.created_at).toLocaleString('id-ID')}</span>
                                      <span>{record.ipt_sebelum} → {record.ipt_sesudah}</span>
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px 16px' }}>
                    <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Total IPT</div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', borderRadius: '50%', background: isBelowMinIpt(student.ipt_total || 80, minIptFor(minIpt, student?.kelas)) ? '#dc2626' : '#0891b2', color: '#fff', fontWeight: 700, fontSize: '1rem' }}>{student.ipt_total || 80}</span>
                  </div>
                </>
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

export default StudentDetail;
