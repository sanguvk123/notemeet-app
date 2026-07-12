import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const roles = [
  { value: 'meeting', label: 'Meeting', icon: '💼' },
  { value: 'standup', label: 'Standup', icon: '☀️' },
  { value: 'client', label: 'Client Call', icon: '🤝' },
  { value: 'interview', label: 'Interview', icon: '🎯' },
  { value: 'other', label: 'Other', icon: '📝' },
];

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [notes, setNotes] = useState([]);
  const [transcript, setTranscript] = useState('');
  const [meetingType, setMeetingType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);

  const timerRef = useRef(null);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        setElapsed((e) => e + 1);
      }, 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  useEffect(() => {
    const unlisten = listen('transcription-update', (event) => {
      setTranscript((prev) => prev + ' ' + event.payload.text);
    });
    const unlisten2 = listen('note-ready', (event) => {
      setNotes((prev) => [event.payload, ...prev]);
      setProcessing(false);
      setStatus('idle');
    });
    return () => {
      unlisten.then((f) => f());
      unlisten2.then((f) => f());
    };
  }, []);

  const startRecording = async () => {
    try {
      setStatus('recording');
      setIsRecording(true);
      setTranscript('');
      setElapsed(0);
      await invoke('start_recording', { meetingType });
    } catch (e) {
      console.error(e);
      setStatus('idle');
    }
  };

  const stopRecording = async () => {
    try {
      setIsRecording(false);
      setProcessing(true);
      setStatus('processing');
      const result = await invoke('stop_recording', { title: title || 'Untitled Meeting' });
      if (result) {
        setNotes((prev) => [JSON.parse(result), ...prev]);
      }
    } catch (e) {
      console.error(e);
    }
    setProcessing(false);
    setStatus('idle');
    setTitle('');
  };

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo">NoteMeet</div>
        <div className="header-actions">
          <button className="mini-toggle-btn" onClick={() => invoke('create_mini_window')} title="Mini Recorder">
            ⊞ Mini
          </button>
          <span className="badge">v0.1 beta</span>
        </div>
      </header>

      <main className="main">
        <div className="controls">
          <div className="controls-header">
            <h2>New Recording</h2>
            <select
              value={meetingType}
              onChange={(e) => setMeetingType(e.target.value)}
              className="type-select"
              disabled={isRecording}
            >
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.icon} {r.label}
                </option>
              ))}
            </select>
          </div>

          <input
            type="text"
            placeholder="Meeting title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="title-input"
            disabled={isRecording}
          />

          <div className="record-area">
            {!isRecording && !processing && (
              <button className="record-btn" onClick={startRecording}>
                <span className="record-icon">●</span>
                <span>Start Recording</span>
              </button>
            )}

            {isRecording && (
              <div className="recording-active">
                <div className="recording-indicator">
                  <span className="pulse-dot"></span>
                  <span className="rec-time">{formatTime(elapsed)}</span>
                </div>
                <div className="waveform">
                  {Array.from({ length: 40 }).map((_, i) => (
                    <div
                      key={i}
                      className="wave-bar"
                      style={{
                        height: `${Math.random() * 40 + 4}px`,
                        animationDelay: `${i * 0.05}s`,
                      }}
                    />
                  ))}
                </div>
                <button className="stop-btn" onClick={stopRecording}>
                  ■ Stop & Generate Notes
                </button>
              </div>
            )}

            {processing && (
              <div className="processing">
                <div className="spinner"></div>
                <p>Transcribing & generating notes...</p>
              </div>
            )}
          </div>

          <div className="status-bar">
            <div className={`status-dot ${status}`}></div>
            <span>
              {status === 'idle' && 'Ready'}
              {status === 'recording' && 'Recording...'}
              {status === 'processing' && 'Processing...'}
            </span>
          </div>
        </div>

        <div className="transcript-panel">
          <h3>Live Transcript</h3>
          <div className="transcript-content">
            {transcript || <span className="placeholder">Start recording to see transcript...</span>}
          </div>
        </div>

        <div className="notes-panel">
          <h3>Recent Notes</h3>
          {notes.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <p>Your AI-generated notes will appear here</p>
            </div>
          ) : (
            <div className="notes-list">
              {notes.map((note, i) => (
                <div key={i} className="note-card">
                  <div className="note-header">
                    <strong>{note.title}</strong>
                    <span className="note-date">{new Date(note.date).toLocaleDateString()}</span>
                  </div>
                  <div className="note-summary">{note.summary}</div>
                  {note.actionItems && note.actionItems.length > 0 && (
                    <div className="note-actions">
                      <strong>Action Items:</strong>
                      <ul>
                        {note.actionItems.map((item, j) => (
                          <li key={j}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
