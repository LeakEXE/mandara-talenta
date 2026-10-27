import React, { useEffect } from 'react';
import { formatDisplayText, formatTanggalLomba } from '../utils/formatDisplayText';
import { evidenceItemsForRecord } from '../utils/evidence';
import { getRecordPhotoUrl } from '../utils/recordPhoto';
import { EvidenceViewer } from './EvidenceViewer';

function DetailField({ label, value }) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '9px 0',
            borderBottom: '1px solid #e5e7eb'
        }}>
            <span style={{ color: '#64748b', flexShrink: 0 }}>{label}</span>
            <span style={{ color: '#111827', fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere' }}>
                {value || '-'}
            </span>
        </div>
    );
}

function GroupSubmissionDetailsModal({ group, onClose }) {
    useEffect(() => {
        if (!group) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [group, onClose]);

    if (!group?.members?.length) return null;

    const first = group.members[0];
    const pembina = (first.pembina_list?.length ? first.pembina_list : [first.pembina])
        .filter(Boolean)
        .join(', ') || '-';
    const evidence = [...new Map(
        group.members
            .flatMap(evidenceItemsForRecord)
            .filter((item) => item.path)
            .map((item) => [item.path, item])
    ).values()];
    const statuses = [...new Set(group.members.map((member) => member.status).filter(Boolean))];

    return (
        <div
            className="app-modal-overlay"
            role="presentation"
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                background: 'rgba(0, 0, 0, .5)'
            }}
        >
            <section
                className="modal-sheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="group-submission-details-title"
                style={{
                    width: 'min(680px, 100%)',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    padding: '20px',
                    borderRadius: '12px',
                    background: '#fff',
                    boxShadow: '0 12px 32px rgba(0, 0, 0, .2)'
                }}
            >
                <header style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    marginBottom: '12px'
                }}>
                    <h3 id="group-submission-details-title" style={{ margin: 0 }}>
                        Detail Pengajuan Kelompok
                    </h3>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>
                        Tutup
                    </button>
                </header>

                <h4 style={{ margin: '12px 0 4px' }}>{first.nama_lomba || '-'}</h4>
                <DetailField label="Jenis lomba" value={formatDisplayText(first.jenis_lomba || 'akademik')} />
                <DetailField label="Kategori prestasi" value={formatDisplayText(first.kategori_lomba || 'kelompok')} />
                <DetailField label="Juara" value={formatDisplayText(first.juara)} />
                <DetailField label="Tingkat lomba" value={formatDisplayText(first.kategori)} />
                <DetailField label="Pembina" value={pembina} />
                <DetailField label="Tanggal pelaksanaan" value={formatTanggalLomba(first.tanggal_pelaksanaan)} />
                <DetailField
                    label="Tanggal pengajuan"
                    value={first.created_at
                        ? new Date(first.created_at).toLocaleString('id-ID')
                        : '-'}
                />
                <DetailField
                    label="Status"
                    value={statuses.map((status) => formatDisplayText(status)).join(', ') || '-'}
                />

                <h4 style={{ margin: '20px 0 8px' }}>Anggota kelompok</h4>
                <div style={{ display: 'grid', gap: '8px' }}>
                    {group.members.map((member) => (
                        <div
                            key={member.id || member.nis}
                            style={{
                                padding: '10px 12px',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px'
                            }}
                        >
                            <strong>{member.nama || '-'}</strong>
                            <div style={{ marginTop: '3px', color: '#64748b', fontSize: '13px' }}>
                                NIS {member.nis || '-'} | Kelas {member.kelas || '-'} | Grha {member.grha || '-'}
                            </div>
                        </div>
                    ))}
                </div>

                <h4 style={{ margin: '20px 0 8px' }}>Bukti</h4>
                {evidence.length === 0 ? (
                    <p style={{ color: '#64748b' }}>Tidak ada bukti yang terlampir.</p>
                ) : (
                    <div style={{ display: 'grid', gap: '12px' }}>
                        {evidence.map((item, index) => {
                            const src = getRecordPhotoUrl(item.path, 'prestasi');
                            return (
                                <div key={item.id || item.path} style={{
                                    padding: '10px',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px'
                                }}>
                                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#475569', overflowWrap: 'anywhere' }}>
                                        Bukti {index + 1}: {item.path.split(/[\\/]/).pop()}
                                    </p>
                                    <EvidenceViewer
                                        src={src}
                                        alt={`Bukti pengajuan ${index + 1}`}
                                        pdfHeight="55vh"
                                        imgStyle={{
                                            display: 'block',
                                            maxWidth: '100%',
                                            maxHeight: '55vh',
                                            margin: '0 auto',
                                            objectFit: 'contain'
                                        }}
                                    />
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
}

export default GroupSubmissionDetailsModal;
