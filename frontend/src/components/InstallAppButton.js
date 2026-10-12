import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, X } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

// Install button with three states:
// - Chromium with a pending install prompt: triggers it directly.
// - iOS (no prompt API exists): opens step-by-step instructions for
//   Share > Add to Home Screen.
// - Otherwise (or already installed): renders nothing.
function InstallAppButton({ variant = 'primary' }) {
  const { canInstall, install, isIos, isInstalled } = usePwaInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (isInstalled) return null;

  const openIosHelp = () => setShowIosHelp(true);
  const closeIosHelp = () => setShowIosHelp(false);

  const handleClick = () => {
    if (canInstall) {
      install();
    } else if (isIos) {
      openIosHelp();
    }
  };

  if (!canInstall && !isIos) return null;

  const buttonStyle = variant === 'sidebar'
    ? {
      width: '100%',
      padding: '14px 16px',
      border: 'none',
      background: 'transparent',
      color: 'rgba(255, 255, 255, 0.7)',
      textAlign: 'left',
      cursor: 'pointer',
      fontSize: '0.875rem',
      fontWeight: '500',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    }
    : {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: '#28396b',
      fontWeight: '600',
      fontSize: '.85rem',
      textDecoration: 'none',
      fontFamily: 'inherit',
      padding: 0
    };

  const steps = [
    {
      title: 'Ketuk tombol Bagikan',
      desc: 'Ketuk ikon Bagikan (kotak dengan panah ke atas) di bilah Safari.'
    },
    {
      title: 'Pilih Add to Home Screen',
      desc: 'Gulir menu ke bawah, lalu ketuk "Add to Home Screen" (Tambah ke Layar Utama).'
    },
    {
      title: 'Ketuk Add',
      desc: 'Ketuk "Add" di kanan atas untuk memasang aplikasi di layar utama.'
    }
  ];

  return (
    <>
      <button onClick={handleClick} type="button" style={buttonStyle}>
        {isIos && !canInstall ? <Share size={variant === 'sidebar' ? 16 : 14} /> : <Download size={variant === 'sidebar' ? 16 : 14} />}
        Install App
      </button>

      {showIosHelp && typeof document !== 'undefined' && createPortal(
        <div
          className="app-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1500,
            padding: '20px'
          }}
          onClick={(e) => { if (e.target === e.currentTarget) closeIosHelp(); }}
        >
          <div className="card" style={{ width: 420, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>Install di iPhone/iPad</h3>
              <button
                onClick={closeIosHelp}
                aria-label="Tutup"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#666', padding: '4px' }}
              >
                <X size={18} />
              </button>
            </div>
            <p style={{ fontSize: '13px', color: '#666', margin: '0 0 14px' }}>
              iOS tidak menyediakan tombol install otomatis. Ikuti langkah ini di Safari:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              {steps.map((step, i) => (
                <div key={step.title} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: '6px', padding: '10px 12px' }}>
                  <span style={{
                    flexShrink: 0, width: '24px', height: '24px', borderRadius: '50%',
                    background: 'var(--blue)', color: 'white', fontSize: '12px', fontWeight: '700',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#333' }}>{step.title}</div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{step.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={closeIosHelp} style={{ width: '100%' }}>
              Mengerti
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default InstallAppButton;
