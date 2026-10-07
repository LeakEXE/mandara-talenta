import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

// First-login screen: users flagged must_change_credentials must set their
// own username (or keep the auto-generated one) AND a new password before
// using the app. Backend enforces the same gate on every /api call.
function FirstLoginSetup() {
  const navigate = useNavigate();
  const [currentUsername, setCurrentUsername] = useState('');
  const [username, setUsername] = useState('');
  const [availability, setAvailability] = useState(null); // null | { available, message }
  const [checking, setChecking] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      stored = {};
    }
    if (!stored.must_change_credentials) {
      navigate('/dashboard');
      return;
    }
    const loadUsername = async () => {
      try {
        const res = await api.get('/profile');
        const uname = res.data?.username || stored.username || '';
        setCurrentUsername(uname);
        setUsername(uname);
      } catch {
        const uname = stored.username || '';
        setCurrentUsername(uname);
        setUsername(uname);
      }
    };
    loadUsername();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkAvailability = useCallback(async (value) => {
    if (!value || value === currentUsername) {
      setAvailability(null);
      return;
    }
    setChecking(true);
    try {
      const res = await api.get('/profile/check-username', { params: { username: value } });
      setAvailability({ available: res.data.available, message: res.data.message });
    } catch {
      setAvailability(null);
    } finally {
      setChecking(false);
    }
  }, [currentUsername]);

  useEffect(() => {
    const timer = setTimeout(() => checkAvailability(username.trim()), 400);
    return () => clearTimeout(timer);
  }, [username, checkAvailability]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setMessage('Username wajib diisi');
      return;
    }
    if (!currentPassword) {
      setMessage('Password saat ini wajib diisi');
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      setMessage('Password baru minimal 6 karakter');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('Konfirmasi password tidak cocok');
      return;
    }

    setSaving(true);
    try {
      // 1. Username (only when changed; keeping the default is allowed)
      if (trimmedUsername !== currentUsername) {
        await api.put('/profile/username', { username: trimmedUsername, currentPassword });
      }
      // 2. Password (required clears the first-login flag server-side)
      await api.post('/profile/change-password', { currentPassword, newPassword });

      // 3. Refresh stored user and enter the app
      const res = await api.get('/profile');
      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, ...res.data }));
      } catch {
        // ignore storage errors
      }
      navigate('/dashboard');
    } catch (error) {
      setMessage(error.response?.data?.message || 'Gagal menyimpan, coba lagi');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      background: 'var(--bg-secondary)',
      fontFamily: 'var(--font-sans)'
    }}>
      <div className="card-flat" style={{ width: '100%', maxWidth: '440px', padding: '32px 28px' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '20px' }}>Pengaturan Akun</h2>
        <p style={{ margin: '0 0 20px', fontSize: '13.5px', color: 'var(--slate)' }}>
          Login pertama - atur username dan password Anda untuk melanjutkan.
        </p>

          {message && (
            <div className="alert alert-danger" style={{ marginBottom: '16px' }}>{message}</div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="5-20 karakter: huruf, angka, !@#_"
                autoComplete="username"
                required
              />
              <div className="form-helper-text">
                {checking ? (
                  'Memeriksa ketersediaan...'
                ) : username.trim() === currentUsername ? (
                  `Username bawaan Anda: ${currentUsername || '-'}. Boleh dipakai atau diganti.`
                ) : availability ? (
                  <span style={{ color: availability.available ? 'var(--success-color)' : 'var(--danger-color)' }}>
                    {availability.message}
                  </span>
                ) : (
                  '5-20 karakter: huruf, angka, dan !@#_ (tanpa spasi).'
                )}
              </div>
            </div>

            <div className="form-group">
              <label>Password Saat Ini <span className="required">*</span></label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="form-group">
              <label>Password Baru (min. 6 karakter) <span className="required">*</span></label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <div className="form-group">
              <label>Konfirmasi Password Baru <span className="required">*</span></label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%' }}>
              {saving ? 'Menyimpan...' : 'Simpan & Masuk'}
            </button>
          </form>
      </div>
    </div>
  );
}

export default FirstLoginSetup;
