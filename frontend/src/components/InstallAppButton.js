import React from 'react';
import { Download } from 'lucide-react';
import { usePwaInstall } from '../hooks/usePwaInstall';

// Renders nothing unless the browser offers PWA installation.
function InstallAppButton({ variant = 'primary' }) {
  const { canInstall, install } = usePwaInstall();
  if (!canInstall) return null;

  if (variant === 'sidebar') {
    return (
      <button
        onClick={install}
        style={{
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
        }}
      >
        <Download size={16} /> Install App
      </button>
    );
  }

  return (
    <button
      onClick={install}
      type="button"
      style={{
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
      }}
    >
      <Download size={14} /> Install App
    </button>
  );
}

export default InstallAppButton;
