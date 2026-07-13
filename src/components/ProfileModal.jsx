import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

function PermissionItem({ label, icon, value }) {
  return (
    <div className="profile-permission">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      <span className="profile-permission-label">{label}</span>
      <span className={`permission-badge ${value === true ? 'granted' : value === false ? 'denied' : 'unknown'}`}>
        {value === true ? 'Granted' : value === false ? 'Denied' : 'Unknown'}
      </span>
    </div>
  );
}

function IntegrationItem({ name, icon, connected, description, onToggle, comingSoon }) {
  return (
    <div className="profile-integration">
      <div className="integration-icon-wrap">
        {icon}
      </div>
      <div className="integration-body">
        <span className="integration-name">{name}</span>
        <span className="integration-desc">{description}</span>
      </div>
      {comingSoon ? (
        <span className="integration-soon">Soon</span>
      ) : onToggle ? (
        <button className={`integration-btn ${connected ? 'connected' : ''}`} onClick={onToggle}>
          {connected ? 'Connected' : 'Connect'}
        </button>
      ) : null}
    </div>
  );
}

export default function ProfileModal({ email, isGuest, onClose, onSignOut }) {
  const [micPermission, setMicPermission] = useState(null);
  const [notifPermission, setNotifPermission] = useState(null);
  const [speakerPermission, setSpeakerPermission] = useState(null);
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => {
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const hasMic = devices.some((d) => d.kind === 'audioinput' && d.label);
        setMicPermission(hasMic);
        const hasSpeaker = devices.some((d) => d.kind === 'audiooutput');
        setSpeakerPermission(hasSpeaker);
      }).catch(() => {
        setMicPermission(false);
        setSpeakerPermission(false);
      });
    } else {
      setMicPermission(null);
      setSpeakerPermission(null);
    }

    if ('Notification' in window) {
      setNotifPermission(Notification.permission === 'granted');
    } else {
      setNotifPermission(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const status = await invoke('google_auth_status');
        setGoogleConnected(status.signedIn);
      } catch {
        setGoogleConnected(false);
      }
    })();
  }, []);

  const handleGoogleToggle = async () => {
    if (googleConnected) {
      try {
        await invoke('google_sign_out');
        setGoogleConnected(false);
      } catch (e) {
        console.error(e);
      }
    } else {
      try {
        await invoke('google_sign_in');
        const status = await invoke('google_auth_status');
        setGoogleConnected(status.signedIn);
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <div className="profile-avatar">{email ? email.charAt(0).toUpperCase() : '?'}</div>
          <div className="profile-heading">
            <span className="profile-email">{email || 'Guest'}</span>
            <span className="profile-method">{isGuest ? 'Guest mode — notes are local only' : 'Signed in with Google'}</span>
          </div>
          <button className="profile-close-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="profile-modal-body">
          <div className="profile-section">
            <h3>Integrations</h3>
            <IntegrationItem
              name="Google Calendar"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              }
              connected={googleConnected}
              description="Sync meetings and create events"
              onToggle={handleGoogleToggle}
            />
            <IntegrationItem
              name="Zoom"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              }
              connected={false}
              description="Auto-join and record Zoom calls"
              comingSoon
            />
            <IntegrationItem
              name="Microsoft Teams"
              icon={
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              }
              connected={false}
              description="Sync Teams meeting transcripts"
              comingSoon
            />
          </div>

          <div className="profile-section">
            <h3>Permissions</h3>
            <PermissionItem
              label="Microphone"
              icon={<><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>}
              value={micPermission}
            />
            <PermissionItem
              label="Notifications"
              icon={<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>}
              value={notifPermission}
            />
            <PermissionItem
              label="Audio Output"
              icon={<><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></>}
              value={speakerPermission}
            />
          </div>
        </div>

        <div className="profile-modal-footer">
          <button className="profile-logout-btn" onClick={onSignOut}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
