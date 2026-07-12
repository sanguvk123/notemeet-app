import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';

export default function MiniRecorder() {
  const [status, setStatus] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    const unsub1 = listen('recording-started', () => {
      setStatus('recording');
      setElapsed(0);
    });
    const unsub2 = listen('note-ready', () => {
      setStatus('idle');
      setElapsed(0);
      clearInterval(timerRef.current);
    });
    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
      clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status === 'recording') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [status]);

  const startRecording = async () => {
    try {
      setStatus('recording');
      setElapsed(0);
      await invoke('start_recording', { meetingType: 'meeting' });
    } catch (e) {
      console.error(e);
      setStatus('idle');
    }
  };

  const stopRecording = async () => {
    try {
      setStatus('processing');
      await invoke('stop_recording', { title: 'Quick Note' });
    } catch (e) {
      console.error(e);
    }
    setStatus('idle');
    setElapsed(0);
  };

  const openMainWindow = async () => {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/window');
      const main = WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mini-recorder" data-status={status}>
      <div className="mini-drag-region" data-tauri-drag-region />

      {status === 'idle' && (
        <button className="mini-record-btn" onClick={startRecording}>
          <span className="mini-record-dot" />
          Record
        </button>
      )}

      {status === 'recording' && (
        <div className="mini-recording-state">
          <div className="mini-indicator">
            <span className="mini-pulse-dot" />
            <span className="mini-label">RECORDING</span>
            <span className="mini-time">{formatTime(elapsed)}</span>
          </div>
          <button className="mini-stop-btn" onClick={stopRecording}>
            ■
          </button>
        </div>
      )}

      {status === 'processing' && (
        <div className="mini-processing">
          <span className="mini-spinner" />
          <span>Processing...</span>
        </div>
      )}

      <button className="mini-open-btn" onClick={openMainWindow} title="Open NoteMeet">
        ⌗
      </button>
    </div>
  );
}
