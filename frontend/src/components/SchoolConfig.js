import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { Lock } from 'lucide-react';

const buildAssetUrl = (path) => {
  if (!path) return null;
  const base = API_BASE_URL.replace('/api', '');
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`;
};

function SchoolConfig() {
  const [config, setConfig] = useState({
    school_name: '',
    school_description: '',
    principal_name: '',
    principal_nip: '',
    support_link: '',
    logo_url: null
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [user, setUser] = useState(null);
  const mountedRef = useRef(true);

  // Shared UI tokens (see index.css :root)
  const BG = 'var(--bg-secondary)';
  const CARD = 'var(--bg-primary)';
  const BORDER = 'var(--border-color)';
  const TEXT = 'var(--ink)';
  const MUTED = 'var(--slate)';
  const BLUE = 'var(--blue)';
  const RADIUS = 'var(--card-radius)';
  const SHADOW = 'var(--shadow-card)';

  useEffect(() => {
    mountedRef.current = true;
    const userData = localStorage.getItem('user');
    if (userData) {
      setUser(JSON.parse(userData));
    }
    fetchConfig();
    return () => { mountedRef.current = false; };
  }, []);

  const fetchConfig = async () => {
    try {
      const response = await api.get('/school-config');
      if (mountedRef.current) {
        setConfig(response.data);
      }
    } catch (error) {
      if (mountedRef.current) {
        setMessage({ type: 'error', text: 'Gagal memuat konfigurasi sekolah' });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  };

  const validateConfig = () => {
    if (!config.school_name.trim()) {
      setMessage({ type: 'error', text: 'Nama sekolah wajib diisi' });
      return false;
    }
    if (!config.principal_name.trim()) {
      setMessage({ type: 'error', text: 'Nama kepala sekolah wajib diisi' });
      return false;
    }
    if (!config.principal_nip.trim()) {
      setMessage({ type: 'error', text: 'NIP kepala sekolah wajib diisi' });
      return false;
    }
    if (config.support_link && !/^https?:\/\//i.test(config.support_link.trim())) {
      setMessage({ type: 'error', text: 'Link bantuan harus diawali http:// atau https://' });
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateConfig()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.put('/school-config', { ...config, support_link: (config.support_link || '').trim() });
      if (mountedRef.current) {
        await fetchConfig();
        setMessage({ type: 'success', text: 'Konfigurasi sekolah berhasil disimpan!' });
      }
    } catch (error) {
      if (mountedRef.current) {
        const errorText = error.response?.data?.error || 'Gagal menyimpan konfigurasi sekolah';
        setMessage({ type: 'error', text: errorText });
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  };

  const validateLogoFile = (file) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    const maxSize = 2 * 1024 * 1024; // 2MB
    
    if (!allowedTypes.includes(file.type)) {
      return 'Hanya file JPEG dan PNG yang diizinkan';
    }
    if (file.size > maxSize) {
      return 'Ukuran file maksimal 2MB';
    }
    return null;
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const validationError = validateLogoFile(file);
    if (validationError) {
      setMessage({ type: 'error', text: validationError });
      e.target.value = '';
      return;
    }

    const formData = new FormData();
    formData.append('logo', file);

    setUploading(true);
    setMessage(null);
    try {
      await api.post('/school-config/upload-logo', formData);
      if (mountedRef.current) {
        await fetchConfig();
        setMessage({ type: 'success', text: 'Logo berhasil diupload!' });
      }
    } catch (error) {
      if (mountedRef.current) {
        const errorText = error.response?.data?.error || 'Gagal mengupload logo';
        setMessage({ type: 'error', text: errorText });
      }
    } finally {
      if (mountedRef.current) {
        setUploading(false);
        e.target.value = '';
      }
    }
  };

  if (loading) {
    return (
      <div style={{
        fontFamily: "var(--font-sans)",
        background: BG,
        padding: "4px 4px 40px"
      }}>
        <div className="inline-loading"><div className="spinner" style={{ margin: '0 auto 12px' }}></div><strong>Memuat konfigurasi...</strong></div>
      </div>
    );
  }

  if (user?.role !== 'superadmin') {
    return (
      <div style={{
        fontFamily: "var(--font-sans)",
        background: BG,
        padding: "4px 4px 40px"
      }}>
        <div className="inline-loading">
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '10px', color: 'var(--slate)' }}><Lock size={34} /></div>
          <strong>Akses Ditolak</strong>
          <p style={{ marginTop: "10px" }}>Hanya Super Admin yang dapat mengakses halaman ini.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      fontFamily: "var(--font-sans)",
      background: BG,
      padding: "4px 4px 40px"
    }}>
      <div style={{
        marginBottom: '24px'
      }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: '800',
          margin: '0 0 4px',
          letterSpacing: '-0.01em',
          color: TEXT
        }}>Konfigurasi Sekolah</h1>
        <p style={{ color: MUTED, fontSize: '14px', margin: '0' }}>Kelola informasi sekolah dan kepala sekolah</p>
      </div>

      {message && (
        <div style={{
          background: message.type === 'success' ? '#d4edda' : '#f8d7da',
          border: `1px solid ${message.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
          borderRadius: '12px',
          padding: '14px 18px',
          marginBottom: '20px',
          color: message.type === 'success' ? '#155724' : '#721c24',
          fontSize: '14px',
          fontWeight: '600'
        }}>
          {message.text}
        </div>
      )}

      <div className="school-config-grid" style={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '20px',
        maxWidth: '720px'
      }}>
        {/* School Info Card */}
        <div style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          boxShadow: SHADOW,
          padding: '24px'
        }}>
          <h3 style={{
            fontSize: '16px',
            margin: '0 0 20px',
            fontWeight: '700',
            color: TEXT
          }}>Informasi Sekolah</h3>
          
          <div style={{ marginBottom: '18px' }}>
            <label htmlFor="school-name" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: TEXT,
              marginBottom: '6px'
            }}>Nama Sekolah</label>
            <input
              id="school-name"
              type="text"
              value={config.school_name}
              onChange={(e) => setConfig({ ...config, school_name: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                border: `1px solid ${BORDER}`,
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
              onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label htmlFor="school-description" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: TEXT,
              marginBottom: '6px'
            }}>Deskripsi Sekolah</label>
            <textarea
              id="school-description"
              value={config.school_description}
              onChange={(e) => setConfig({ ...config, school_description: e.target.value })}
              rows={3}
              style={{
                width: '100%',
                padding: '10px 14px',
                border: `1px solid ${BORDER}`,
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.15s ease',
                resize: 'vertical'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
              onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
            />
          </div>

          <div style={{ marginBottom: 0 }}>
            <label htmlFor="support-link" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: TEXT,
              marginBottom: '6px'
            }}>Link Bantuan</label>
            <input
              id="support-link"
              type="url"
              value={config.support_link || ''}
              onChange={(e) => setConfig({ ...config, support_link: e.target.value })}
              placeholder="https://chat.whatsapp.com/..."
              style={{
                width: '100%',
                padding: '10px 14px',
                border: `1px solid ${BORDER}`,
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
              onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
            />
            <div style={{ fontSize: '12px', color: MUTED, marginTop: '6px' }}>
              Ditampilkan di halaman login pada teks "Butuh bantuan? Hubungi admin sekolah". Biarkan kosong untuk memakai link default.
            </div>
          </div>
        </div>

        {/* Principal Info Card */}
        <div style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          boxShadow: SHADOW,
          padding: '24px'
        }}>
          <h3 style={{
            fontSize: '16px',
            margin: '0 0 20px',
            fontWeight: '700',
            color: TEXT
          }}>Informasi Kepala Sekolah</h3>
          
          <div style={{ marginBottom: '18px' }}>
            <label htmlFor="principal-name" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: TEXT,
              marginBottom: '6px'
            }}>Nama Kepala Sekolah</label>
            <input
              id="principal-name"
              type="text"
              value={config.principal_name}
              onChange={(e) => setConfig({ ...config, principal_name: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                border: `1px solid ${BORDER}`,
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
              onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
            />
          </div>

          <div style={{ marginBottom: '18px' }}>
            <label htmlFor="principal-nip" style={{
              display: 'block',
              fontSize: '13px',
              fontWeight: '600',
              color: TEXT,
              marginBottom: '6px'
            }}>NIP Kepala Sekolah</label>
            <input
              id="principal-nip"
              type="text"
              value={config.principal_nip}
              onChange={(e) => setConfig({ ...config, principal_nip: e.target.value })}
              style={{
                width: '100%',
                padding: '10px 14px',
                border: `1px solid ${BORDER}`,
                borderRadius: '10px',
                fontSize: '14px',
                fontFamily: 'inherit',
                outline: 'none',
                transition: 'border-color 0.15s ease'
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = BLUE}
              onBlur={(e) => e.currentTarget.style.borderColor = BORDER}
            />
          </div>
        </div>

        {/* Logo Card */}
        <div style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          borderRadius: RADIUS,
          boxShadow: SHADOW,
          padding: '24px'
        }}>
          <h3 style={{
            fontSize: '16px',
            margin: '0 0 20px',
            fontWeight: '700',
            color: TEXT
          }}>Logo Sekolah</h3>
          
<div className="logo-upload-row" style={{
             marginBottom: '18px',
             display: 'flex',
             alignItems: 'center',
             gap: '16px',
             flexWrap: 'wrap'
           }}>
             {config.logo_url ? (
               <img
                 src={buildAssetUrl(config.logo_url)}
                 alt="Logo Sekolah"
                 style={{
                   width: '80px',
                   height: '80px',
                   objectFit: 'contain',
                   borderRadius: '12px',
                   border: `1px solid ${BORDER}`,
                   padding: '8px',
                   background: '#fff'
                 }}
               />
             ) : (
               <div style={{
                 width: '80px',
                 height: '80px',
                 borderRadius: '12px',
                 border: `1px solid ${BORDER}`,
                 display: 'flex',
                 alignItems: 'center',
                 justifyContent: 'center',
                 background: '#f8f9fa',
                 color: MUTED,
                 fontSize: '12px'
               }}>
                 No Logo
               </div>
             )}
             <div>
               <div style={{ fontSize: '13px', color: MUTED, marginBottom: '8px' }}>
                 {config.logo_url ? 'Logo saat ini' : 'Belum ada logo'}
               </div>
               <label className="logo-upload-label" style={{
                 display: 'inline-block',
                 padding: '8px 16px',
                 background: uploading ? MUTED : BLUE,
                 color: '#fff',
                 borderRadius: '8px',
                 fontSize: '13px',
                 fontWeight: '600',
                 cursor: uploading ? 'not-allowed' : 'pointer',
                 transition: 'filter 0.15s ease',
                 opacity: uploading ? 0.7 : 1
               }}
               onMouseEnter={(e) => !uploading && (e.currentTarget.style.filter = 'brightness(1.07)')}
               onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
               >
                 {uploading ? 'Mengupload...' : 'Upload Logo Baru'}
                 <input
                   type="file"
                   accept="image/*"
                   onChange={handleLogoUpload}
                   disabled={uploading}
                   style={{ display: 'none' }}
                 />
               </label>
             </div>
           </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="school-save-row" style={{
        marginTop: '24px',
        display: 'flex',
        justifyContent: 'flex-end'
      }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            border: 'none',
            borderRadius: '10px',
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: '700',
            cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            background: BLUE,
            color: '#fff',
            boxShadow: '0 6px 16px -8px rgba(47,95,232,.6)',
            transition: 'filter 0.15s ease, transform 0.1s ease',
            opacity: saving ? 0.7 : 1
          }}
          onMouseEnter={(e) => !saving && (e.currentTarget.style.filter = 'brightness(1.07)')}
          onMouseLeave={(e) => e.currentTarget.style.filter = 'brightness(1)'}
          onMouseDown={(e) => !saving && (e.currentTarget.style.transform = 'scale(0.96)')}
          onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
        >
          {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
        </button>
      </div>
    </div>
  );
}

export default SchoolConfig;
