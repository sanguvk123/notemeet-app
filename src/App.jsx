import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { NoteProvider } from './context/NoteContext';
import HomePage from './pages/HomePage';
import NotesPage from './pages/NotesPage';
import CalendarPage from './pages/CalendarPage';
import LoginPage from './pages/LoginPage';
import ProfileModal from './components/ProfileModal';

let isTauriEnv = null;
async function detectTauri() {
  if (isTauriEnv !== null) return isTauriEnv;
  try {
    await invoke('google_auth_status');
    isTauriEnv = true;
  } catch {
    isTauriEnv = false;
  }
  return isTauriEnv;
}

function Layout({ email, isGuest, onSignOut, onSignIn }) {
  const [showProfile, setShowProfile] = useState(false);

  return (
    <div className="app">
      {showProfile && (
        <ProfileModal email={email} isGuest={isGuest} onClose={() => setShowProfile(false)}
          onSignOut={() => { setShowProfile(false); onSignOut(); }} />
      )}
      <nav className="nav-sidebar">
        <div className="nav-header">
          <svg width="28" height="28" viewBox="0 0 100 100" fill="none">
            <rect x="2" y="2" width="96" height="96" rx="20" fill="#000" stroke="var(--border2)" strokeWidth="2"/>
            <line x1="30" y1="25" x2="30" y2="75" stroke="var(--text)" strokeWidth="10" strokeLinecap="round"/>
            <line x1="30" y1="75" x2="70" y2="25" stroke="var(--text)" strokeWidth="10" strokeLinecap="round"/>
            <line x1="70" y1="25" x2="70" y2="75" stroke="var(--text)" strokeWidth="10" strokeLinecap="round"/>
          </svg>
        </div>
        <div className="nav-links">
          <NavLink to="/home" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Home</span>
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>Notes</span>
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>Calendar</span>
          </NavLink>
        </div>
        <div className="nav-footer">
          <button className="nav-profile-btn" onClick={() => setShowProfile(true)} title="Profile & Settings">
            {isGuest ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            ) : (
              <span className="nav-user-avatar">{email.charAt(0).toUpperCase()}</span>
            )}
          </button>
          <button className="mini-launch-btn" onClick={() => invoke('create_mini_window')} title="Open Mini Recorder">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
          </button>
        </div>
      </nav>
      <div className="page-area">
        <Routes>
          <Route path="/home" element={<HomePage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/calendar" element={<CalendarPage isGuest={isGuest} />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ checking: true, signedIn: false, guest: false, email: '' });
  const [isWeb, setIsWeb] = useState(null);

  useEffect(() => {
    (async () => {
      const web = !(await detectTauri());
      setIsWeb(web);
      if (!web) {
        try {
          const status = await invoke('google_auth_status');
          setAuth({ checking: false, signedIn: status.signedIn, guest: false, email: status.email || '' });
          return;
        } catch (_) {}
      }
      setAuth({ checking: false, signedIn: false, guest: false, email: '' });
    })();
  }, []);

  if (auth.checking) {
    return (
      <div className="login-loading-screen">
        <div className="login-spinner" />
      </div>
    );
  }

  if (isWeb || (!auth.signedIn && !auth.guest)) {
    return (
      <LoginPage isWeb={isWeb} onSignedIn={(status) => {
        if (isWeb) return;
        setAuth({ checking: false, signedIn: status.signedIn, guest: !!status.guest, email: status.email || '' });
      }} />
    );
  }

  return (
    <NoteProvider>
      <Layout email={auth.email} isGuest={auth.guest} onSignIn={() => setAuth({ checking: false, signedIn: false, guest: false, email: '' })}
        onSignOut={async () => {
          try { await invoke('google_sign_out'); } catch (_) {}
          setAuth({ checking: false, signedIn: false, guest: false, email: '' });
        }} />
    </NoteProvider>
  );
}
