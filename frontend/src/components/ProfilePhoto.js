import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

function ProfilePhoto({ src, alt, imageStyle, onError, title }) {
  const [isOpen, setIsOpen] = useState(false);
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const trigger = document.activeElement;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [isOpen]);

  if (!src) return null;

  return (
    <>
      <button
        ref={closeButtonRef}
        type="button"
        aria-label={`Perbesar foto ${alt || 'profil'}`}
        title={title || 'Klik untuk memperbesar foto'}
        onClick={() => setIsOpen(true)}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          padding: 0,
          border: 0,
          borderRadius: 'inherit',
          overflow: 'hidden',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          cursor: 'zoom-in'
        }}
      >
        <img
          src={src}
          alt={alt || 'Foto profil'}
          onError={onError}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            ...imageStyle
          }}
        />
      </button>

      {isOpen && createPortal(
        <div
          className="app-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            background: 'rgba(0, 0, 0, .8)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Foto profil ${alt || ''}`.trim()}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              maxWidth: '100%',
              maxHeight: '100%'
            }}
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Tutup foto"
              style={{
                position: 'absolute',
                zIndex: 1,
                top: '8px',
                right: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '40px',
                height: '40px',
                border: 0,
                borderRadius: '50%',
                background: 'rgba(0, 0, 0, .65)',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              <X size={22} />
            </button>
            <img
              src={src}
              alt={alt || 'Foto profil'}
              style={{
                display: 'block',
                maxWidth: 'min(92vw, 1200px)',
                maxHeight: '88vh',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                borderRadius: '8px'
              }}
            />
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

export default ProfilePhoto;
