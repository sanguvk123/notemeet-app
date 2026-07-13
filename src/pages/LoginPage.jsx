import { useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

function NLogo({ size = 48 }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 100 100" fill="none">
      <rect x="2" y="2" width="96" height="96" rx="20" fill="#000" stroke="#2a2a2a" strokeWidth="2"/>
      <line x1="30" y1="25" x2="30" y2="75" stroke="#f5f5f5" strokeWidth="10" strokeLinecap="round"/>
      <line x1="30" y1="75" x2="70" y2="25" stroke="#f5f5f5" strokeWidth="10" strokeLinecap="round"/>
      <line x1="70" y1="25" x2="70" y2="75" stroke="#f5f5f5" strokeWidth="10" strokeLinecap="round"/>
    </svg>
  );
}

function TauriLogin({ onSignedIn }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    try {
      setLoading(true);
      setError('');
      await invoke('google_sign_in');
      const status = await invoke('google_auth_status');
      if (status.signedIn) {
        onSignedIn({ ...status, guest: false });
      } else {
        setError('Sign-in completed but no tokens found. Please try again.');
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  };

  return (
    <>
      <p className="login-tagline">AI-powered meeting notes & transcription</p>
      {error && <div className="login-error">{error}</div>}
      <button className="login-google-btn" onClick={signIn} disabled={loading}>
        {loading ? (
          <span className="login-loading">
            <span className="login-spinner" />
            Connecting...
          </span>
        ) : (
          <span className="login-google-content">
            <svg className="login-google-icon" viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="currentColor" opacity="0.9"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" opacity="0.7"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" opacity="0.5"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" opacity="0.8"/>
            </svg>
            Sign in with Google
          </span>
        )}
      </button>
      <div className="login-divider"><span>or</span></div>
      <button className="login-guest-btn" onClick={() => onSignedIn({ signedIn: false, email: '', guest: true })}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        Continue as Guest
      </button>
      <p className="login-footer">Guest mode: your notes stay local on this device. Sign in with Google for calendar sync and cloud features.</p>
    </>
  );
}

function WebLanding() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('founder');
  const [submitted, setSubmitted] = useState(false);
  const [wlError, setWlError] = useState('');

  const joinWaitlist = async (e) => {
    e.preventDefault();
    setWlError('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(true);
      } else {
        setWlError(data.error || 'Something went wrong');
      }
    } catch {
      setWlError('Could not reach server. Try again later.');
    }
  };

  return (
    <>
      <p className="login-tagline" style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        AI Notepad for Indian Teams
      </p>
      <p className="login-tagline" style={{ fontSize: 14, marginBottom: 8 }}>
        On-device transcription, AI summaries, action items & Google Calendar sync.<br />
        Privacy-first. Works offline.
      </p>

      <div className="wl-section">
        <p className="wl-heading">Get early access</p>
        {submitted ? (
          <p className="wl-success">You're on the list! We'll be in touch.</p>
        ) : (
          <form className="wl-form" onSubmit={joinWaitlist}>
            <div className="wl-row">
              <input className="wl-input" type="email" placeholder="Your email" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
              <select className="wl-select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="founder">Founder</option>
                <option value="engineer">Engineer</option>
                <option value="pm">Product Manager</option>
                <option value="designer">Designer</option>
                <option value="other">Other</option>
              </select>
              <button className="wl-btn" type="submit">Join</button>
            </div>
            {wlError && <p className="wl-error">{wlError}</p>}
          </form>
        )}
      </div>

      <div className="dl-section">
        <a className="dl-btn" href="https://github.com/sanguvk123/notemeet-app/releases/download/v0.1.0-beta/NoteMeet-0.1.0-beta-aarch64.dmg" target="_blank" rel="noopener noreferrer">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download for macOS
        </a>
        <p className="dl-note">macOS 13+ (Apple Silicon) — 39 MB — v0.1.0 beta</p>
      </div>

      <div className="login-divider"><span>features</span></div>

      <div className="feat-grid">
        <div className="feat-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <span>On-device recording</span>
        </div>
        <div className="feat-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>AI summaries & action items</span>
        </div>
        <div className="feat-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span>Google Calendar sync</span>
        </div>
        <div className="feat-item">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          <span>Whisper transcription</span>
        </div>
      </div>

      <p className="login-footer" style={{ marginTop: 4 }}>
        ₹199/mo · Free during beta · No cloud storage required
      </p>
    </>
  );
}

export default function LoginPage({ isWeb, onSignedIn }) {
  return (
    <div className="login-page">
      <div className={`login-card ${isWeb ? 'web-card' : ''}`}>
        <NLogo size={isWeb ? 56 : 48} />
        <h1 className="login-logo">NoteMeet</h1>
        {isWeb ? <WebLanding /> : <TauriLogin onSignedIn={onSignedIn} />}
      </div>
    </div>
  );
}
