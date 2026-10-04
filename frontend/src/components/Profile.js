import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import API_BASE_URL from '../config';
import { useMinIptPerGrade, minIptFor, isBelowMinIpt } from '../utils/minIpt';
import { formatDisplayText } from '../utils/formatDisplayText';
import StudentRecordsHistory from './StudentRecordsHistory';
import { UserRound, Camera, Trash2 } from 'lucide-react';

const JABATAN_OPTIONS = ['Guru', 'Pegawai'];
const JURUSAN_OPTIONS = ['TKJ 1', 'TKJ 2', 'DPIB 1', 'DPIB 2', 'TKR 1', 'TKR 2'];

const CROP_MIN_ZOOM = 1;
const CROP_MAX_ZOOM = 3;
const CROP_OUTPUT = 512;
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

function clampNum(v, a, b) {
  return Math.min(b, Math.max(a, v));
}

function AvatarCropModal({ src, saving, onCancel, onSave }) {
  const containerRef = useRef(null);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const dragLastRef = useRef(null);
  const [containerSize, setContainerSize] = useState(320);
  const [natural, setNatural] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [cropping, setCropping] = useState(false);

  const baseScale = natural && containerSize
    ? Math.max(containerSize / natural.w, containerSize / natural.h)
    : 1;
  const dispW = natural ? natural.w * baseScale * zoom : containerSize;
  const dispH = natural ? natural.h * baseScale * zoom : containerSize;

  const clampOffset = (ox, oy, dw, dh, cs) => ({
    x: dw <= cs + 1 ? (cs - dw) / 2 : clampNum(ox, cs - dw, 0),
    y: dh <= cs + 1 ? (cs - dh) / 2 : clampNum(oy, cs - dh, 0),
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerSize(w);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    }
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (ro) ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  useEffect(() => {
    if (!natural) return;
    const dw = natural.w * baseScale * zoom;
    const dh = natural.h * baseScale * zoom;
    setOffset((prev) => clampOffset(prev.x, prev.y, dw, dh, containerSize));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerSize, natural, baseScale]);

  const handleImgLoad = (e) => {
    const nw = e.target.naturalWidth;
    const nh = e.target.naturalHeight;
    if (!nw || !nh) return;
    setNatural({ w: nw, h: nh });
    setZoom(1);
    const b = Math.max(containerSize / nw, containerSize / nh);
    const dw = nw * b;
    const dh = nh * b;
    setOffset({ x: (containerSize - dw) / 2, y: (containerSize - dh) / 2 });
  };

  const zoomTo = (nz) => {
    const z = clampNum(nz, CROP_MIN_ZOOM, CROP_MAX_ZOOM);
    if (!natural) {
      setZoom(z);
      return;
    }
    const oldScale = baseScale * zoom;
    const newScale = baseScale * z;
    const cx = containerSize / 2;
    const cy = containerSize / 2;
    const ix = (cx - offset.x) / oldScale;
    const iy = (cy - offset.y) / oldScale;
    const dw = natural.w * newScale;
    const dh = natural.h * newScale;
    const nx = cx - ix * newScale;
    const ny = cy - iy * newScale;
    setZoom(z);
    setOffset(clampOffset(nx, ny, dw, dh, containerSize));
  };

  const resetView = () => {
    if (!natural) {
      setZoom(1);
      return;
    }
    setZoom(1);
    const dw = natural.w * baseScale;
    const dh = natural.h * baseScale;
    setOffset({ x: (containerSize - dw) / 2, y: (containerSize - dh) / 2 });
  };

  const distOf = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  const onPointerDown = (e) => {
    const el = containerRef.current;
    if (el && el.setPointerCapture) {
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      pinchRef.current = {
        startDist: Math.max(1, distOf(pts[0], pts[1])),
        startZoom: zoom,
        startMid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
        startOffset: { ...offset },
      };
      dragLastRef.current = null;
    } else {
      pinchRef.current = null;
      dragLastRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onPointerMove = (e) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2 && pinchRef.current && natural) {
      const pts = Array.from(pointersRef.current.values());
      const d = Math.max(1, distOf(pts[0], pts[1]));
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const p = pinchRef.current;
      const z = clampNum(p.startZoom * (d / p.startDist), CROP_MIN_ZOOM, CROP_MAX_ZOOM);
      const el = containerRef.current;
      const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0 };
      const rectScale = el && el.clientWidth ? containerSize / el.clientWidth : 1;
      const dxCss = (mid.x - p.startMid.x) * rectScale;
      const dyCss = (mid.y - p.startMid.y) * rectScale;
      void rect;
      const newScale = baseScale * z;
      const dw = natural.w * newScale;
      const dh = natural.h * newScale;
      const nx = p.startOffset.x + dxCss;
      const ny = p.startOffset.y + dyCss;
      setZoom(z);
      setOffset(clampOffset(nx, ny, dw, dh, containerSize));
      return;
    }
    if (pointersRef.current.size === 1 && dragLastRef.current && natural) {
      const last = dragLastRef.current;
      const el = containerRef.current;
      const rectScale = el && el.clientWidth ? containerSize / el.clientWidth : 1;
      const dx = (e.clientX - last.x) * rectScale;
      const dy = (e.clientY - last.y) * rectScale;
      dragLastRef.current = { x: e.clientX, y: e.clientY };
      setOffset((prev) => clampOffset(prev.x + dx, prev.y + dy, dispW, dispH, containerSize));
    }
  };

  const endPointer = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragLastRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      dragLastRef.current = { x: remaining.x, y: remaining.y };
    }
  };

  const renderCrop = () => new Promise((resolve, reject) => {
    if (!natural) {
      reject(new Error('Gambar belum siap'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = baseScale * zoom;
        let sx = -offset.x / scale;
        let sy = -offset.y / scale;
        let s = containerSize / scale;
        sx = clampNum(sx, 0, Math.max(0, img.naturalWidth - 1));
        sy = clampNum(sy, 0, Math.max(0, img.naturalHeight - 1));
        s = Math.min(s, img.naturalWidth - sx, img.naturalHeight - sy);
        if (s <= 0) {
          reject(new Error('Area potong tidak valid'));
          return;
        }
        const out = document.createElement('canvas');
        out.width = CROP_OUTPUT;
        out.height = CROP_OUTPUT;
        const ctx = out.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CROP_OUTPUT, CROP_OUTPUT);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, sx, sy, s, s, 0, 0, CROP_OUTPUT, CROP_OUTPUT);
        out.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Gagal memotong gambar'));
          },
          'image/jpeg',
          0.92
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error('Gagal memuat gambar'));
    img.src = src;
  });

  const handleSave = async () => {
    if (cropping || saving) return;
    setCropping(true);
    try {
      const blob = await renderCrop();
      await onSave(blob);
    } catch (err) {
      alert(err.message || 'Gagal memotong gambar');
      setCropping(false);
    }
  };

  const previewSize = 96;
  const pvScale = containerSize ? previewSize / containerSize : 0.3;

  const cornerBase = {
    position: 'absolute',
    width: '22px',
    height: '22px',
    border: '0 solid #fff',
    zIndex: 4,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sesuaikan foto profil"
      onClick={(e) => { if (e.target === e.currentTarget && !saving && !cropping) onCancel(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 2000,
      }}
    >
      <div style={{
        width: '100%',
        maxWidth: '600px',
        maxHeight: '92vh',
        overflowY: 'auto',
        background: '#161616',
        color: '#fff',
        borderRadius: '16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        padding: '20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '4px' }}>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>Sesuaikan foto profil</div>
            <div style={{ fontSize: '.82rem', color: 'rgba(255,255,255,0.72)', marginTop: '2px' }}>
              Seret untuk menggeser, cubit atau gunakan slider untuk zoom. Hasil 1:1 pas bingkai lingkaran.
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={saving || cropping}
            aria-label="Tutup"
            style={{
              border: 'none', background: 'rgba(255,255,255,0.12)', color: '#fff',
              width: '32px', height: '32px', borderRadius: '50%', cursor: 'pointer', fontSize: '16px', flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '14px', alignItems: 'flex-start', justifyContent: 'center' }}>
          <div>
            <div
              ref={containerRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endPointer}
              onPointerCancel={endPointer}
              onDoubleClick={() => zoomTo(zoom > 1.5 ? 1 : 2)}
              style={{
                position: 'relative',
                width: 'min(72vw, 340px)',
                aspectRatio: '1 / 1',
                background: '#000',
                overflow: 'hidden',
                borderRadius: '6px',
                touchAction: 'none',
                cursor: 'grab',
                userSelect: 'none',
              }}
            >
              <img
                src={src}
                alt="Pratinjau potong"
                onLoad={handleImgLoad}
                draggable={false}
                style={{
                  position: 'absolute',
                  left: `${offset.x}px`,
                  top: `${offset.y}px`,
                  width: `${dispW}px`,
                  height: `${dispH}px`,
                  maxWidth: 'none',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 3, pointerEvents: 'none' }}
              >
                <defs>
                  <mask id="avatar-crop-mask">
                    <rect x="0" y="0" width="100" height="100" fill="#fff" />
                    <circle cx="50" cy="50" r="50" fill="#000" />
                  </mask>
                </defs>
                <rect x="0" y="0" width="100" height="100" fill="rgba(0,0,0,0.55)" mask="url(#avatar-crop-mask)" />
                <circle cx="50" cy="50" r="49.6" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.5" />
                <line x1="33.33" y1="0" x2="33.33" y2="100" stroke="rgba(255,255,255,0.65)" strokeWidth="0.4" />
                <line x1="66.66" y1="0" x2="66.66" y2="100" stroke="rgba(255,255,255,0.65)" strokeWidth="0.4" />
                <line x1="0" y1="33.33" x2="100" y2="33.33" stroke="rgba(255,255,255,0.65)" strokeWidth="0.4" />
                <line x1="0" y1="66.66" x2="100" y2="66.66" stroke="rgba(255,255,255,0.65)" strokeWidth="0.4" />
              </svg>
              <div style={{ ...cornerBase, top: '8px', left: '8px', borderTopWidth: '3px', borderLeftWidth: '3px', borderTopLeftRadius: '3px' }} />
              <div style={{ ...cornerBase, top: '8px', right: '8px', borderTopWidth: '3px', borderRightWidth: '3px', borderTopRightRadius: '3px' }} />
              <div style={{ ...cornerBase, bottom: '8px', left: '8px', borderBottomWidth: '3px', borderLeftWidth: '3px', borderBottomLeftRadius: '3px' }} />
              <div style={{ ...cornerBase, bottom: '8px', right: '8px', borderBottomWidth: '3px', borderRightWidth: '3px', borderBottomRightRadius: '3px' }} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px', width: 'min(72vw, 340px)' }}>
              <button
                onClick={() => zoomTo(zoom - 0.2)}
                disabled={zoom <= CROP_MIN_ZOOM + 0.001}
                aria-label="Perkecil"
                style={{
                  width: '34px', height: '34px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)',
                  background: 'transparent', color: '#fff', fontSize: '18px', cursor: 'pointer', flexShrink: 0,
                  opacity: zoom <= CROP_MIN_ZOOM + 0.001 ? 0.4 : 1,
                }}
              >
                −
              </button>
              <input
                type="range"
                min={CROP_MIN_ZOOM}
                max={CROP_MAX_ZOOM}
                step="0.01"
                value={zoom}
                onChange={(e) => zoomTo(Number(e.target.value))}
                aria-label="Zoom foto"
                style={{ flex: 1, accentColor: '#3B82F6' }}
              />
              <button
                onClick={() => zoomTo(zoom + 0.2)}
                disabled={zoom >= CROP_MAX_ZOOM - 0.001}
                aria-label="Perbesar"
                style={{
                  width: '34px', height: '34px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)',
                  background: 'transparent', color: '#fff', fontSize: '18px', cursor: 'pointer', flexShrink: 0,
                  opacity: zoom >= CROP_MAX_ZOOM - 0.001 ? 0.4 : 1,
                }}
              >
                +
              </button>
              <button
                onClick={resetView}
                style={{
                  border: '1px solid rgba(255,255,255,0.25)', background: 'transparent', color: '#fff',
                  borderRadius: '8px', padding: '7px 10px', fontSize: '.75rem', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                }}
              >
                Reset
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', minWidth: '130px' }}>
            <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>Pratinjau lingkaran</div>
            <div style={{
              width: `${previewSize}px`, height: `${previewSize}px`, borderRadius: '50%',
              overflow: 'hidden', background: '#000', position: 'relative',
              border: '2px solid rgba(255,255,255,0.85)',
            }}>
              {natural && (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: `${offset.x * pvScale}px`,
                    top: `${offset.y * pvScale}px`,
                    width: `${dispW * pvScale}px`,
                    height: `${dispH * pvScale}px`,
                    maxWidth: 'none',
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
            <div style={{ fontSize: '.72rem', color: 'rgba(255,255,255,0.6)' }}>
              {Math.round(((zoom - 1) / (CROP_MAX_ZOOM - 1)) * 100)}% zoom • 1:1
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '18px', flexWrap: 'wrap' }}>
          <button
            onClick={onCancel}
            disabled={saving || cropping}
            className="btn"
            style={{
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: '10px', padding: '10px 18px',
              fontSize: '.85rem', fontWeight: 600, cursor: 'pointer', background: 'transparent', color: '#fff',
            }}
          >
            Batal
          </button>
          <button
            onClick={handleSave}
            disabled={saving || cropping || !natural}
            className="btn btn-primary"
            style={{ borderRadius: '10px', padding: '10px 22px', fontSize: '.85rem', fontWeight: 700 }}
          >
            {saving || cropping ? 'Menyimpan...' : 'Simpan foto'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Profile() {
  const minIpt = useMinIptPerGrade();
  const [profile, setProfile] = useState(null);
  const [iptHistory, setIptHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState({});
  const [uploading, setUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState(null);
  const [cropOpen, setCropOpen] = useState(false);
  const fileInputRef = useRef(null);
  const [passwordMode, setPasswordMode] = useState(false);
  const [usernameMode, setUsernameMode] = useState(false);
  const [usernameData, setUsernameData] = useState({ username: '', currentPassword: '' });
  const [usernameCheck, setUsernameCheck] = useState(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });

  useEffect(() => {
    fetchProfile();
    fetchIptHistory();
    fetchSummary();
  }, []);

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
    };
  }, [cropSrc]);

  const fetchProfile = async () => {
    try {
      const response = await api.get('/profile');
      setProfile(response.data);
      setEditData(response.data);
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const fetchIptHistory = async () => {
    try {
      const response = await api.get('/profile/ipt-history');
      setIptHistory(response.data);
    } catch (error) {
      console.error('Error fetching IPT history:', error);
    }
  };

  const fetchSummary = async () => {
    try {
      const response = await api.get('/profile/summary');
      setSummary(response.data);
    } catch (error) {
      console.error('Error fetching summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    try {
      // Send only the fields this role may change (server enforces the same list)
      const payload = { no_hp: editData.no_hp, alamat: editData.alamat };
      if (user.role === 'siswa') {
        payload.nama = editData.nama;
        payload.nis = editData.nis;
        payload.jurusan = editData.jurusan;
        payload.tahun_pelajaran = editData.tahun_pelajaran;
      }
      if (user.role === 'guru' || user.role === 'pegawai') {
        payload.nip = editData.nip;
        payload.nama = editData.nama;
        payload.jabatan = editData.jabatan || editData.detail;
      }
      if (user.role === 'superadmin') {
        payload.nama = editData.nama;
      }
      await api.put(`/users/${profile.id}`, payload);
      setEditMode(false);
      fetchProfile();
    } catch (error) {
      alert(error.response?.data?.message || 'Gagal update profile');
    }
  };

  const handleAvatarSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      alert('Pilih file gambar (jpeg, png, gif, webp)');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      alert('Ukuran file maksimal 5MB');
      return;
    }
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    const url = URL.createObjectURL(file);
    setCropSrc(url);
    setCropOpen(true);
  };

  const closeCrop = () => {
    if (uploading) return;
    setCropOpen(false);
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropSave = async (blob) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('avatar', blob, 'avatar.jpg');

      await api.post('/profile/avatar', formData);

      setCropOpen(false);
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      setCropSrc(null);
      fetchProfile();
    } catch (error) {
      alert(error.response?.data?.message || 'Gagal upload avatar');
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarDelete = async () => {
    if (!window.confirm('Hapus avatar?')) return;

    try {
      await api.delete('/profile/avatar');

      alert('Avatar berhasil dihapus');
      fetchProfile();
    } catch (error) {
      alert(error.response?.data?.message || 'Gagal hapus avatar');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      alert('Password baru tidak cocok');
      return;
    }
    if (passwordData.newPassword.length < 6) {
      alert('Password minimal 6 karakter');
      return;
    }

    try {
      await api.post('/profile/change-password', passwordData);
      alert('Password berhasil diubah');
      setPasswordMode(false);
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      alert(error.response?.data?.message || 'Gagal mengubah password');
    }
  };

  const openUsernameMode = () => {
    setUsernameData({ username: profile?.username || '', currentPassword: '' });
    setUsernameCheck(null);
    setUsernameMode(true);
  };

  const usernameCheckTimer = useRef(null);

  const checkUsernameLive = (value) => {
    const v = (value || '').trim();
    if (usernameCheckTimer.current) {
      clearTimeout(usernameCheckTimer.current);
    }
    if (!v || v === profile?.username) {
      setUsernameCheck(null);
      return;
    }
    usernameCheckTimer.current = setTimeout(async () => {
      setCheckingUsername(true);
      try {
        const res = await api.get('/profile/check-username', { params: { username: v } });
        setUsernameCheck({ available: res.data.available, message: res.data.message });
      } catch {
        setUsernameCheck(null);
      } finally {
        setCheckingUsername(false);
      }
    }, 400);
  };

  const handleUsernameChange = async (e) => {
    e.preventDefault();
    try {
      const res = await api.put('/profile/username', {
        username: usernameData.username.trim(),
        currentPassword: usernameData.currentPassword
      });
      alert('Username berhasil diubah');
      setUsernameMode(false);
      setUsernameData({ username: '', currentPassword: '' });
      setUsernameCheck(null);
      fetchProfile();
      // Keep the stored session in sync (UI reads username from localStorage)
      try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...stored, username: res.data.username }));
      } catch {
        // ignore storage errors
      }
    } catch (error) {
      alert(error.response?.data?.message || 'Gagal mengubah username');
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  let user = null;
  try {
    user = JSON.parse(localStorage.getItem('user'));
  } catch (e) {
    console.error('Error parsing user from localStorage:', e);
  }
  
  const avatarUrl = profile?.foto ? `${API_BASE_URL.replace('/api', '')}${profile.foto}` : null;

  const renderBiodata = () => {
    if (editMode) {
      return (
        <form onSubmit={handleUpdateProfile}>
          {user.role === 'siswa' && (
            <>
              <div className="form-group">
                <label>Nama</label>
                <input type="text" value={editData.nama || ''} onChange={(e) => setEditData({...editData, nama: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>NIS</label>
                <input type="text" value={editData.nis || ''} onChange={(e) => setEditData({...editData, nis: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Jurusan</label>
                <select value={editData.jurusan || ''} onChange={(e) => setEditData({...editData, jurusan: e.target.value})} required>
                  <option value="" disabled hidden>Pilih Jurusan</option>
                  {JURUSAN_OPTIONS.map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Tahun Pelajaran Masuk</label>
                <select value={editData.tahun_pelajaran || ''} onChange={(e) => setEditData({...editData, tahun_pelajaran: e.target.value})} required>
                  <option value="" disabled hidden>Pilih Tahun Pelajaran</option>
                  {Array.from({ length: 11 }, (_, i) => {
                    const start = 2024 + i;
                    return `${start}-${start + 1}`;
                  }).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>No HP</label>
                <input type="text" value={editData.no_hp || ''} onChange={(e) => setEditData({...editData, no_hp: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Alamat</label>
                <input type="text" value={editData.alamat || ''} onChange={(e) => setEditData({...editData, alamat: e.target.value})} placeholder="Alamat tempat tinggal" />
              </div>
            </>
          )}
          {(user.role === 'guru' || user.role === 'pegawai') && (
            <>
              <div className="form-group">
                <label>NIP</label>
                <input type="text" value={editData.nip || ''} onChange={(e) => setEditData({...editData, nip: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Nama</label>
                <input type="text" value={editData.nama || ''} onChange={(e) => setEditData({...editData, nama: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>No HP</label>
                <input type="text" value={editData.no_hp || ''} onChange={(e) => setEditData({...editData, no_hp: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Alamat</label>
                <input type="text" value={editData.alamat || ''} onChange={(e) => setEditData({...editData, alamat: e.target.value})} placeholder="Alamat tempat tinggal" />
              </div>
              <div className="form-group">
                <label>Jabatan</label>
                <select value={editData.jabatan || editData.detail || ''} onChange={(e) => setEditData({...editData, jabatan: e.target.value})}>
                  <option value="" disabled hidden>Pilih Jabatan</option>
                  {!JABATAN_OPTIONS.includes(editData.jabatan || editData.detail) && (editData.jabatan || editData.detail) ? (
                    <option value={editData.jabatan || editData.detail}>{editData.jabatan || editData.detail} (lama)</option>
                  ) : null}
                  {JABATAN_OPTIONS.map((jabatan) => (
                    <option key={jabatan} value={jabatan}>{jabatan}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {user.role === 'superadmin' && (
            <>
              <div className="form-group">
                <label>Nama</label>
                <input type="text" value={editData.nama || ''} onChange={(e) => setEditData({...editData, nama: e.target.value})} />
              </div>
              <div className="form-group">
                <label>No HP</label>
                <input type="text" value={editData.no_hp || ''} onChange={(e) => setEditData({...editData, no_hp: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Alamat</label>
                <input type="text" value={editData.alamat || ''} onChange={(e) => setEditData({...editData, alamat: e.target.value})} placeholder="Alamat tempat tinggal" />
              </div>
            </>
          )}
          <button type="submit" className="btn btn-primary">Simpan</button>
          <button type="button" className="btn btn-danger" onClick={() => setEditMode(false)}>Batal</button>
        </form>
      );
    }

    return (
      <>
        <p><strong>Nama:</strong> {profile?.nama}</p>
        {user.role === 'siswa' && (
          <>
            <p><strong>NIS:</strong> {profile?.nis || '-'}</p>
            <p><strong>Kelas:</strong> {profile?.kelas || '-'}</p>
            <p><strong>Jurusan:</strong> {profile?.jurusan || '-'}</p>
            <p><strong>Tahun Pelajaran Masuk:</strong> {profile?.tahun_pelajaran || '-'}</p>
            <p><strong>Grha:</strong> {profile?.grha || '-'}</p>
            <p><strong>Wali Kelas:</strong> {profile?.wali_kelas_nama || profile?.wali_kelas || '-'}</p>
          </>
        )}
        {(user.role === 'guru' || user.role === 'pegawai') && (
          <>
            <p><strong>NIP:</strong> {profile?.nip || '-'}</p>
            <p><strong>Jabatan:</strong> {profile?.jabatan || profile?.detail || '-'}</p>
          </>
        )}
        {user.role === 'superadmin' && (
          <p><strong>NIS:</strong> {profile?.nis || '-'}</p>
        )}
        <p><strong>Role:</strong> {profile?.role}</p>
        <p><strong>No HP:</strong> {profile?.no_hp || '-'}</p>
        <p><strong>Alamat:</strong> {profile?.alamat || '-'}</p>
        <button className="btn btn-primary" onClick={() => setEditMode(true)} style={{ marginTop: '10px' }}>Edit Biodata</button>
      </>
    );
  };

  return (
    <div>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <UserRound size={26} /> Profile
      </h2>
      
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '20px' }}>Avatar</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: 'var(--bg-tertiary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            border: '3px solid var(--primary-color)',
            boxShadow: 'var(--shadow-md)'
          }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}><UserRound size={56} /></span>
            )}
          </div>
          <div>
            <h4 style={{ margin: '0 0 8px 0' }}>{profile?.nama}</h4>
            <p style={{ color: 'var(--text-secondary)', margin: '0 0 16px 0' }}>{profile?.role}</p>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <label className="btn btn-primary" style={{ cursor: 'pointer' }}>
                <Camera size={15} /> Upload Avatar
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarSelect}
                  style={{ display: 'none' }}
                />
              </label>
              {avatarUrl && (
                <button
                  onClick={handleAvatarDelete}
                  className="btn btn-danger"
                >
                  <Trash2 size={15} /> Hapus
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Biodata</h3>
        {renderBiodata()}
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Ubah Username</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '.85rem', margin: '0 0 12px 0' }}>
          Username saat ini: <strong style={{ color: 'var(--text-primary)' }}>{profile?.username || '-'}</strong>
        </p>
        {usernameMode ? (
          <form onSubmit={handleUsernameChange}>
            <div className="form-group">
              <label>Username Baru</label>
              <input
                type="text"
                value={usernameData.username}
                onChange={(e) => { setUsernameData({ ...usernameData, username: e.target.value }); checkUsernameLive(e.target.value); }}
                placeholder="5-20 karakter: huruf, angka, !@#_"
                autoComplete="username"
                required
              />
              <div className="form-helper-text">
                {checkingUsername ? (
                  'Memeriksa ketersediaan...'
                ) : usernameCheck ? (
                  <span style={{ color: usernameCheck.available ? 'var(--success-color)' : 'var(--danger-color)' }}>
                    {usernameCheck.message}
                  </span>
                ) : (
                  '5-20 karakter: huruf, angka, dan !@#_ (tanpa spasi).'
                )}
              </div>
            </div>
            <div className="form-group">
              <label>Password Saat Ini</label>
              <input
                type="password"
                value={usernameData.currentPassword}
                onChange={(e) => setUsernameData({ ...usernameData, currentPassword: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Ubah Username</button>
            <button type="button" className="btn btn-danger" onClick={() => setUsernameMode(false)}>Batal</button>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={openUsernameMode}>Ubah Username</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: '24px' }}>
        <h3>Ubah Password</h3>
        {passwordMode ? (
          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label>Password Saat Ini</label>
              <input 
                type="password" 
                value={passwordData.currentPassword} 
                onChange={(e) => setPasswordData({...passwordData, currentPassword: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Password Baru</label>
              <input 
                type="password" 
                value={passwordData.newPassword} 
                onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})}
                required
              />
            </div>
            <div className="form-group">
              <label>Konfirmasi Password Baru</label>
              <input 
                type="password" 
                value={passwordData.confirmPassword} 
                onChange={(e) => setPasswordData({...passwordData, confirmPassword: e.target.value})}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary">Ubah Password</button>
            <button type="button" className="btn btn-danger" onClick={() => setPasswordMode(false)}>Batal</button>
          </form>
        ) : (
          <button className="btn btn-primary" onClick={() => setPasswordMode(true)}>Ubah Password</button>
        )}
      </div>

      {user.role === 'siswa' && (
        <>
          <div className="card" style={{ marginBottom: '24px' }}>
            <h3>IPT Anda</h3>
            <p style={{ fontSize: '48px', fontWeight: 'bold', color: isBelowMinIpt(profile?.ipt_total ?? 0, minIptFor(minIpt, profile?.kelas)) ? '#dc2626' : 'var(--blue)' }}>{profile?.ipt_total || 0}</p>
            <p>IPT Awal: {profile?.ipt_awal || 0}</p>
          </div>

          {summary && (
            <div className="card" style={{ marginBottom: '24px' }}>
              <h3>Ringkasan Prestasi</h3>
              <p><strong>Total Prestasi:</strong> {summary.total_prestasi}</p>
              <p><strong>Total Organisasi:</strong> {summary.total_organisasi}</p>
              <p><strong>Total Event:</strong> {summary.total_event}</p>
              <p><strong>Total Pelanggaran:</strong> {summary.total_pelanggaran}</p>
              <p><strong>Total Perilaku:</strong> {summary.total_perilaku}</p>
            </div>
          )}

          <StudentRecordsHistory
            records={summary}
            title="Riwayat Prestasi & Event"
            showAllTabs={false}
          />

          <div className="card">
            <h3>Riwayat IPT</h3>
            {iptHistory.length > 0 ? (
              <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Jenis Perubahan</th>
                    <th>Point Change</th>
                    <th>IPT Sebelum</th>
                    <th>IPT Sesudah</th>
                    <th>Keterangan</th>
                    <th>Tanggal</th>
                  </tr>
                </thead>
                <tbody>
                  {iptHistory.map(history => (
                    <tr key={history.id}>
                      <td>{formatDisplayText(history.jenis_perubahan)}</td>
                      <td style={{ color: history.point_change >= 0 ? 'green' : 'red' }}>
                        {history.point_change >= 0 ? '+' : ''}{history.point_change}
                      </td>
                      <td>{history.ipt_sebelum}</td>
                      <td>{history.ipt_sesudah}</td>
                      <td>{formatDisplayText(history.keterangan)}</td>
                      <td>{new Date(history.created_at).toLocaleDateString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <p>Belum ada riwayat IPT</p>
            )}
          </div>
        </>
      )}

      {cropOpen && cropSrc && (
        <AvatarCropModal
          src={cropSrc}
          saving={uploading}
          onCancel={closeCrop}
          onSave={handleCropSave}
        />
      )}
    </div>
  );
}

export default Profile;
