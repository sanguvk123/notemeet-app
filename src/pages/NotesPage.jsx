import { useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';
import { groupByDate, formatTime } from '../utils';
import ChatPanel from '../components/ChatPanel';

const roles = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'standup', label: 'Standup' },
  { value: 'client', label: 'Client Call' },
  { value: 'interview', label: 'Interview' },
  { value: 'other', label: 'Other' },
];

export default function NotesPage() {
  const { notes, isRecording, status, transcript, elapsed, meetingType, setMeetingType, startRecording, stopRecording } = useNotes();
  const [selectedNote, setSelectedNote] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [playingNoteId, setPlayingNoteId] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [title, setTitle] = useState('');
  const audioRef = useRef(null);

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

  const handleStop = async () => {
    setProcessing(true);
    await stopRecording(title || 'Untitled Meeting');
    setProcessing(false);
    setTitle('');
  };

  const groups = groupByDate(notes);

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-actions">
          {!isRecording && !processing && (
            <button className="record-btn" onClick={() => startRecording()}>
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
              <select value={meetingType} onChange={(e) => setMeetingType(e.target.value)} className="type-select">
                {roles.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <input
                type="text" placeholder="Title (optional)" value={title}
                onChange={(e) => setTitle(e.target.value)} className="title-input"
              />
              <button className="stop-btn" onClick={handleStop}>Stop & Generate</button>
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
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
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
                    {playingNoteId === selectedNote.id ? 'Stop' : 'Play'}
                  </button>
                )}
                <button
                  className={`chat-btn ${showChat ? 'active' : ''}`}
                  onClick={() => setShowChat(!showChat)}
                >
                  Ask AI
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
                        <span key={i} className="speaker-tag" title={tone}>{name}: {tone}</span>
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
            <div className="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </div>
            <h2>NoteMeet</h2>
            <p>Select a note from the sidebar or press Record to start a new meeting</p>
            {!isRecording && (
              <button className="record-btn empty-record" onClick={() => startRecording()}>
                <span className="record-dot" />
                Start Recording
              </button>
            )}
          </div>
        )}
      </main>

      <audio ref={audioRef} onEnded={handleAudioEnded} style={{ display: 'none' }} />
    </>
  );
}
