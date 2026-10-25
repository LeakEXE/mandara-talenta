import React, { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import api from './utils/api';
import { Menu, X } from 'lucide-react';

const Login = lazy(() => import('./components/Login'));
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const FirstLoginSetup = lazy(() => import('./components/FirstLoginSetup'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const InputPrestasi = lazy(() => import('./components/InputPrestasi'));
const InputOrganisasi = lazy(() => import('./components/InputOrganisasi'));
const InputKepanitiaan = lazy(() => import('./components/InputKepanitiaan'));
const InputEvent = lazy(() => import('./components/InputEvent'));
const InputPelanggaran = lazy(() => import('./components/InputPelanggaran'));
const InputPerilaku = lazy(() => import('./components/InputPerilaku'));
const KelolaAkun = lazy(() => import('./components/KelolaAkun'));
const IzinAkun = lazy(() => import('./components/IzinAkun'));
const Leaderboard = lazy(() => import('./components/Leaderboard'));
const Profile = lazy(() => import('./components/Profile'));
const Logs = lazy(() => import('./components/Logs'));
const WaliKelas = lazy(() => import('./components/WaliKelas'));
const TeacherWaliKelas = lazy(() => import('./components/TeacherWaliKelas'));
const Approvals = lazy(() => import('./components/Approvals'));
const DriveViewer = lazy(() => import('./components/DriveViewer'));
const Notifications = lazy(() => import('./components/Notifications'));
const LaporanCetak = lazy(() => import('./components/LaporanCetak'));
const KonfigurasiIPT = lazy(() => import('./components/KonfigurasiIPT'));
const SchoolConfig = lazy(() => import('./components/SchoolConfig'));
const StudentLookup = lazy(() => import('./components/StudentLookup'));

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
      <Suspense fallback={<div className="loading"><div className="spinner"></div></div>}>
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
          <ProtectedRoute allowedRoles={['siswa', 'guru', 'pegawai', 'superadmin']}>
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
      </Suspense>
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
