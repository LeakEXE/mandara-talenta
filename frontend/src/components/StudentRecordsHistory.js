import React, { useState } from 'react';
import { getRecordPhotoUrl } from '../utils/recordPhoto';
import { toTitleCase } from '../utils/perilaku';
import { formatDisplayText, formatTanggalLomba } from '../utils/formatDisplayText';
import { FileText } from 'lucide-react';
import { isPdfPath } from './EvidenceViewer';

const TABS = [
    { key: 'prestasi', label: 'Prestasi' },
    { key: 'event', label: 'Event' },
    { key: 'organisasi', label: 'Organisasi' },
    { key: 'kepanitiaan', label: 'Kepanitiaan' },
    { key: 'pelanggaran', label: 'Pelanggaran' },
    { key: 'perilaku', label: 'Perilaku' }
];

function RecordThumbnail({ path, type, alt }) {
    const url = getRecordPhotoUrl(path, type);

    if (!url) {
        return (
            <div style={{
                width: 72,
                height: 72,
                borderRadius: 8,
                background: 'var(--bg-tertiary, #f0f0f0)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 24,
                flexShrink: 0,
                color: 'var(--slate, #64748b)'
            }}>
                <FileText size={28} />
            </div>
        );
    }

    if (isPdfPath(url)) {
        return (
            <div
                style={{
                    width: 72,
                    height: 72,
                    borderRadius: 8,
                    background: 'var(--danger-bg)',
                    color: 'var(--danger-dark)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    flexShrink: 0,
                    border: '1px solid #ddd',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 800
                }}
                onClick={() => window.open(url, '_blank')}
                title="Buka dokumen PDF"
            >
                <FileText size={26} />
                <span>PDF</span>
            </div>
        );
    }

    return (
        <img
            src={url}
            alt={alt}
            style={{
                width: 72,
                height: 72,
                objectFit: 'cover',
                borderRadius: 8,
                cursor: 'pointer',
                flexShrink: 0,
                border: '1px solid #ddd'
            }}
            onClick={() => window.open(url, '_blank')}
            title="Klik untuk memperbesar"
        />
    );
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function renderRecordDetails(item, type) {
    switch (type) {
        case 'prestasi':
            return (
                <>
                    <strong>{item.nama_lomba}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        {formatDisplayText(item.juara)} · {formatDisplayText(item.kategori)}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        Tgl Pelaksanaan: {formatTanggalLomba(item.tanggal_pelaksanaan)}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-success">+{item.point} poin</span>
                    </div>
                </>
            );
        case 'event':
            return (
                <>
                    <strong>{item.nama_event}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        Tingkat: {formatDisplayText(item.tingkat)}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-success">+{item.point} poin</span>
                    </div>
                </>
            );
        case 'organisasi':
            return (
                <>
                    <strong>{item.kategori_organisasi}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        Jabatan: {item.jabatan_organisasi}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-success">+{item.point} poin</span>
                    </div>
                </>
            );
        case 'kepanitiaan':
            return (
                <>
                    <strong>{item.kategori_kepanitiaan}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        Jabatan: {item.jabatan_kepanitiaan}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-success">+{item.point} poin</span>
                    </div>
                </>
            );
        case 'pelanggaran':
            return (
                <>
                    <strong>{formatDisplayText(item.keterangan)}</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        Jenis: {item.jenis_pelanggaran}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-danger">{item.point_dikurangi} poin</span>
                    </div>
                </>
            );
        case 'perilaku':
            return (
                <>
                    <strong>Perilaku Positif</strong>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary, #666)', marginTop: 4 }}>
                        {toTitleCase(item.karakter_siswa)}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                        <span className="badge badge-success">+{item.point} poin</span>
                    </div>
                </>
            );
        default:
            return null;
    }
}

function StudentRecordsHistory({ records, title = 'Riwayat Prestasi & Event', showAllTabs = true }) {
    const [activeTab, setActiveTab] = useState('prestasi');

    if (!records) {
        return null;
    }

    const visibleTabs = showAllTabs
        ? TABS
        : TABS.filter((tab) => ['prestasi', 'event', 'organisasi', 'kepanitiaan'].includes(tab.key));

    const activeItems = records[activeTab] || [];

    return (
        <div className="card" style={{ marginBottom: 24 }}>
            <h3>{title}</h3>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {visibleTabs.map((tab) => {
                    const count = records[tab.key]?.length || 0;
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            className={`btn ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setActiveTab(tab.key)}
                            style={{ fontSize: 13 }}
                        >
                            {tab.label}
                            {count > 0 && (
                                <span className="badge badge-light" style={{ marginLeft: 6 }}>
                                    {count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {activeItems.length === 0 ? (
                <p className="text-muted">Belum ada data {visibleTabs.find((t) => t.key === activeTab)?.label?.toLowerCase()} yang disetujui.</p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activeItems.map((item) => (
                        <div
                            key={item.id}
                            style={{
                                display: 'flex',
                                gap: 14,
                                padding: 12,
                                border: '1px solid #e0e0e0',
                                borderRadius: 8,
                                alignItems: 'flex-start'
                            }}
                        >
                            {activeTab !== 'perilaku' && (
                                <RecordThumbnail
                                    path={item.foto || item.foto_path}
                                    type={activeTab}
                                    alt="Bukti"
                                />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                {renderRecordDetails(item, activeTab)}
                                <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                                    {formatDate(item.created_at)}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default StudentRecordsHistory;
