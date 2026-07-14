import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { WebviewWindow } from '@tauri-apps/api/window';

export default function MeetingNotification() {
  const params = new URLSearchParams(window.location.search);
  const appName = params.get('app') || 'Meeting';

  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Position window in top-right corner
    (async () => {
      try {
        const win = WebviewWindow.getByLabel('meeting-notif');
        if (win) {
          const monitor = await win.currentMonitor();
          if (monitor) {
            const scale = monitor.scaleFactor;
            const size = monitor.size;
            const pos = monitor.position;
            const x = pos.x / scale + size.width / scale - 400;
            const y = pos.y / scale + 30;
            await win.setPosition({ type: 'Logical', data: { x, y } });
          }
        }
      } catch (_) {}
    })();
  }, []);

  const closeWindow = async () => {
    setClosing(true);
    setTimeout(async () => {
      try {
        const win = WebviewWindow.getByLabel('meeting-notif');
        if (win) await win.close();
      } catch (_) {}
    }, 200);
  };

  const handleRecord = async () => {
    try {
      await invoke('start_recording', { meetingType: 'meeting' });
      const main = WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
        await main.emit('recording-started', {});
      }
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
    closeWindow();
  };

  const handleDismiss = async () => {
    try { await invoke('dismiss_meeting_detection', { appName }); } catch (_) {}
    closeWindow();
  };

  useEffect(() => {
    const timer = setTimeout(() => closeWindow(), 30000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={`notif-window ${closing ? 'closing' : ''}`}>
      <div className="notif-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      </div>
      <div className="notif-body">
        <span className="notif-title">{appName} detected</span>
        <span className="notif-sub">Start recording this meeting?</span>
        <div className="notif-actions">
          <button className="notif-record-btn" onClick={handleRecord}>
            <span className="notif-record-dot" /> Record
          </button>
          <button className="notif-dismiss-btn" onClick={handleDismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
