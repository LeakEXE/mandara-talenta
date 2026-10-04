import React from 'react';
import { EvidenceViewer } from './EvidenceViewer';

const EditModal = ({ isOpen, title, onClose, onSave, isLoading, children, photoPreview }) => {
    if (!isOpen) return null;

    return (
        <div className="app-modal-overlay" style={{
            position: 'fixed',
            top: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000
        }}>
            <div className="edit-modal-content modal-sheet" style={{
                maxHeight: '90vh',
                overflowY: 'auto',
                backgroundColor: 'white',
                borderRadius: '8px',
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
                padding: '24px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0 }}>{title}</h3>
                    <button 
                        className="btn btn-danger" 
                        onClick={onClose}
                        style={{ padding: '4px 12px', fontSize: '12px' }}
                    >
                        ✕
                    </button>
                </div>

                {photoPreview && (
                    <div style={{ marginBottom: '16px', textAlign: 'center' }}>
                        <p style={{ fontSize: '12px', color: '#666', marginBottom: '8px' }}>Bukti Saat Ini:</p>
                        <EvidenceViewer
                            src={photoPreview}
                            alt="bukti"
                            pdfHeight={300}
                            imgStyle={{
                                maxWidth: '100%',
                                maxHeight: '200px',
                                borderRadius: '4px',
                                border: '1px solid #ddd',
                                padding: '4px'
                            }}
                        />
                    </div>
                )}

                <div style={{ maxHeight: '60vh', overflowY: 'auto', marginBottom: '16px' }}>
                    {children}
                </div>

                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button 
                        className="btn btn-secondary" 
                        onClick={onClose}
                        disabled={isLoading}
                        style={{ padding: '6px 16px' }}
                    >
                        Tutup
                    </button>
                    <button 
                        className="btn btn-primary" 
                        onClick={onSave}
                        disabled={isLoading}
                        style={{ padding: '6px 16px' }}
                    >
                        {isLoading ? 'Menyimpan...' : 'Simpan'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditModal;
