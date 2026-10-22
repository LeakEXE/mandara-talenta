import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Login from './components/Login';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import FirstLoginSetup from './components/FirstLoginSetup';
import Dashboard from './components/Dashboard';
import Navbar from './components/Navbar';
import InputPrestasi from './components/InputPrestasi';
import InputOrganisasi from './components/InputOrganisasi';
import InputKepanitiaan from './components/InputKepanitiaan';
import InputEvent from './components/InputEvent';
import InputPelanggaran from './components/InputPelanggaran';
import InputPerilaku from './components/InputPerilaku';
import KelolaAkun from './components/KelolaAkun';
import IzinAkun from './components/IzinAkun';
import Leaderboard from './components/Leaderboard';
import Profile from './components/Profile';
import Logs from './components/Logs';
import WaliKelas from './components/WaliKelas';
import TeacherWaliKelas from './components/TeacherWaliKelas';
import Approvals from './components/Approvals';
import DriveViewer from './components/DriveViewer';
import Notifications from './components/Notifications';
import LaporanCetak from './components/LaporanCetak';
import KonfigurasiIPT from './components/KonfigurasiIPT';
import SchoolConfig from './components/SchoolConfig';
import StudentLookup from './components/StudentLookup';
import api from './utils/api';
import { Menu, X } from 'lucide-react';

function ProtectedRoute({ children, allowedRoles }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const userData = localStorage.getItem('user');
    
    console.log('ProtectedRoute - UserData:', userData);
    
    if (!userData) {
      console.log('Redirecting to login - no user data');
      navigate('/login');
      return;
    }

    const parsedUser = JSON.parse(userData);
    console.log('ProtectedRoute - ParsedUser:', parsedUser);
    
    if (allowedRoles && !allowedRoles.includes(parsedUser.role)) {
      console.log('Redirecting to dashboard - role not allowed');
      navigate('/dashboard');
      return;
    }

    // First-login enforcement: flagged users must finish account setup.
    // The backend gates every /api call the same way.
    if (parsedUser.must_change_credentials && location.pathname !== '/setup-akun') {
      navigate('/setup-akun');
      return;
    }
    if (!parsedUser.must_change_credentials && location.pathname === '/setup-akun') {
      navigate('/dashboard');
      return;
    }

    // Use stored user data immediately, then fetch fresh data in background
    setUser(parsedUser);
    setLoading(false);

    // Fetch fresh user data from server to get latest wali_kelas status (background)
    const fetchFreshUserData = async () => {
      try {
        const response = await api.get('/profile');
        
        // Merge fresh data with existing user data
        const freshUser = { ...parsedUser, ...response.data };
        console.log('ProtectedRoute - FreshUser:', freshUser);
        
        // Update localStorage with fresh data
        localStorage.setItem('user', JSON.stringify(freshUser));
        setUser(freshUser);

        // A role change/demotion takes effect immediately in the UI too, not
        // just in backend authorization.
        if (allowedRoles && !allowedRoles.includes(freshUser.role)) {
          navigate('/dashboard');
          return;
        }

        // Fresh flag wins over stale storage (e.g. sessions from before the rollout)
        if (freshUser.must_change_credentials && location.pathname !== '/setup-akun') {
          navigate('/setup-akun');
          return;
        }
        if (!freshUser.must_change_credentials && location.pathname === '/setup-akun') {
          navigate('/dashboard');
          return;
        }
      } catch (error) {
        console.error('Error fetching fresh user data:', error);
        // If auth fails, redirect to login
        if (error.response?.status === 401) {
          localStorage.removeItem('user');
          navigate('/login');
        }
        // Keep using stored data if fetch fails for other reasons
      }
    };

    fetchFreshUserData();
  }, [navigate, allowedRoles, location.pathname]);

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return children(user);
}

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/lupa-password" element={<ForgotPassword />} />
        <Route path="/setup-akun" element={
          <ProtectedRoute>
            {() => <FirstLoginSetup />}
          </ProtectedRoute>
        } />
        <Route path="/" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><Dashboard /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/dashboard" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><Dashboard /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-prestasi" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputPrestasi /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-organisasi" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputOrganisasi /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-kepanitiaan" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputKepanitiaan /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-event" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputEvent /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-pelanggaran" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputPelanggaran /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/input-perilaku" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><InputPerilaku /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/leaderboard" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><Leaderboard /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/profile" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><Profile /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/kelola-akun" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><KelolaAkun /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/reset-password" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><ResetPassword /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/izin-akun" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><IzinAkun /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/logs" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><Logs /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/wali-kelas" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><WaliKelas /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/wali-kelas-guru" element={
          <ProtectedRoute allowedRoles={['guru', 'pegawai']}>
            {(user) => <MainLayout user={user}><TeacherWaliKelas /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/approvals" element={
          <ProtectedRoute>
            {(user) => <MainLayout user={user}><Approvals /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/drive-viewer" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><DriveViewer /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/notifications" element={
          <ProtectedRoute allowedRoles={['siswa', 'guru', 'pegawai']}>
            {(user) => <MainLayout user={user}><Notifications /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/laporan-cetak" element={
          <ProtectedRoute>
            {(user) => {
              // Allow superadmin always, but for guru only if they are wali kelas
              if (user.role === 'superadmin' || ((user.role === 'guru' || user.role === 'pegawai') && user.wali_kelas)) {
                return <MainLayout user={user}><LaporanCetak user={user} /></MainLayout>;
              }
              return <MainLayout user={user}><Dashboard /></MainLayout>;
            }}
          </ProtectedRoute>
        } />
        <Route path="/konfigurasi-ipt" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><KonfigurasiIPT /></MainLayout>}
          </ProtectedRoute>
        } />
        {/* Deprecated alias: pre-rebrand bookmarks still use /konfigurasi-ipc. */}
        <Route path="/konfigurasi-ipc" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><KonfigurasiIPT /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/cari-siswa" element={
          <ProtectedRoute allowedRoles={['superadmin', 'guru', 'pegawai']}>
            {(user) => <MainLayout user={user}><StudentLookup /></MainLayout>}
          </ProtectedRoute>
        } />
        <Route path="/school-config" element={
          <ProtectedRoute allowedRoles={['superadmin']}>
            {(user) => <MainLayout user={user}><SchoolConfig /></MainLayout>}
          </ProtectedRoute>
        } />
      </Routes>
    </Router>
  );
}

function MainLayout({ user, children }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      // Call backend logout endpoint to clear HTTP-only cookie
      await api.post('/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      // Clear local storage regardless of API call success
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(prev => {
      console.log('toggleMobileMenu called, current state:', prev, 'new state:', !prev);
      return !prev;
    });
  };

  console.log('MainLayout - User:', user, 'MobileMenuOpen:', isMobileMenuOpen);

  return (
    <div className="main-layout">
      <div className="mobile-header">
        <button className="mobile-menu-toggle" onClick={toggleMobileMenu} aria-label="Menu navigasi">
          {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <span className="mobile-header-title">Mandara Talenta</span>
      </div>
      <Navbar user={user} onLogout={handleLogout} isMobileMenuOpen={isMobileMenuOpen} toggleMobileMenu={toggleMobileMenu} />
      <div className="content">
        <div className="container">
          {children}
        </div>
      </div>
    </div>
  );
}

export default App;
