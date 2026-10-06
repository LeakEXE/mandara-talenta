import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { LogOut } from 'lucide-react';

function Navbar({ user, onLogout, isMobileMenuOpen, toggleMobileMenu }) {
  const [pendingCount, setPendingCount] = useState(0);
  const [resetPendingCount, setResetPendingCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [permissions, setPermissions] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  console.log('Navbar - User:', user);
  console.log('Navbar - User Role:', user?.role);

  // Fetch pending approvals count for superadmin + scoped approvers
  useEffect(() => {
    if (user?.role === 'superadmin' || (permissions?.approval_scopes || []).length > 0) {
      fetchPendingCount();

      // Refresh count every 30 seconds
      const interval = setInterval(fetchPendingCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user, permissions]);

  // Pending password-reset requests live on the Reset Password page now.
  useEffect(() => {
    if (user?.role === 'superadmin') {
      fetchResetPendingCount();

      const interval = setInterval(fetchResetPendingCount, 30000);
      return () => clearInterval(interval);
    } else {
      setResetPendingCount(0);
    }
  }, [user]);

  // Fetch unread notifications count for siswa/guru/pegawai
  useEffect(() => {
    if (user?.role === 'siswa' || user?.role === 'guru' || user?.role === 'pegawai') {
      fetchUnreadCount();

      // Refresh count every 30 seconds
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Refresh unread count when navigating to notifications page
  useEffect(() => {
    if (location.pathname === '/notifications' && (user?.role === 'siswa' || user?.role === 'guru' || user?.role === 'pegawai')) {
      fetchUnreadCount();
    }
  }, [location.pathname, user]);

  const fetchPendingCount = async () => {
    try {
      const response = await api.get('/approvals/pending-count');
      setPendingCount(response.data.total || 0);
    } catch (error) {
      console.error('Error fetching pending count:', error);
    }
  };

  const fetchResetPendingCount = async () => {
    try {
      const response = await api.get('/users/password-reset-approvals');
      setResetPendingCount(Array.isArray(response.data) ? response.data.length : 0);
    } catch (error) {
      console.error('Error fetching reset pending count:', error);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await api.get('/approvals/notifications/count');
      setUnreadCount(response.data.count || 0);
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  };

  const fetchPermissions = useCallback(async () => {
    if (!user) return;
    try {
      const response = await api.get('/permissions/my-permissions');
      setPermissions(response.data);
      console.log('Navbar - Permissions:', response.data);
    } catch (error) {
      console.error('Error fetching permissions:', error);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      fetchPermissions();
    }
  }, [user, fetchPermissions]);

  // Permission fetching disabled for now
  // const fetchPermissions = useCallback(async () => {
  //   if (!user) return;
  //   try {
  //     const token = localStorage.getItem('token');
  //     const response = await fetch('/permissions/' + user.id, {
  //       headers: { Authorization: `Bearer ${token}` }
  //     });
  //     const data = await response.json();
  //     console.log('Navbar - Permissions data:', data);
  //     setPermissions(data);
  //   } catch (error) {
  //     console.error('Error fetching permissions:', error);
  //   }
  // }, [user]);

  // useEffect(() => {
  //   fetchPermissions();
  // }, [fetchPermissions]);

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', show: true },
    { path: '/input-prestasi', label: 'Prestasi', show: true },
    { path: '/input-organisasi', label: 'Organisasi', show: true },
    { path: '/input-kepanitiaan', label: 'Kepanitiaan', show: true },
    { path: '/input-event', label: 'Event', show: true },
    // Pelanggaran and Perilaku: superadmin always has access, guru needs permission
    { path: '/input-pelanggaran', label: 'Pelanggaran', show: user?.role === 'superadmin' || ((user?.role === 'guru' || user?.role === 'pegawai') && permissions?.can_input_pelanggaran) },
    { path: '/input-perilaku', label: 'Perilaku', show: user?.role === 'superadmin' || ((user?.role === 'guru' || user?.role === 'pegawai') && permissions?.can_input_perilaku) },
    // Kelola Akun for superadmin
    { path: '/kelola-akun', label: 'Kelola Akun', show: user?.role === 'superadmin' },
    { path: '/reset-password', label: 'Reset Password', show: user?.role === 'superadmin' },
    { path: '/konfigurasi-ipt', label: 'Konfigurasi IPT', show: user?.role === 'superadmin' },
    { path: '/school-config', label: 'Konfigurasi Sekolah', show: user?.role === 'superadmin' },
    { path: '/izin-akun', label: 'Izin Akun', show: user?.role === 'superadmin' },
    // Approvals for superadmin + users holding at least one approval scope
    { path: '/approvals', label: 'Approvals', show: user?.role === 'superadmin' || (permissions?.approval_scopes || []).length > 0 },
    { path: '/drive-viewer', label: 'File Manager', show: user?.role === 'superadmin' },
    { path: '/notifications', label: 'Notifikasi', show: user?.role === 'siswa' || user?.role === 'guru' || user?.role === 'pegawai' },
    { path: '/logs', label: 'Logs', show: user?.role === 'superadmin' },
    { path: '/wali-kelas', label: 'Manajemen Wali Kelas', show: user?.role === 'superadmin' },
    { path: '/wali-kelas-guru', label: 'Wali Kelas', show: (user?.role === 'guru' || user?.role === 'pegawai') && user?.wali_kelas },
    { path: '/leaderboard', label: 'Peringkat', show: true },
    { path: '/cari-siswa', label: 'Cari Siswa', show: user?.role === 'superadmin' || user?.role === 'guru' || user?.role === 'pegawai' },
    { path: '/laporan-cetak', label: 'Laporan & Cetak', show: user?.role === 'superadmin' || ((user?.role === 'guru' || user?.role === 'pegawai') && user?.wali_kelas) },
    { path: '/profile', label: 'Profile', show: true }
  ];

  const filteredNavItems = navItems.filter(item => {
    if (!item.show) return false;
    // SuperAdmin, Siswa, dan Guru bisa akses semua input forms tanpa permission check
    return true;
  });

  return (
    <>
      <div className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-header-content">
            <h2>Mandara Talenta</h2>
            <p>SMKN Bali Mandara</p>
          </div>
        </div>
        <ul className="sidebar-nav">
          {filteredNavItems.map(item => (
            <li key={item.path}>
              <a
                href={item.path}
                className={location.pathname === item.path ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault();
                  console.log('Navigating to:', item.path, 'Mobile menu open:', isMobileMenuOpen);
                  navigate(item.path);
                  if (isMobileMenuOpen && toggleMobileMenu) {
                    console.log('Closing mobile menu');
                    toggleMobileMenu();
                  }
                }}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                {item.label}
                {item.path === '/approvals' && pendingCount > 0 && (
                  <span className="nav-badge">
                    {pendingCount}
                  </span>
                )}
                {item.path === '/reset-password' && resetPendingCount > 0 && (
                  <span className="nav-badge">
                    {resetPendingCount}
                  </span>
                )}
                {item.path === '/notifications' && unreadCount > 0 && (
                  <span className="nav-badge">
                    {unreadCount}
                  </span>
                )}
              </a>
            </li>
          ))}
          <li>
            <button
              onClick={() => {
                onLogout();
                if (toggleMobileMenu) toggleMobileMenu();
              }}
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
                transition: 'all 0.2s',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
              onMouseOver={(e) => {
                e.target.style.background = 'rgba(239, 68, 68, 0.15)';
                e.target.style.color = 'white';
                e.target.style.transform = 'translateX(4px)';
              }}
              onMouseOut={(e) => {
                e.target.style.background = 'transparent';
                e.target.style.color = 'rgba(255, 255, 255, 0.7)';
                e.target.style.transform = 'translateX(0)';
              }}
            >
              <LogOut size={16} /> Logout
            </button>
          </li>
        </ul>
        <div className="sidebar-footer">
          <div className="sidebar-footer-label">Dikembangkan oleh</div>
          <div className="sidebar-footer-names">Dean Putra & Agus Kariada</div>
          <div className="sidebar-footer-year">© 2026 · Mandara Talenta</div>
        </div>
      </div>
      <div className={`sidebar-overlay ${isMobileMenuOpen ? 'active' : ''}`} onClick={toggleMobileMenu}></div>
    </>
  );
}

export default Navbar;
