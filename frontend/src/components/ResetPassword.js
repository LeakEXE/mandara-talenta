import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import { KeyRound } from 'lucide-react';

function randomTempPassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

const formatDate = (value) => value
  ? new Date(value).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  : '-';

function ResetPassword() {
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState([]);
  const [searching, setSearching] = useState(false);
  // Pending reset requests (submitted via /lupa-password).
  const [pending, setPending] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  // Direct reset form state.
  const [selected, setSelected] = useState(null);
  const [tempPassword, setTempPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Request approve/reject modal state: { item, mode: 'approve' | 'reject' }.
  const [reqTarget, setReqTarget] = useState(null);
  const [reqNotes, setReqNotes] = useState('');
  const [reqTemp, setReqTemp] = useState('');
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [message, setMessage] = useState(null); // { type: 'success'|'error', text }
  const searchTimer = useRef(null);

  const fetchPending = async () => {
    try {
      const res = await api.get('/users/password-reset-approvals');
      setPending(res.data || []);
    } catch {
      // Non-fatal: direct reset still works without the queue.
    } finally {
      setPendingLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = search.trim();
    if (!q) {
      setUsers([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get('/users', { params: { search: q, limit: 10 } });
        setUsers(res.data?.users || []);
      } catch (err) {
        setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal mencari pengguna' });
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const pendingIds = new Set(pending.map((r) => r.user_id));

  const openReset = (user) => {
    setSelected(user);
    setTempPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmModal(false);
    setMessage(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (tempPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'Konfirmasi password tidak cocok' });
      return;
    }
    if (tempPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password sementara minimal 6 karakter' });
      return;
    }
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const res = await api.put(`/users/${selected.id}/reset-password`, { tempPassword });
      setMessage({ type: 'success', text: `${res.data?.message || 'Password berhasil direset.'} Sampaikan password sementara ke user secara aman (langsung/WA).` });
      setShowConfirmModal(false);
      const resetId = selected.id;
      setSelected(null);
      setTempPassword('');
      setConfirmPassword('');
      // Direct reset auto-resolves pending requests server-side.
      setPending((prev) => prev.filter((r) => r.user_id !== resetId));
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal mereset password' });
      setShowConfirmModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const openReqModal = (item, mode) => {
    setReqTarget({ item, mode });
    setReqNotes('');
    setReqTemp('');
    setMessage(null);
  };

  const handleReqAction = async () => {
    const { item, mode } = reqTarget;
    if (mode === 'approve') {
      if (!reqTemp || reqTemp.length < 6) {
        setMessage({ type: 'error', text: 'Password sementara minimal 6 karakter' });
        return;
      }
      setReqSubmitting(true);
      try {
        await api.put(`/users/password-reset-approvals/${item.id}`, {
          status: 'approved',
          notes: reqNotes || 'Disetujui',
          tempPassword: reqTemp
        });
        setMessage({ type: 'success', text: `Reset password ${item.nama} disetujui. Sampaikan password sementara ke user secara aman (langsung/WA).` });
        setReqTarget(null);
        fetchPending();
      } catch (err) {
        setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menyetujui' });
      } finally {
        setReqSubmitting(false);
      }
    } else {
      if (!reqNotes.trim()) {
        setMessage({ type: 'error', text: 'Catatan penolakan wajib diisi' });
        return;
      }
      setReqSubmitting(true);
      try {
        await api.put(`/users/password-reset-approvals/${item.id}`, {
          status: 'rejected',
          notes: reqNotes
        });
        setMessage({ type: 'success', text: `Permintaan reset password ${item.nama} ditolak.` });
        setReqTarget(null);
        fetchPending();
      } catch (err) {
        setMessage({ type: 'error', text: err.response?.data?.message || 'Gagal menolak' });
      } finally {
        setReqSubmitting(false);
      }
    }
  };

  const idLabel = (u) => u.nis || u.nip || '-';

  return (
    <div>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <KeyRound size={26} /> Reset Password
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '.88rem', maxWidth: '640px' }}>
        Tinjau permintaan reset dari user, atau reset langsung user mana pun.
        User wajib mengganti password sementara saat login berikutnya.
      </p>

      {message && (
        <div className="card" style={{
          borderLeft: `4px solid ${message.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)'}`,
          marginBottom: '16px'
        }}>
          {message.text}
        </div>
      )}

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Permintaan Reset ({pending.length})</h3>
        {pendingLoading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Memuat...</p>
        ) : pending.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>Tidak ada permintaan menunggu persetujuan.</p>
        ) : (
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Diajukan Oleh</th>
                <th>Nama</th>
                <th>NIS/NIP</th>
                <th>Role</th>
                <th>Tanggal</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{r.requested_by_name || '-'}</td>
                  <td>{r.nama}</td>
                  <td>{r.nis || '-'}</td>
                  <td>{r.role}</td>
                  <td>{formatDate(r.created_at)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button className="btn btn-primary" onClick={() => openReqModal(r, 'approve')}>
                        Setuju
                      </button>
                      <button className="btn btn-danger" onClick={() => openReqModal(r, 'reject')}>
                        Tolak
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Reset Langsung — Cari User</h3>
        <div className="form-group">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ketik nama, username, NIS, atau NIP..."
            autoComplete="off"
          />
          <div className="form-helper-text">
            {searching ? 'Mencari...' : 'Hasil menampilkan maksimal 10 akun. Akun superadmin dikecualikan.'}
          </div>
        </div>

        {users.length > 0 && (
          <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Username</th>
                <th>Role</th>
                <th>NIS/NIP</th>
                <th>Kelas</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.nama}</td>
                  <td>{u.username || '-'}</td>
                  <td>{u.role}</td>
                  <td>{idLabel(u)}</td>
                  <td>{u.kelas || '-'}</td>
                  <td>{pendingIds.has(u.id) ? 'Menunggu persetujuan' : '-'}</td>
                  <td>
                    {u.role === 'superadmin' ? (
                      <span style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>Dikecualikan</span>
                    ) : (
                      <button className="btn btn-danger" onClick={() => openReset(u)}>
                        Reset
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="card" style={{ marginBottom: '24px' }}>
          <h3>Reset password: {selected.nama} ({selected.username || idLabel(selected)})</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Password Sementara</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                  placeholder="Minimal 6 karakter"
                  autoComplete="new-password"
                  required
                  style={{ flex: '1 1 160px', minWidth: 0 }}
                />
                <button type="button" className="btn btn-secondary" onClick={() => setShowPassword((s) => !s)}>
                  {showPassword ? 'Sembunyi' : 'Lihat'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { const p = randomTempPassword(); setTempPassword(p); setConfirmPassword(p); }}
                >
                  Generate
                </button>
              </div>
            </div>
            <div className="form-group">
              <label>Konfirmasi Password Sementara</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-danger">Reset Password</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Batal</button>
          </form>
        </div>
      )}

      {showConfirmModal && selected && (
        <div
          className="app-modal-overlay"
          onClick={() => { if (!submitting) setShowConfirmModal(false); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1500
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--card-radius, 12px)', boxShadow: '0 12px 30px -10px rgba(0,0,0,.4)',
              width: '440px', maxWidth: '90%', padding: '24px'
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 12px' }}>
              Reset password {selected.nama}?
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--slate)', margin: '0 0 6px', lineHeight: 1.6 }}>
              Password lama langsung tidak berlaku. User login dengan password sementara lalu
              wajib menggantinya. Permintaan reset yang masih menunggu ikut diselesaikan otomatis.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setShowConfirmModal(false)} disabled={submitting}>
                Batal
              </button>
              <button className="btn btn-danger" onClick={handleConfirm} disabled={submitting}>
                {submitting ? 'Mereset...' : 'Ya, Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {reqTarget && (
        <div
          className="app-modal-overlay"
          onClick={() => { if (!reqSubmitting) setReqTarget(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1500
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
              borderRadius: 'var(--card-radius, 12px)', boxShadow: '0 12px 30px -10px rgba(0,0,0,.4)',
              width: '440px', maxWidth: '90%', padding: '24px'
            }}
          >
            <h3 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 12px' }}>
              {reqTarget.mode === 'approve' ? 'Setujui' : 'Tolak'} permintaan {reqTarget.item.nama}?
            </h3>
            <div className="form-group">
              <label>Catatan{reqTarget.mode === 'reject' ? ' (wajib)' : ''}</label>
              <textarea
                value={reqNotes}
                onChange={(e) => setReqNotes(e.target.value)}
                placeholder="Tambahkan catatan"
                rows="3"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            {reqTarget.mode === 'approve' && (
              <div className="form-group">
                <label>Password Sementara</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    value={reqTemp}
                    onChange={(e) => setReqTemp(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    autoComplete="new-password"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setReqTemp(randomTempPassword())}
                  >
                    Generate
                  </button>
                </div>
                <div className="form-helper-text">
                  Berikan password ini ke user secara langsung. User wajib menggantinya saat login berikutnya.
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
              <button className="btn btn-secondary" onClick={() => setReqTarget(null)} disabled={reqSubmitting}>
                Batal
              </button>
              <button
                className={reqTarget.mode === 'approve' ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleReqAction}
                disabled={reqSubmitting}
              >
                {reqSubmitting ? 'Memproses...' : reqTarget.mode === 'approve' ? 'Setuju' : 'Tolak'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ResetPassword;
