import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { formatDisplayText } from '../utils/formatDisplayText';
import { StatusIcon } from './icons';
import { Camera, Inbox } from 'lucide-react';
import { EvidenceViewer, EvidenceFileThumb, isPdfPath } from './EvidenceViewer';

function Approvals() {
  const PAGE_BG = 'var(--bg-secondary)';
  const CARD = 'var(--bg-primary)';
  const BORDER = 'var(--border-color)';
  const TEXT = 'var(--ink)';
  const MUTED = 'var(--slate)';
  const BLUE = 'var(--blue)';
  const BLUE_DARK = 'var(--blue-dark)';
  const AMBER = 'var(--warning-color)';
  const AMBER_BG = 'var(--amber-bg)';
  const GREEN = 'var(--success-color)';
  const GREEN_DARK = '#059669';
  const RED = 'var(--danger-color)';
  const RED_DARK = 'var(--danger-dark)';
  const RADIUS = 'var(--card-radius)';
  const [activeTab, setActiveTab] = useState('prestasi');
  const [approvals, setApprovals] = useState({
    prestasi: [],
    event: [],
    organisasi: [],
    kepanitiaan: [],
    pelanggaran: []
  });
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState(null);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  // Group roster popup: the clicked kelompok entry (members shown on demand)
  const [groupPopup, setGroupPopup] = useState(null);
  // Access gating: superadmin always; others need at least one approval scope.
  const [hasAccess, setHasAccess] = useState(false);
  // Enlarged photo popup (same pattern as DriveViewer: URL string or null)
  const [previewImage, setPreviewImage] = useState(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    fetchApprovals();
  }, []);

  const fetchApprovals = async () => {
    try {
      let storedRole = '';
      try {
        storedRole = JSON.parse(localStorage.getItem('user') || '{}').role || '';
      } catch {
        storedRole = '';
      }
      const superadmin = storedRole === 'superadmin';

      let canApprove = superadmin;
      if (!superadmin) {
        try {
          const permRes = await api.get('/permissions/my-permissions');
          const scopes = permRes.data?.approval_scopes;
          canApprove = Array.isArray(scopes) && scopes.length > 0;
        } catch {
          canApprove = false;
        }
      }
      setHasAccess(canApprove);
      if (!canApprove) {
        return;
      }

      const approvalsRes = await api.get('/approvals/all');
      setApprovals({
        prestasi: [],
        event: [],
        organisasi: [],
        kepanitiaan: [],
        pelanggaran: [],
        ...(approvalsRes.data || {})
      });
    } catch (error) {
      console.error('Error fetching approvals:', error);
      if (error.response?.status === 403) {
        setHasAccess(false);
      } else {
        setMessage('Gagal memuat data approvals');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (type, id) => {
    try {
      await api.put(`/approvals/superadmin/${type}/${id}`, {
        status: 'approved',
        notes: notes || 'Disetujui'
      });
      
      const typeLabels = {
        prestasi: 'Prestasi',
        event: 'Event',
        organisasi: 'Organisasi',
        kepanitiaan: 'Kepanitiaan',
        pelanggaran: 'Pelanggaran'
      };
      setMessage(`${typeLabels[type] || type} berhasil disetujui!`);
      setSelectedItem(null);
      setNotes('');
      fetchApprovals();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menyetujui');
    }
  };

  const handleReject = async (type, id) => {
    try {
      await api.put(`/approvals/superadmin/${type}/${id}`, {
        status: 'rejected',
        notes: notes || 'Ditolak'
      });
      
      const typeLabels = {
        prestasi: 'Prestasi',
        event: 'Event',
        organisasi: 'Organisasi',
        kepanitiaan: 'Kepanitiaan',
        pelanggaran: 'Pelanggaran'
      };
      setMessage(`${typeLabels[type] || type} ditolak`);
      setSelectedItem(null);
      setNotes('');
      fetchApprovals();
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menolak');
    }
  };


  const getApprovalStatus = (item) => item.superadmin_status || item.status || 'pending';

  // Clickable "Kelompok · N siswa" label shared by desktop + mobile.
  // Opens the roster popup instead of inlining every member name.
  const renderGroupLabel = (item) => (
    <button
      onClick={() => setGroupPopup(item)}
      title="Lihat anggota kelompok"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '600',
        color: BLUE,
        fontFamily: 'inherit',
        textDecoration: 'underline',
        textUnderlineOffset: '2px'
      }}
      onMouseEnter={(e) => e.currentTarget.style.color = BLUE_DARK}
      onMouseLeave={(e) => e.currentTarget.style.color = BLUE}
    >
      Kelompok · {item._groupSize} siswa
    </button>
  );

  const renderTable = (data, type) => {
    if (data.length === 0) {
      return (
        <div style={{
          padding: "60px 20px",
          textAlign: "center",
          color: MUTED
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--muted-light)' }}><Inbox size={34} /></span>
          <strong style={{ color: TEXT, display: "block", marginBottom: "4px", fontSize: "15px" }}>Belum ada pengajuan {type}</strong>
          Pengajuan baru akan muncul di sini untuk ditinjau.
        </div>
      );
    }

    // Kelompok prestasi: pending siblings sharing one grup_lomba render as a
    // single group card (one acceptance covers the whole group server-side).
    // Processed rows keep their individual status rows.
    let displayData = data;
    if (type === 'prestasi') {
      const seenGroups = new Set();
      const grouped = [];
      for (const item of data) {
        if (item.grup_lomba && getApprovalStatus(item) === 'pending') {
          if (seenGroups.has(item.grup_lomba)) continue;
          seenGroups.add(item.grup_lomba);
          const members = data.filter(
            (d) => d.grup_lomba === item.grup_lomba && getApprovalStatus(d) === 'pending'
          );
          grouped.push({
            ...item,
            _groupSize: members.length,
            _members: members.map((m) => ({ nama: m.nama, nis: m.nis, kelas: m.kelas }))
          });
        } else {
          grouped.push(item);
        }
      }
      displayData = grouped;
    }

    const columns = {
      prestasi: ['Diajukan Oleh', 'Nama', 'NIS', 'Lomba', 'Jenis Lomba', 'Kategori Lomba', 'Juara', 'Kategori', 'Foto', 'Status', 'Aksi'],
      event: ['Diajukan Oleh', 'Nama', 'NIS', 'Event', 'Tingkat', 'Foto', 'Status', 'Aksi'],
      organisasi: ['Diajukan Oleh', 'Nama', 'NIS', 'Organisasi', 'Jabatan', 'Foto', 'Status', 'Aksi'],
      kepanitiaan: ['Diajukan Oleh', 'Nama', 'NIS', 'Kepanitiaan', 'Jabatan', 'Foto', 'Status', 'Aksi'],
      pelanggaran: ['Diajukan Oleh', 'Nama', 'NIS', 'Keterangan', 'Jenis', 'Foto', 'Status', 'Aksi'],
    };

    const getPhotoUrl = (path, uploadFolder = 'approvals') => {
      if (!path) return null;
      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
      }
      let cleanPath = path;
      // Handle organized paths (uploads/approved/type/filename)
      if (path.includes('approved')) {
        cleanPath = path.replace(/\\/g, '/');
        if (!cleanPath.startsWith('/')) {
          cleanPath = `/${cleanPath}`;
        }
      } else if (path.includes('\\') || path.includes(':')) {
        cleanPath = path.split('\\').pop();
        cleanPath = `/uploads/${uploadFolder}/${cleanPath}`;
      } else if (!cleanPath.startsWith('/')) {
        // Paths saved by the backend are already relative to the uploads root
        // (e.g. "uploads/event/filename.jpg") — just root them, don't nest
        // them under the fallback folder again.
        cleanPath = cleanPath.startsWith('uploads/')
          ? `/${cleanPath}`
          : `/uploads/${uploadFolder}/${cleanPath}`;
      }
      return `${API_BASE_URL.replace('/api', '')}${cleanPath}`;
    };

    const getItemPhoto = (item, itemType) => {
      // `foto` is the actual column name returned by the approvals API
      // (`foto_path` kept as fallback for legacy rows).
      const foto = item.foto || item.foto_path;
      if (!foto) return null;
      if (itemType === 'pelanggaran') {
        return getPhotoUrl(foto, 'pelanggaran');
      }
      return getPhotoUrl(foto);
    };

    // Every remaining table type shows the photo + approval-status columns.
    const usesApprovalStatus = true;

    // Get data columns for mobile cards (exclude diajukan, nama, nis, foto, status, aksi)
    const dataCols = columns[type].filter(c => 
      c !== 'Diajukan Oleh' && c !== 'Nama' && c !== 'NIS' && c !== 'Foto' && c !== 'Status' && c !== 'Aksi'
    );

    const getFieldLabel = (col) => {
      const labelMap = {
        'Lomba': 'Lomba',
        'Jenis Lomba': 'Jenis',
        'Kategori Lomba': 'Kategori Lomba',
        'Juara': 'Juara',
        'Kategori': 'Kategori',
        'Event': 'Event',
        'Tingkat': 'Tingkat',
        'Organisasi': 'Organisasi',
        'Jabatan': 'Jabatan',
        'Kepanitiaan': 'Kepanitiaan',
        'Keterangan': 'Keterangan',
        'Jenis': 'Jenis',
        'Karakter': 'Karakter'
      };
      return labelMap[col] || col;
    };

    const getFieldValue = (item, col, type) => {
      if (type === 'prestasi') {
        if (col === 'Lomba') return item.nama_lomba;
        if (col === 'Jenis Lomba') return formatDisplayText(item.jenis_lomba || 'akademik');
        if (col === 'Kategori Lomba') return formatDisplayText(item.kategori_lomba || 'individu');
        if (col === 'Juara') return formatDisplayText(item.juara);
        if (col === 'Kategori') return formatDisplayText(item.kategori);
      }
      if (type === 'event') {
        if (col === 'Event') return item.nama_event;
        if (col === 'Tingkat') return formatDisplayText(item.tingkat);
      }
      if (type === 'organisasi') {
        if (col === 'Organisasi') return item.kategori_organisasi;
        if (col === 'Jabatan') return item.jabatan_organisasi;
      }
      if (type === 'kepanitiaan') {
        if (col === 'Kepanitiaan') return item.kategori_kepanitiaan;
        if (col === 'Jabatan') return item.jabatan_kepanitiaan;
      }
      if (type === 'pelanggaran') {
        if (col === 'Keterangan') return item.keterangan;
        if (col === 'Jenis') return item.jenis_pelanggaran;
      }
      return '';
    };

    const renderMobileCard = (item) => {
      const status = getApprovalStatus(item);
      const isPending = status === 'pending';

      return (
        <div key={item.id} style={{
          borderBottom: `1px solid ${BORDER}`,
          padding: '16px',
          animation: 'fadeSlide 0.28s ease'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '10px',
            marginBottom: '10px'
          }}>
            <div>
              <div style={{ fontWeight: '700', fontSize: '15px', color: TEXT }}>{item.nama || item.student_name}</div>
              <div style={{ fontWeight: '500', fontSize: '12.5px', color: MUTED, marginTop: '2px' }}>
                NIS {item.nis || item.nis_lama || '-'} · diajukan oleh {item.user_name || item.requested_by_name || 'Unknown'}
              </div>
              {item._groupSize > 1 && (
                <div style={{ marginTop: '4px' }}>
                  {renderGroupLabel(item)}
                </div>
              )}
            </div>
            {isPending ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '12.5px',
                fontWeight: '700',
                whiteSpace: 'nowrap',
                background: AMBER_BG,
                color: '#a86a05'
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: AMBER,
                  animation: 'blink 1.4s ease-in-out infinite'
                }}></span>
                MENUNGGU
              </span>
            ) : status === 'approved' ? (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '12.5px',
                fontWeight: '700',
                whiteSpace: 'nowrap',
                background: '#e5f7ee',
                color: GREEN_DARK
              }}><StatusIcon status="approved" /> DISETUJUI</span>
            ) : (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '999px',
                fontSize: '12.5px',
                fontWeight: '700',
                whiteSpace: 'nowrap',
                background: '#fdeaea',
                color: RED_DARK
              }}><StatusIcon status="rejected" /> DITOLAK</span>
            )}
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px 14px',
            marginBottom: '12px'
          }}>
            {dataCols.map(col => (
              <div key={col}>
                <div style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.03em',
                  color: MUTED,
                  fontWeight: '700',
                  marginBottom: '2px'
                }}>{getFieldLabel(col)}</div>
                <div style={{ fontSize: '13.5px', color: TEXT }}>{getFieldValue(item, col, type)}</div>
              </div>
            ))}
            {usesApprovalStatus && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{
                  fontSize: '10.5px',
                  textTransform: 'uppercase',
                  letterSpacing: '.03em',
                  color: MUTED,
                  fontWeight: '700',
                  marginBottom: '2px'
                }}>Foto / Dokumen</div>
                <div style={{ fontSize: '13.5px' }}>
                  {getItemPhoto(item, type) ? (
                    <button
                      onClick={() => { setPreviewError(false); setPreviewImage(getItemPhoto(item, type)); }}
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        cursor: 'pointer',
                        color: BLUE,
                        fontWeight: '600',
                        fontSize: '13.5px',
                        fontFamily: 'inherit',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}
                    >
                      <Camera size={14} /> Lihat Bukti
                    </button>
                  ) : (
                    <span style={{ color: MUTED }}>-</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap'
          }}>
            {isPending ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button 
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    color: '#fff',
                    background: GREEN,
                    boxShadow: '0 4px 10px -4px rgba(22,168,117,.5)',
                    transition: 'filter 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease'
                  }}
                  onClick={() => setSelectedItem({ ...item, type })}
                >
                  <StatusIcon status="approved" /> Setuju
                </button>
                <button 
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    fontSize: '13px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    color: '#fff',
                    background: RED,
                    boxShadow: '0 4px 10px -4px rgba(227,72,72,.5)',
                    transition: 'filter 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease'
                  }}
                  onClick={() => setSelectedItem({ ...item, type, action: 'reject' })}
                >
                  <StatusIcon status="rejected" /> Tolak
                </button>
              </div>
            ) : (
              <span style={{ color: MUTED, fontSize: "12.5px" }}>Selesai diproses</span>
            )}
          </div>
        </div>
      );
    };

    return (
      <>
        <style>{`
          @keyframes fadeSlide {
            from { opacity: 0; transform: translateY(6px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes approvalFade {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.25; }
          }
          @media (max-width: 768px) {
            .desktop-table { display: none !important; }
            .mobile-cards { display: block !important; }
          }
          @media (min-width: 769px) {
            .mobile-cards { display: none !important; }
            .desktop-table { display: table !important; }
          }
          /* Photo popup: leave room for the fixed sidebar on desktop
             (280px wide, 240px at <=1024px, in-flow below 769px) */
          .approval-photo-overlay { left: 0; }
          @media (min-width: 769px) and (max-width: 1024px) {
            .approval-photo-overlay { left: 240px; }
          }
          @media (min-width: 1025px) {
            .approval-photo-overlay { left: 280px; }
          }
          @media (max-width: 480px) {
            .mobile-cards .req-fields {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>

        <table className="desktop-table" style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "14px"
        }}>
          <thead>
            <tr>
              {columns[type].map(col => (
                <th key={col} style={{
                  textAlign: "left",
                  textTransform: "uppercase",
                  letterSpacing: ".03em",
                  fontSize: "11.5px",
                  color: MUTED,
                  fontWeight: "700",
                  background: "#f8f9fc",
                  padding: "14px 18px",
                  borderBottom: `1px solid ${BORDER}`,
                  whiteSpace: "nowrap"
                }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayData.map(item => (
              <tr key={item.id} style={{
                transition: "background 0.15s ease"
              }}>
                <td style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${BORDER}`,
                  verticalAlign: "middle",
                  color: MUTED
                }}>{item.user_name || item.requested_by_name || 'Unknown'}</td>
                <td style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${BORDER}`,
                  verticalAlign: "middle",
                  fontWeight: "600",
                  color: TEXT
                }}>{item.nama || item.student_name}
                  {item._groupSize > 1 && (
                    <div style={{ marginTop: '2px' }}>
                      {renderGroupLabel(item)}
                    </div>
                  )}</td>
                <td style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${BORDER}`,
                  verticalAlign: "middle",
                  color: TEXT
                }}>{item.nis || item.nis_lama || item.student_nis}</td>
                {type === 'prestasi' && (
                  <>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.nama_lomba}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{formatDisplayText(item.jenis_lomba || 'akademik')}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{formatDisplayText(item.kategori_lomba || 'individu')}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{formatDisplayText(item.juara)}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{formatDisplayText(item.kategori)}</td>
                  </>
                )}
                {type === 'event' && (
                  <>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.nama_event}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{formatDisplayText(item.tingkat)}</td>
                  </>
                )}
                {type === 'organisasi' && (
                  <>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.kategori_organisasi}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.jabatan_organisasi}</td>
                  </>
                )}
                {type === 'kepanitiaan' && (
                  <>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.kategori_kepanitiaan}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.jabatan_kepanitiaan}</td>
                  </>
                )}
                {type === 'pelanggaran' && (
                  <>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.keterangan}</td>
                    <td style={{
                      padding: "16px 18px",
                      borderBottom: `1px solid ${BORDER}`,
                      verticalAlign: "middle",
                      color: TEXT
                    }}>{item.jenis_pelanggaran}</td>
                  </>
                )}
                {usesApprovalStatus && (
                  <td style={{
                    padding: "16px 18px",
                    borderBottom: `1px solid ${BORDER}`,
                    verticalAlign: "middle"
                  }}>
                    {getItemPhoto(item, type) ? (
                      <div>
                        {isPdfPath(getItemPhoto(item, type)) ? (
                          <EvidenceFileThumb
                            size={60}
                            onOpen={() => { setPreviewError(false); setPreviewImage(getItemPhoto(item, type)); }}
                          />
                        ) : (
                        <img
                          src={getItemPhoto(item, type)}
                          alt="Bukti"
                          style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '5px', cursor: 'pointer' }}
                          onClick={() => { setPreviewError(false); setPreviewImage(getItemPhoto(item, type)); }}
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.insertAdjacentHTML('afterend', '<span style="color:#6b7280;font-size:12.5px">Bukti tidak ditemukan</span>');
                          }}
                          title="Klik untuk memperbesar"
                        />
                        )}
                      </div>
                    ) : (
                      <span style={{ color: MUTED }}>-</span>
                    )}
                  </td>
                )}
                {usesApprovalStatus && (
                  <td style={{
                    padding: "16px 18px",
                    borderBottom: `1px solid ${BORDER}`,
                    verticalAlign: "middle"
                  }}>
                    {getApprovalStatus(item) === 'pending' ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        fontSize: '12.5px',
                        fontWeight: '700',
                        whiteSpace: 'nowrap',
                        background: AMBER_BG,
                        color: '#a86a05'
                      }}>
                        <span style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: AMBER,
                          animation: 'blink 1.4s ease-in-out infinite'
                        }}></span>
                        MENUNGGU
                      </span>
                    ) : getApprovalStatus(item) === 'approved' ? (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        fontSize: '12.5px',
                        fontWeight: '700',
                        whiteSpace: 'nowrap',
                        background: '#e5f7ee',
                        color: GREEN_DARK
                      }}><StatusIcon status="approved" /> DISETUJUI</span>
                    ) : (
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '6px 12px',
                        borderRadius: '999px',
                        fontSize: '12.5px',
                        fontWeight: '700',
                        whiteSpace: 'nowrap',
                        background: '#fdeaea',
                        color: RED_DARK
                      }}><StatusIcon status="rejected" /> DITOLAK</span>
                    )}
                  </td>
                )}
                <td style={{
                  padding: "16px 18px",
                  borderBottom: `1px solid ${BORDER}`,
                  verticalAlign: "middle"
                }}>
                  {getApprovalStatus(item) === 'approved' ? (
                    <span style={{ color: MUTED, fontSize: "12.5px" }}>Selesai diproses</span>
                  ) : getApprovalStatus(item) === 'rejected' ? (
                    <span style={{ color: MUTED, fontSize: "12.5px" }}>Selesai diproses</span>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button 
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontSize: '13px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          color: '#fff',
                          background: GREEN,
                          boxShadow: '0 4px 10px -4px rgba(22,168,117,.5)',
                          transition: 'filter 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                        onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        onClick={() => setSelectedItem({ ...item, type })} 
                      >
                        <StatusIcon status="approved" /> Setuju
                      </button>
                      <button 
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: 'none',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontSize: '13px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          color: '#fff',
                          background: RED,
                          boxShadow: '0 4px 10px -4px rgba(227,72,72,.5)',
                          transition: 'filter 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                        onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        onClick={() => setSelectedItem({ ...item, type, action: 'reject' })} 
                      >
                        <StatusIcon status="rejected" /> Tolak
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mobile-cards">
          {displayData.map(item => renderMobileCard(item))}
        </div>
      </>
    );
  };

  if (loading) {
    return (
      <div style={{
        fontFamily: "var(--font-sans)",
        background: PAGE_BG,
        padding: "4px 4px 40px"
      }}>
        <div className="inline-loading"><div className="spinner" style={{ margin: '0 auto 12px' }}></div><strong>Memuat data...</strong></div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div style={{
        fontFamily: "var(--font-sans)",
        background: PAGE_BG,
        padding: "4px 4px 40px"
      }}>
        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <h2 style={{ margin: '0 0 8px' }}>Akses Ditolak</h2>
          <p style={{ color: MUTED, margin: 0 }}>Anda tidak memiliki Izin Approval. Silakan hubungi SuperAdmin.</p>
        </div>
      </div>
    );
  }

  // Backend omits types outside the caller's approval scopes, so tabs
  // automatically match what this user may approve. Superadmin sees all.
  const tabs = [
    { key: 'prestasi', label: 'Prestasi' },
    { key: 'event', label: 'Event' },
    { key: 'organisasi', label: 'Organisasi' },
    { key: 'kepanitiaan', label: 'Kepanitiaan' },
    { key: 'pelanggaran', label: 'Pelanggaran' },
  ]
    .filter((t) => approvals[t.key] !== undefined)
    .map((t) => ({ ...t, count: approvals[t.key]?.length || 0 }));
  const effectiveTab = tabs.some((t) => t.key === activeTab) ? activeTab : (tabs[0]?.key || 'prestasi');

  return (
    <div style={{
      fontFamily: "var(--font-sans)",
      background: PAGE_BG,
      padding: "4px 4px 40px"
    }}>
      <h1 style={{
        fontSize: "26px",
        fontWeight: "700",
        margin: "4px 0 20px",
        letterSpacing: "-0.01em",
        color: TEXT
      }}>Approvals</h1>

      {message && (
        <div style={{
          background: message.includes('disetujui') ? '#e5f7ee' : message.includes('ditolak') ? '#fdeaea' : '#e8f0fe',
          color: message.includes('disetujui') ? GREEN_DARK : message.includes('ditolak') ? RED_DARK : BLUE_DARK,
          padding: "12px 18px",
          borderRadius: "10px",
          marginBottom: "18px",
          fontSize: "13.5px",
          fontWeight: "600"
        }}>{message}</div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '18px' }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '11px 18px',
              borderRadius: '10px',
              border: `1px solid ${effectiveTab === tab.key ? BLUE : BORDER}`,
              background: effectiveTab === tab.key ? BLUE : '#eceff3',
              color: effectiveTab === tab.key ? '#fff' : TEXT,
              fontSize: '14.5px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background 0.18s ease, color 0.18s ease, transform 0.12s ease, box-shadow 0.18s ease',
              userSelect: 'none',
              boxShadow: effectiveTab === tab.key ? '0 6px 16px -6px rgba(47,95,232,.55)' : 'none'
            }}
            onMouseEnter={(e) => {
              if (effectiveTab !== tab.key) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 10px -4px rgba(20,25,40,.18)';
              }
            }}
            onMouseLeave={(e) => {
              if (effectiveTab !== tab.key) {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '20px',
                height: '20px',
                padding: '0 6px',
                borderRadius: '999px',
                background: RED,
                color: '#fff',
                fontSize: '12px',
                fontWeight: '700'
              }}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      <div style={{
        background: CARD,
        border: `1px solid ${BORDER}`,
        borderRadius: RADIUS,
        boxShadow: '0 1px 2px rgba(20,25,40,.04), 0 8px 24px -12px rgba(20,25,40,.10)',
        overflow: 'hidden'
      }}>
        {renderTable(approvals[effectiveTab] || [], effectiveTab)}
      </div>

      {selectedItem && (
        <div className="app-modal-overlay" style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1500,
          animation: 'approvalFade 0.2s ease'
        }}>
          <div className="modal-sheet" style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            borderRadius: RADIUS,
            boxShadow: '0 12px 30px -10px rgba(0,0,0,.4)',
            padding: '24px',
            animation: 'fadeSlide 0.28s ease'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '700',
              margin: '0 0 16px',
              color: TEXT
            }}>
              {selectedItem.action === 'reject' ? 'Tolak Pengajuan' : 'Setujui Pengajuan'}
            </h3>
            {selectedItem._groupSize > 1 && (
              <div className="alert alert-warning" style={{ marginBottom: '16px' }}>
                Pengajuan kelompok — keputusan ini berlaku untuk {selectedItem._groupSize} siswa.
              </div>
            )}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                color: TEXT,
                marginBottom: '8px'
              }}>Catatan:</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Tambahkan catatan (opsional)"
                rows="3"
                style={{
                  width: '100%',
                  padding: '12px',
                  border: `1px solid ${BORDER}`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.15s ease'
                }}
                onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
                onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              {selectedItem.action === 'reject' ? (
                <button
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    color: '#fff',
                    background: RED,
                    boxShadow: '0 4px 10px -4px rgba(227,72,72,.5)',
                    transition: 'filter 0.15s ease, transform 0.1s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                  onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onClick={() => handleReject(selectedItem.type, selectedItem.id)}
                >
                  <StatusIcon status="rejected" /> Tolak
                </button>
              ) : (
                <button
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    color: '#fff',
                    background: GREEN,
                    boxShadow: '0 4px 10px -4px rgba(22,168,117,.5)',
                    transition: 'filter 0.15s ease, transform 0.1s ease'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                  onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                  onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                  onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  onClick={() => handleApprove(selectedItem.type, selectedItem.id)}
                >
                  <StatusIcon status="approved" /> Setuju
                </button>
              )}
              <button 
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: `1px solid ${BORDER}`,
                  borderRadius: '8px',
                  padding: '10px 18px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  color: TEXT,
                  background: '#eceff3',
                  transition: 'filter 0.15s ease, transform 0.1s ease'
                }}
                onMouseEnter={(e) => e.currentTarget.style.filter = 'brightness(1.06)'}
                onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
                onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onClick={() => { setSelectedItem(null); setNotes(''); }}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
      {groupPopup && (
        <div
          className="app-modal-overlay"
          onClick={() => setGroupPopup(null)}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1500,
            animation: 'approvalFade 0.2s ease'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: RADIUS,
              boxShadow: '0 12px 30px -10px rgba(0,0,0,.4)',
              width: '440px',
              maxWidth: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: '24px',
              animation: 'fadeSlide 0.28s ease'
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 4px', color: TEXT }}>
              Anggota Kelompok
            </h3>
            <p style={{ fontSize: '13px', color: MUTED, margin: '0 0 16px' }}>
              {groupPopup.nama_lomba} · {groupPopup._groupSize} siswa
            </p>
            <div>
              {(groupPopup._members || []).map((m, i) => (
                <div
                  key={`${m.nis}-${i}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '10px 0',
                    borderBottom: i < groupPopup._members.length - 1 ? `1px solid ${BORDER}` : 'none',
                    fontSize: '14px'
                  }}
                >
                  <span style={{ fontWeight: '600', color: TEXT }}>{i + 1}. {m.nama}</span>
                  <span style={{ color: MUTED, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {m.nis}
                    <span style={{ display: 'block', fontSize: '12px' }}>{m.kelas || '-'}</span>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  border: `1px solid ${BORDER}`,
                  borderRadius: '8px',
                  padding: '10px 18px',
                  fontSize: '14px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  color: TEXT,
                  background: '#eceff3'
                }}
                onClick={() => setGroupPopup(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
      {previewImage && (
        <div
          className="approval-photo-overlay"
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1100,
            cursor: 'pointer',
            animation: 'approvalFade 0.2s ease'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              position: 'relative',
              cursor: 'default'
            }}
          >
            {isPdfPath(previewImage) ? (
              <div style={{ width: 'min(880px, 90vw)' }}>
                <EvidenceViewer src={previewImage} alt="Bukti" pdfHeight="70vh" />
              </div>
            ) : !previewError ? (
              <img
                src={previewImage}
                alt="Bukti"
                style={{
                  maxWidth: '100%',
                  maxHeight: '90vh',
                  borderRadius: '8px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                }}
                onError={() => setPreviewError(true)}
              />
            ) : (
              <div style={{
                background: CARD,
                borderRadius: '8px',
                padding: '24px 32px',
                color: TEXT,
                fontSize: '14px',
                fontWeight: '600'
              }}>
                Bukti tidak dapat dimuat
              </div>
            )}
            <button
              onClick={() => setPreviewImage(null)}
              style={{
                position: 'absolute',
                top: '-40px',
                right: 0,
                background: 'white',
                color: 'black',
                border: 'none',
                borderRadius: '50%',
                width: '32px',
                height: '32px',
                fontSize: '20px',
                lineHeight: '32px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Approvals;
