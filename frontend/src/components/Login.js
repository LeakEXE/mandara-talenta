import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../utils/api';
import InstallAppButton from './InstallAppButton';

// Default support link shown on the login page when school config has none set.
const DEFAULT_SUPPORT_LINK = 'https://google.com';

function Login() {
  const [formData, setFormData] = useState({
    username: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [loading, setLoading] = useState(false);
  const [schoolConfig, setSchoolConfig] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSchoolConfig = async () => {
      try {
        const response = await api.get('/school-config/public');
        setSchoolConfig(response.data);
      } catch (error) {
        console.error('Error fetching school config:', error);
      }
    };

    fetchSchoolConfig();
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', formData);
      
      // Store user data in localStorage (not token - token is now in HTTP-only cookie)
      localStorage.setItem('user', JSON.stringify(response.data.user));
      
      navigate(response.data.user.must_change_credentials ? '/setup-akun' : '/dashboard');
    } catch (error) {
      const status = error.response?.status;
      const headers = error.response?.headers || {};
      // express-rate-limit sends RateLimit-Remaining (max 5 / 15 menit, sukses tidak dihitung)
      if (headers['ratelimit-remaining'] !== undefined) {
        const remaining = parseInt(headers['ratelimit-remaining'], 10);
        if (!Number.isNaN(remaining)) {
          setAttemptsLeft(Math.max(0, remaining));
        }
      }
      if (status === 429) {
        const resetSec = parseInt(headers['ratelimit-reset'] || '900', 10);
        const mins = Number.isNaN(resetSec) ? 15 : Math.max(1, Math.ceil(resetSec / 60));
        setError(`Terlalu banyak percobaan login. Coba lagi dalam ±${mins} menit.`);
      } else {
        setError(error.response?.data?.message || 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflowX: 'hidden',
      background: 'radial-gradient(circle at 20% 20%, rgba(108,127,216,.55), transparent 45%), radial-gradient(circle at 82% 78%, rgba(122,94,199,.55), transparent 50%), linear-gradient(150deg, #6c7fd8 0%, #7a6bcf 45%, #7c4fb0 100%)'
    }}>
      {/* Background Orbs */}
      <div style={{
        position: 'fixed',
        borderRadius: '50%',
        filter: 'blur(60px)',
        opacity: '.35',
        pointerEvents: 'none',
        zIndex: 0,
        width: '340px',
        height: '340px',
        top: '-100px',
        left: '-90px',
        background: '#a6b4ff',
        animation: 'driftA 14s ease-in-out infinite'
      }}></div>
      <div style={{
        position: 'fixed',
        borderRadius: '50%',
        filter: 'blur(60px)',
        opacity: '.35',
        pointerEvents: 'none',
        zIndex: 0,
        width: '280px',
        height: '280px',
        bottom: '-90px',
        right: '-70px',
        background: '#5b3f9c',
        animation: 'driftB 16s ease-in-out infinite'
      }}></div>

      <style>{`
        @keyframes driftA {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(40px, 30px) scale(1.1); }
        }
        @keyframes driftB {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-30px, -25px) scale(1.15); }
        }
        @keyframes cardIn {
          from { opacity: 0; transform: translateY(18px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div style={{
        position: 'relative',
        zIndex: 1,
        width: '100%',
        maxWidth: '400px',
        background: '#fff',
        borderRadius: '20px',
        padding: 'clamp(1.8rem, 4vw, 2.6rem)',
        boxShadow: '0 25px 60px -15px rgba(20,20,60,.45)',
        animation: 'cardIn .7s cubic-bezier(.2,.9,.25,1) both',
        transform: 'none',
        transition: 'transform 0.1s'
      }}>
        {/* Logo / Brand */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          marginBottom: '2.2rem'
        }}>
          <div style={{
            width: '64px',
            height: '64px',
            marginBottom: '.9rem',
            filter: 'drop-shadow(0 6px 14px rgba(40,57,107,.25))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {schoolConfig?.logo_url ? (
              <img
                src={schoolConfig.logo_url}
                alt="Logo Sekolah"
                style={{
                  maxWidth: '64px',
                  maxHeight: '64px',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'contain'
                }}
              />
            ) : (
              <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{ width: '64px', height: '64px' }}>
                <circle cx="50" cy="50" r="44" stroke="#28396b" strokeWidth="2.2" fill="none"/>
                <path d="M28 38 C 28 34, 34 32, 50 32 C 66 32, 72 34, 72 38 L 72 64 C 72 60, 66 58, 50 58 C 34 58, 28 60, 28 64 Z" stroke="#28396b" strokeWidth="2" fill="none"/>
                <path d="M50 32 L50 58" stroke="#28396b" strokeWidth="1.6" fill="none"/>
                <path d="M30 66 C 22 62, 20 50, 24 40 C 20 48, 22 58, 30 66 Z" stroke="#28396b" strokeWidth="1.6" fill="none"/>
                <path d="M70 66 C 78 62, 80 50, 76 40 C 80 48, 78 58, 70 66 Z" stroke="#28396b" strokeWidth="1.6" fill="none"/>
              </svg>
            )}
          </div>
          <h1 style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: '600',
            fontSize: '1.5rem',
            margin: '0',
            color: '#1c2333'
          }}>
            Mandara Talenta
          </h1>
          <p style={{
            margin: '.25rem 0 0',
            fontSize: '.86rem',
            color: '#5b6478'
          }}>
            Individual Point Talent
          </p>
        </div>

        <div style={{
          marginBottom: '1rem',
          padding: '0.65rem 0.75rem',
          background: attemptsLeft !== null && attemptsLeft <= 1 ? '#fef2f2' : '#fffbeb',
          border: attemptsLeft !== null && attemptsLeft <= 1 ? '1px solid #fecaca' : '1px solid #fde68a',
          borderRadius: '8px',
          color: attemptsLeft !== null && attemptsLeft <= 1 ? '#b91c1c' : '#92400e',
          fontSize: '0.82rem',
          fontWeight: '600',
          textAlign: 'center'
        }}>
          {attemptsLeft !== null
            ? (attemptsLeft <= 0
              ? 'Kesempatan login habis. Tunggu sebelum mencoba lagi.'
              : `Tersisa ${attemptsLeft} percobaan login`)
            : 'Demi keamanan, login dibatasi 5x percobaan per 15 menit.'}
        </div>

        {error && (
          <div style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            background: '#fee',
            border: '1px solid #fcc',
            borderRadius: '8px',
            color: '#c33',
            fontSize: '0.9rem',
            textAlign: 'center'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              name="username"
              value={formData.username}
              onChange={handleChange}
              placeholder=" "
              required
              autoComplete="username"
              style={{
                width: '100%',
                padding: '1.15rem .95rem .5rem',
                fontFamily: 'var(--font-sans)',
                fontSize: '.98rem',
                border: '1.5px solid #e1ddd0',
                borderRadius: '10px',
                background: '#fbfaf6',
                color: '#1c2333',
                outline: 'none',
                transition: 'border-color .25s ease',
                borderColor: formData.username ? '#354a86' : '#e1ddd0'
              }}
            />
            <label style={{
              position: 'absolute',
              left: '.95rem',
              top: formData.username ? '.5rem' : '1.05rem',
              fontSize: formData.username ? '.68rem' : '.98rem',
              color: formData.username ? '#28396b' : '#5b6478',
              pointerEvents: 'none',
              transition: 'all .2s cubic-bezier(.4, 0, .2, 1)',
              fontWeight: formData.username ? '600' : 'normal',
              letterSpacing: '.03em',
              transform: formData.username ? 'translateY(-2px)' : 'translateY(0)'
            }}>
              Username
            </label>
          </div>

          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder=" "
              required
              autoComplete="current-password"
              style={{
                width: '100%',
                padding: '1.15rem .95rem .5rem',
                fontFamily: 'var(--font-sans)',
                fontSize: '.98rem',
                border: '1.5px solid #e1ddd0',
                borderRadius: '10px',
                background: '#fbfaf6',
                color: '#1c2333',
                outline: 'none',
                transition: 'border-color .25s ease',
                borderColor: formData.password ? '#354a86' : '#e1ddd0'
              }}
            />
            <label style={{
              position: 'absolute',
              left: '.95rem',
              top: formData.password ? '.5rem' : '1.05rem',
              fontSize: formData.password ? '.68rem' : '.98rem',
              color: formData.password ? '#28396b' : '#5b6478',
              pointerEvents: 'none',
              transition: 'all .2s cubic-bezier(.4, 0, .2, 1)',
              fontWeight: formData.password ? '600' : 'normal',
              letterSpacing: '.03em'
            }}>
              Password
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: '.7rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '.35rem',
                color: '#5b6478',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color .2s ease'
              }}
              onMouseEnter={(e) => e.target.style.color = '#28396b'}
              onMouseLeave={(e) => e.target.style.color = '#5b6478'}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: '18px', height: '18px' }}>
                  <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.6 10.6 0 0 1 12 5c7 0 11 7 11 7a13.2 13.2 0 0 1-3.4 3.9M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7c1.4 0 2.7-.3 3.9-.9"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ width: '18px', height: '18px' }}>
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              position: 'relative',
              marginTop: '.2rem',
              padding: '.95rem 1rem',
              border: 'none',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #6c7fd8, #28396b)',
              color: '#fff',
              fontFamily: 'var(--font-sans)',
              fontWeight: '700',
              fontSize: '.98rem',
              letterSpacing: '.02em',
              cursor: loading ? 'not-allowed' : 'pointer',
              overflow: 'hidden',
              transition: 'transform .15s ease, box-shadow .25s ease',
              boxShadow: '0 10px 22px rgba(53,74,134,.35)',
              opacity: loading ? 0.7 : 1
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 12px 26px rgba(53,74,134,.42)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 10px 22px rgba(53,74,134,.35)';
            }}
          >
            <span style={{ display: 'inline-flex', visibility: loading ? 'hidden' : 'visible', alignItems: 'center', gap: '.5rem' }}>
              Login
            </span>
            {loading && (
              <span style={{
                display: 'block',
                position: 'absolute',
                left: '50%',
                top: '50%',
                margin: '-8px 0 0 -8px',
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,.35)',
                borderTopColor: '#fff',
                animation: 'spin .7s linear infinite'
              }}></span>
            )}
          </button>

          <p style={{
            textAlign: 'center',
            fontSize: '.85rem',
            color: '#5b6478',
            marginTop: '.4rem'
          }}>
            <Link to="/lupa-password" style={{ color: '#28396b', fontWeight: '600', textDecoration: 'none' }}>Lupa password?</Link>
          </p>

          <p style={{
            textAlign: 'center',
            fontSize: '.85rem',
            color: '#5b6478',
            marginTop: '.4rem',
            marginBottom: 0
          }}>
            Butuh bantuan? <a href={schoolConfig?.support_link || DEFAULT_SUPPORT_LINK} style={{ color: '#28396b', fontWeight: '600', textDecoration: 'none' }}>Hubungi admin sekolah</a>
          </p>
          <p style={{
            textAlign: 'center',
            fontSize: '.85rem',
            color: '#5b6478',
            marginTop: '.4rem',
            marginBottom: 0
          }}>
            <InstallAppButton />
          </p>
        </form>
      </div>
      <div style={{
        position: 'relative',
        zIndex: 1,
        marginTop: '18px',
        textAlign: 'center',
        color: 'rgba(255,255,255,.75)',
        fontSize: '.78rem',
        lineHeight: 1.6
      }}>
        <div>Dikembangkan oleh <strong style={{ color: '#fff' }}>Dean Putra & Agus Kariada</strong></div>
        <div>© 2026 · Mandara Talenta</div>
      </div>
    </div>
  );
}

export default Login;
