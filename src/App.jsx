import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const roles = [
  { value: 'meeting', label: 'Meeting', icon: '💼' },
  { value: 'standup', label: 'Standup', icon: '☀️' },
  { value: 'client', label: 'Client Call', icon: '🤝' },
  { value: 'interview', label: 'Interview', icon: '🎯' },
  { value: 'other', label: 'Other', icon: '📝' },
];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 86400000) return 'Today';
  if (diff < 172800000) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function groupByDate(notes) {
  const groups = {};
  for (const n of notes) {
    const key = formatDate(n.date);
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return groups;
}

function ChatPanel({ note, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const noteJson = JSON.stringify(note);
      const reply = await invoke('ask_about_note', { noteJson, question: input, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e}` }]);
    }
    setLoading(false);
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Ask about this note</h3>
        <button className="chat-close" onClick={onClose}>✕</button>
      </div>
      <div className="chat-messages" ref={chatRef}>
        {messages.length === 0 && (
          <div className="chat-welcome">
            Ask questions about this meeting note — summaries, action items, or anything discussed.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-msg-content">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="chat-msg assistant">
            <div className="chat-msg-content">
              <span className="chat-typing">Thinking...</span>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="Ask about this meeting..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
        />
        <button className="chat-send" onClick={sendMessage} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [notes, setNotes] = useState([]);
  const [transcript, setTranscript] = useState('');
  const [selectedNote, setSelectedNote] = useState(null);
  const [meetingType, setMeetingType] = useState('meeting');
  const [title, setTitle] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [playingNoteId, setPlayingNoteId] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const audioRef = useRef(null);
  const timerRef = useRef(null);

  const playAudio = useCallback(async (filePath, noteId) => {
    if (playingNoteId === noteId && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
      setPlayingNoteId(null);
      return;
    }
    try {
      const data = await invoke('read_audio_file', { path: filePath });
      const blob = new Blob([new Uint8Array(data)], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      if (audioRef.current) {
        audioRef.current.src = url;
        audioRef.current.play().catch((e) => console.error('play failed:', e));
      }
      setAudioUrl(url);
      setPlayingNoteId(noteId);
    } catch (e) {
      console.error('read audio error:', e);
    }
  }, [playingNoteId, audioUrl]);

  const handleAudioEnded = useCallback(() => {
    URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setPlayingNoteId(null);
  }, [audioUrl]);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await invoke('load_notes');
        if (saved?.length) setNotes(saved);
      } catch (e) { console.error(e); }
    })();
  }, []);

  useEffect(() => {
    const unsub1 = listen('transcription-update', (e) => {
      setTranscript((prev) => prev + ' ' + e.payload.text);
    });
    const unsub2 = listen('note-ready', (e) => {
      const note = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      setNotes((prev) => [note, ...prev]);
      setSelectedNote(note);
      setProcessing(false);
      setStatus('idle');
    });
    const unsub3 = listen('recording-started', () => {
      setTranscript('');
      setElapsed(0);
      setIsRecording(true);
      setStatus('recording');
    });
    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
      unsub3.then((f) => f());
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
        const note = JSON.parse(result);
        setNotes((prev) => [note, ...prev]);
        setSelectedNote(note);
        setTranscript(note.transcript);
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

  const groups = groupByDate(notes);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo">NoteMeet</div>
          <span className="badge">beta</span>
        </div>

        <div className="sidebar-actions">
          {!isRecording && !processing && (
            <button className="record-btn" onClick={startRecording}>
              <span className="record-dot" />
              New Recording
            </button>
          )}
          {isRecording && (
            <div className="recording-card">
              <div className="recording-indicator">
                <span className="pulse-dot" />
                <span className="rec-time">{formatTime(elapsed)}</span>
              </div>
              <select
                value={meetingType}
                onChange={(e) => setMeetingType(e.target.value)}
                className="type-select"
              >
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Title (optional)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="title-input"
              />
              <button className="stop-btn" onClick={stopRecording}>
                ■ Stop & Generate
              </button>
            </div>
          )}
          {processing && (
            <div className="processing-card">
              <div className="spinner" />
              <p>Transcribing & generating notes...</p>
            </div>
          )}
        </div>

        <div className="notes-list">
          {notes.length === 0 && !isRecording && (
            <div className="empty-notes">
              <span className="empty-icon">🎙️</span>
              <p>Press Record to start your first meeting note</p>
            </div>
          )}
          {Object.entries(groups).map(([dateLabel, dateNotes]) => (
            <div key={dateLabel} className="note-group">
              <div className="note-group-label">{dateLabel}</div>
              {dateNotes.map((note) => (
                <div
                  key={note.id}
                  className={`note-item ${selectedNote?.id === note.id ? 'active' : ''}`}
                  onClick={() => { setSelectedNote(note); setShowChat(false); }}
                >
                  <div className="note-item-title">{note.shortSummary?.slice(0, 60) || note.title}</div>
                  <div className="note-item-meta">
                    <span>{note.meetingType}</span>
                    <span>{note.audioDurationS.toFixed(0)}s</span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>

      <main className="main-content">
        {selectedNote ? (
          <div className="note-detail">
            <div className="note-detail-header">
              <div>
                <h1 className="note-detail-title">{selectedNote.title}</h1>
                <div className="note-detail-meta">
                  <span>{new Date(selectedNote.date).toLocaleString('en-IN')}</span>
                  <span className="meta-dot">·</span>
                  <span>{selectedNote.meetingType}</span>
                  <span className="meta-dot">·</span>
                  <span>{selectedNote.audioDurationS.toFixed(1)}s</span>
                  {selectedNote.speakers?.length > 0 && (
                    <>
                      <span className="meta-dot">·</span>
                      <span>{selectedNote.speakers.length} participants</span>
                    </>
                  )}
                </div>
              </div>
              <div className="detail-actions">
                {selectedNote.audioFile && (
                  <button
                    className={`play-btn ${playingNoteId === selectedNote.id ? 'playing' : ''}`}
                    onClick={() => playAudio(selectedNote.audioFile, selectedNote.id)}
                  >
                    {playingNoteId === selectedNote.id ? '⏹ Stop' : '▶ Play'}
                  </button>
                )}
                <button
                  className={`chat-btn ${showChat ? 'active' : ''}`}
                  onClick={() => setShowChat(!showChat)}
                >
                  💬 Ask AI
                </button>
              </div>
            </div>

            <div className={`note-detail-body ${showChat ? 'with-chat' : ''}`}>
              <div className="note-content">
                <section className="detail-section">
                  <h3>Summary</h3>
                  <p className="detail-short">{selectedNote.shortSummary}</p>
                </section>

                <section className="detail-section">
                  <h3>Full Notes</h3>
                  <p className="detail-full">{selectedNote.fullSummary}</p>
                </section>

                {selectedNote.speakers?.length > 0 && (
                  <section className="detail-section">
                    <h3>Participants</h3>
                    <div className="speaker-list">
                      {selectedNote.speakers.map((s, i) => (
                        <span key={i} className="speaker-tag">{s}</span>
                      ))}
                    </div>
                  </section>
                )}

              {selectedNote.tone && (
                <section className="detail-section">
                  <h3>Meeting Tone</h3>
                  <p className="detail-short" style={{ color: 'var(--accent)' }}>{selectedNote.tone}</p>
                </section>
              )}

              {selectedNote.speakerTone && Object.keys(selectedNote.speakerTone).length > 0 && (
                <section className="detail-section">
                  <h3>Speaker Emotions</h3>
                  <div className="speaker-list">
                    {Object.entries(selectedNote.speakerTone).map(([name, tone], i) => (
                      <span key={i} className="speaker-tag" title={tone}>
                        {name}: {tone}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {selectedNote.actionItems?.length > 0 && (
                <section className="detail-section">
                  <h3>Action Items</h3>
                    <ul className="detail-list">
                      {selectedNote.actionItems.map((item, i) => (
                        <li key={i} className="action-item">{item}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {selectedNote.promises?.length > 0 && (
                  <section className="detail-section">
                    <h3>Promises & Commitments</h3>
                    <ul className="detail-list">
                      {selectedNote.promises.map((item, i) => (
                        <li key={i} className="promise-item">{item}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="detail-section transcript-section">
                  <h3>Transcript</h3>
                  <div className="transcript-content">
                    {transcript && selectedNote?.id === notes[0]?.id
                      ? transcript
                      : selectedNote.transcript}
                  </div>
                </section>
              </div>

              {showChat && (
                <ChatPanel note={selectedNote} onClose={() => setShowChat(false)} />
              )}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">🎙️</div>
            <h2>Welcome to NoteMeet</h2>
            <p>Select a note from the sidebar or press Record to start a new meeting</p>
            {!isRecording && (
              <button className="record-btn empty-record" onClick={startRecording}>
                <span className="record-dot" />
                Start Recording
              </button>
            )}
          </div>
        )}
      </main>

      <audio ref={audioRef} onEnded={handleAudioEnded} style={{ display: 'none' }} />
    </div>
  );
}
