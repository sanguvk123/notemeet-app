import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

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
    });
    const unsub3 = listen('recording-stopped', () => {
      setStatus('processing');
    });
    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
      unsub3.then((f) => f());
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

  const toggle = async () => {
    if (status === 'idle') {
      try {
        setStatus('recording');
        setElapsed(0);
        await invoke('start_recording', { meetingType: 'meeting' });
      } catch (e) {
        console.error(e);
        setStatus('idle');
      }
    } else if (status === 'recording') {
      try {
        setStatus('processing');
        const result = await invoke('stop_recording', { title: 'Quick Note' });
        setStatus('idle');
        setElapsed(0);
        if (result) {
          try {
            const { WebviewWindow } = await import('@tauri-apps/api/window');
            const main = WebviewWindow.getByLabel('main');
            if (main) {
              await main.emit('note-ready', result);
            }
          } catch (_) {}
        }
      } catch (e) {
        console.error(e);
        setStatus('idle');
      }
    }
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';

  return (
    <div className="mini-window">
      <div className="mini-drag-area" data-tauri-drag-region />
      <button
        className={`mini-toggle ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
        onClick={toggle}
        disabled={isProcessing}
        title={isRecording ? 'Stop & Generate' : 'Start Recording'}
      >
        {isProcessing ? (
          <span className="mini-spinner" />
        ) : isRecording ? (
          <span className="mini-stop-icon" />
        ) : (
          <span className="mini-play-icon" />
        )}
      </button>
      <div className="mini-status">
        {isProcessing ? (
          <span className="mini-status-text">Processing...</span>
        ) : (
          <>
            <span className={`mini-status-dot ${isRecording ? 'live' : ''}`} />
            <span className="mini-status-text">
              {isRecording ? `Recording ${formatTime(elapsed)}` : 'Idle'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
