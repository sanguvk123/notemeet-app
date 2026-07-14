import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/window';
import { formatTime } from './utils';

const MEETING_TYPES = [
  { value: 'meeting', label: 'Meeting', short: 'Mtg' },
  { value: 'call', label: 'Call', short: 'Call' },
  { value: 'standup', label: 'Standup', short: 'Std' },
  { value: 'interview', label: 'Interview', short: 'Int' },
];

export default function MiniRecorder() {
  const [status, setStatus] = useState('idle');
  const [elapsed, setElapsed] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveText, setLiveText] = useState('');
  const [meetingType, setMeetingType] = useState(0);
  const [processStage, setProcessStage] = useState('');
  const [doneNote, setDoneNote] = useState(null);
  const [hovered, setHovered] = useState(false);
  const [animating, setAnimating] = useState(false);
  const timerRef = useRef(null);
  const levelRef = useRef(null);
  const doneTimeoutRef = useRef(null);
  const autoHideRef = useRef(null);
  const autoShown = window.location.search.includes('source=recording');

  useEffect(() => {
    (async () => {
      try {
        const isRec = await invoke('get_recording_state');
        if (isRec) {
          setStatus('recording');
          setElapsed(0);
          triggerAnimIn();
        }
      } catch (_) {}
    })();
  }, []);

  useEffect(() => {
    const unlisteners = [];
    listen('recording-started', () => {
      setStatus('recording');
      setElapsed(0);
      setLiveText('');
      setDoneNote(null);
      triggerAnimIn();
    }).then((f) => unlisteners.push(f));
    listen('note-ready', () => {
      goIdle();
    }).then((f) => unlisteners.push(f));
    listen('transcription-update', (e) => {
      const text = e.payload?.text || '';
      setLiveText((prev) => (prev + ' ' + text).trim());
    }).then((f) => unlisteners.push(f));
    listen('recording-stopped', () => {
      setStatus('processing');
      setLiveText('');
    }).then((f) => unlisteners.push(f));
    listen('processing-stage', (e) => {
      const stage = e.payload?.stage;
      if (stage === 'transcribing') setProcessStage('Transcribing…');
      else if (stage === 'generating') setProcessStage('Generating notes…');
    }).then((f) => unlisteners.push(f));
    return () => { unlisteners.forEach((f) => f()); };
  }, []);

  useEffect(() => {
    if (status === 'recording') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      levelRef.current = setInterval(async () => {
        try {
          const level = await invoke('get_audio_level');
          setAudioLevel(Math.min(1, level * 4));
        } catch (_) {}
      }, 80);
    } else {
      clearInterval(timerRef.current);
      clearInterval(levelRef.current);
      setAudioLevel(0);
    }
    return () => {
      clearInterval(timerRef.current);
      clearInterval(levelRef.current);
    };
  }, [status]);

  useEffect(() => () => { clearTimeout(doneTimeoutRef.current); clearTimeout(autoHideRef.current); }, []);

  const triggerAnimIn = () => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), 400);
  };

  const goIdle = () => {
    setStatus('idle');
    setElapsed(0);
    setLiveText('');
    clearTimeout(doneTimeoutRef.current);
    clearTimeout(autoHideRef.current);
    if (autoShown) {
      autoHideRef.current = setTimeout(() => closeMini(), 2000);
    }
  };

  const startRec = async () => {
    try {
      setStatus('recording');
      setElapsed(0);
      await invoke('start_recording', { meetingType: MEETING_TYPES[meetingType].value });
    } catch (e) {
      console.error(e);
      setStatus('idle');
    }
  };

  const stopRec = async () => {
    try {
      setStatus('processing');
      setProcessStage('Transcribing…');
      const result = await invoke('stop_recording', { title: 'Quick Note' });
      let note = null;
      if (result) {
        try { note = JSON.parse(result); } catch (_) {}
        try {
          const main = WebviewWindow.getByLabel('main');
          if (main) await main.emit('note-ready', result);
        } catch (_) {}
      }
      if (note) {
        setDoneNote(note);
        setStatus('done');
        doneTimeoutRef.current = setTimeout(() => {
          setDoneNote(null);
          goIdle();
        }, 3000);
      } else {
        goIdle();
      }
    } catch (e) {
      console.error(e);
      goIdle();
    }
  };

  const toggle = () => {
    if (status === 'idle' || status === 'done') startRec();
    else if (status === 'recording') stopRec();
  };

  const cycleType = () => {
    setMeetingType((i) => (i + 1) % MEETING_TYPES.length);
  };

  const viewNote = async () => {
    try {
      const main = WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch (_) {}
    clearTimeout(doneTimeoutRef.current);
    setDoneNote(null);
    goIdle();
  };

  const expandToMain = async () => {
    try {
      const main = WebviewWindow.getByLabel('main');
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch (_) {}
  };

  const closeMini = async () => {
    try {
      const win = WebviewWindow.getByLabel('mini-recorder');
      if (win) await win.hide();
    } catch (_) {}
  };

  const lastWords = useCallback(() => {
    const words = liveText.trim().split(/\s+/).filter(Boolean);
    return words.slice(-3).join(' ');
  }, [liveText]);

  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';
  const isDone = status === 'done';
  const isIdle = status === 'idle';

  const recClasses = [
    'mini-window',
    isRecording ? 'recording' : '',
    isProcessing ? 'processing' : '',
    animating ? 'animate-in' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={recClasses}
      onClick={isRecording ? stopRec : undefined}
      title={isRecording ? 'Click to stop recording' : undefined}
    >
      <div className="mini-drag-area" data-tauri-drag-region />

      <button
        className={`mini-toggle ${isRecording ? 'recording' : ''} ${isProcessing ? 'processing' : ''}`}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        disabled={isProcessing}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
      {hovered && isIdle && <span className="mini-shortcut-hint">⌘R</span>}

      <div className="mini-status">
        {isProcessing ? (
          <span className="mini-status-text">{processStage || 'Processing…'}</span>
        ) : isDone && doneNote ? (
          <span className="mini-status-text mini-done-preview" onClick={(e) => { e.stopPropagation(); viewNote(); }}>
            {doneNote.title?.slice(0, 24)} <span className="mini-view-link">View →</span>
          </span>
        ) : isRecording ? (
          <>
            <span className="mini-status-dot live" />
            <span className="mini-time">{formatTime(elapsed)}</span>
            <div className="mini-waveform">
              {[0, 1, 2, 3].map((i) => {
                const base = audioLevel;
                const variance = 0.3 + Math.sin(Date.now() / 80 + i * 1.3) * 0.2;
                const h = Math.max(2, Math.min(14, base * variance * 18 + 2));
                return <span key={i} className="mini-wave-bar" style={{ height: `${h}px` }} />;
              })}
            </div>
          </>
        ) : (
          <>
            <span
              className="mini-type-chip"
              onClick={(e) => { e.stopPropagation(); cycleType(); }}
              title="Click to cycle meeting type"
            >
              {MEETING_TYPES[meetingType].short}
            </span>
            <span className="mini-status-text">Idle</span>
          </>
        )}
      </div>

      {isRecording && lastWords() && (
        <div className="mini-live-text" title={liveText}>{lastWords()}</div>
      )}

      {(isIdle || isDone) && (
        <button className="mini-expand-btn" onClick={(e) => { e.stopPropagation(); expandToMain(); }} title="Open NoteMeet">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
          </svg>
        </button>
      )}

      {isIdle && (
        <button className="mini-close-btn" onClick={(e) => { e.stopPropagation(); closeMini(); }} title="Close">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      )}
    </div>
  );
}
