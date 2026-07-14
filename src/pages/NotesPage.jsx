import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';
import { useToast } from '../components/ToastContext';
import { groupByDate, formatTime } from '../utils';
import ChatPanel from '../components/ChatPanel';
import NoteTemplates from '../components/NoteTemplates';

const roles = [
  { value: 'meeting', label: 'Meeting' },
  { value: 'standup', label: 'Standup' },
  { value: 'client', label: 'Client Call' },
  { value: 'interview', label: 'Interview' },
  { value: 'other', label: 'Other' },
];

const typeIcons = {
  meeting: 'M',
  standup: 'S',
  client: 'C',
  interview: 'I',
  other: 'O',
};

function noteToMarkdown(note) {
  const lines = [];
  lines.push(`# ${note.title}`);
  lines.push('');
  lines.push(`**Date:** ${new Date(note.date).toLocaleString('en-IN')}`);
  lines.push(`**Type:** ${note.meetingType}`);
  lines.push(`**Duration:** ${note.audioDurationS.toFixed(0)}s`);
  if (note.speakers?.length) lines.push(`**Participants:** ${note.speakers.join(', ')}`);
  if (note.tone) lines.push(`**Tone:** ${note.tone}`);
  lines.push('');
  if (note.shortSummary) {
    lines.push('## Summary');
    lines.push(note.shortSummary);
    lines.push('');
  }
  if (note.fullSummary) {
    lines.push('## Notes');
    lines.push(note.fullSummary);
    lines.push('');
  }
  if (note.actionItems?.length) {
    lines.push('## Action Items');
    note.actionItems.forEach((item) => lines.push(`- [ ] ${item}`));
    lines.push('');
  }
  if (note.promises?.length) {
    lines.push('## Promises & Commitments');
    note.promises.forEach((item) => lines.push(`- ${item}`));
    lines.push('');
  }
  if (note.transcript) {
    lines.push('## Transcript');
    lines.push(note.transcript);
    lines.push('');
  }
  return lines.join('\n');
}

function EditField({ value, onChange, isEditing, multiline }) {
  if (!isEditing) return multiline
    ? <p className="detail-full">{value}</p>
    : <p className="detail-short">{value}</p>;

  return multiline
    ? <textarea className="note-edit-input note-edit-textarea" value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Tab') { e.preventDefault(); const start = e.target.selectionStart; const end = e.target.selectionEnd; const val = e.target.value; const newVal = val.substring(0, start) + '  ' + val.substring(end); onChange(newVal); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = start + 2; }, 0); } }} />
    : <input className="note-edit-input" value={value} onChange={(e) => onChange(e.target.value)} />;
}

function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <p className="modal-message">{message}</p>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="modal-confirm" onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function NotesPage() {
  const { notes, isRecording, isPaused, status, transcript, elapsed, meetingType, setMeetingType, startRecording, stopRecording, togglePause, updateNote, deleteNote } = useNotes();
  const showToast = useToast();
  const [selectedNote, setSelectedNote] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [playingNoteId, setPlayingNoteId] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [showChat, setShowChat] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editFields, setEditFields] = useState({ title: '', shortSummary: '', fullSummary: '', actionItems: '' });
  const [title, setTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBatchExport, setShowBatchExport] = useState(false);
  const [viewedIds, setViewedIds] = useState(new Set());
  const autoSaveRef = useRef(null);
  const audioRef = useRef(null);

  const location = useLocation();

  useEffect(() => {
    if (location.state?.focusNoteId && notes.length > 0) {
      const note = notes.find((n) => n.id === location.state.focusNoteId);
      if (note) {
        setSelectedNote(note);
        setShowChat(false);
        setShowDeleteConfirm(false);
      }
      window.history.replaceState({}, '');
    }
  }, [location.state?.focusNoteId, notes]);

  // Auto-save with debounce
  useEffect(() => {
    if (!editing || !selectedNote) return;
    clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(async () => {
      const updated = {
        ...selectedNote,
        title: editFields.title,
        shortSummary: editFields.shortSummary,
        fullSummary: editFields.fullSummary,
        actionItems: editFields.actionItems.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      const ok = await updateNote(updated);
      if (ok) setSelectedNote(updated);
    }, 300);
    return () => clearTimeout(autoSaveRef.current);
  }, [editFields, editing]);

  // Track viewed notes for unread badge
  useEffect(() => {
    if (selectedNote) {
      setViewedIds((prev) => new Set([...prev, selectedNote.id]));
    }
  }, [selectedNote?.id]);

  // Listen for focus-search custom event (from CommandPalette)
  useEffect(() => {
    const handler = () => {
      const input = document.querySelector('.note-search-input');
      if (input) input.focus();
    };
    window.addEventListener('focus-search', handler);
    return () => window.removeEventListener('focus-search', handler);
  }, []);

  const handleTemplateSelect = useCallback((template) => {
    setShowTemplates(false);
    setTitle(template.title || '');
    setMeetingType(template.meetingType || 'meeting');
    startRecording(template.meetingType || 'meeting');
    showToast('Starting recording with ' + template.label, 'info');
  }, [startRecording, setMeetingType, showToast]);

  const toggleSelectNote = useCallback((noteId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  }, []);

  const handleBatchExport = useCallback(async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    try {
      const md = await invoke('export_notes', { noteIds: ids });
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'NoteMeet-export.md';
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${ids.length} notes`, 'success');
      setSelectedIds(new Set());
    } catch (e) {
      showToast('Export failed', 'error');
    }
  }, [selectedIds, showToast]);

  const handleTabInsert = (e, field) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const val = e.target.value;
      const newVal = val.substring(0, start) + '  ' + val.substring(end);
      setEditFields({ ...editFields, [field]: newVal });
      setTimeout(() => {
        e.target.selectionStart = e.target.selectionEnd = start + 2;
      }, 0);
    }
  };

  const filteredNotes = useMemo(() => {
    let result = notes;
    if (filterType) {
      result = result.filter((n) => n.meetingType === filterType);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.shortSummary.toLowerCase().includes(q) ||
          n.fullSummary.toLowerCase().includes(q) ||
          n.transcript.toLowerCase().includes(q) ||
          n.actionItems?.some((a) => a.toLowerCase().includes(q))
      );
    }
    return result;
  }, [notes, searchQuery, filterType]);

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

  const handleStop = useCallback(async () => {
    setProcessing(true);
    await stopRecording(title || 'Untitled Meeting');
    setProcessing(false);
    setTitle('');
  }, [title, stopRecording]);

  const enterEditMode = useCallback(() => {
    if (!selectedNote) return;
    setEditFields({
      title: selectedNote.title,
      shortSummary: selectedNote.shortSummary,
      fullSummary: selectedNote.fullSummary,
      actionItems: selectedNote.actionItems?.join('\n') || '',
    });
    setEditing(true);
  }, [selectedNote]);

  const saveEdit = useCallback(async () => {
    if (!selectedNote) return;
    setSaving(true);
    const updated = {
      ...selectedNote,
      title: editFields.title,
      shortSummary: editFields.shortSummary,
      fullSummary: editFields.fullSummary,
      actionItems: editFields.actionItems.split('\n').map((s) => s.trim()).filter(Boolean),
    };
    const ok = await updateNote(updated);
    if (ok) setSelectedNote(updated);
    setSaving(false);
    setEditing(false);
  }, [selectedNote, editFields, updateNote]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedNote) return;
    const id = selectedNote.id;
    setShowDeleteConfirm(false);
    const ok = await deleteNote(id);
    if (ok) setSelectedNote(null);
  }, [selectedNote, deleteNote]);

  const handleSelectNote = useCallback((note) => {
    if (editing) return;
    setSelectedNote(note);
    setShowChat(false);
    setShowDeleteConfirm(false);
  }, [editing]);

  const exportNote = async (note) => {
    const md = noteToMarkdown(note);
    try {
      const { save } = await import('@tauri-apps/api/dialog');
      const path = await save({
        defaultPath: `${note.title.replace(/[^a-zA-Z0-9 ]/g, '')}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (path) {
        await invoke('write_text_file', { path, content: md });
      }
    } catch {
      const blob = new Blob([md], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${note.title.replace(/[^a-zA-Z0-9 ]/g, '')}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const countByType = useMemo(() => {
    const map = {};
    notes.forEach((n) => { map[n.meetingType] = (map[n.meetingType] || 0) + 1; });
    return map;
  }, [notes]);

  const groups = groupByDate(filteredNotes);

  return (
    <>
      {showDeleteConfirm && (
        <ConfirmModal
          message="Permanently delete this note? This cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
      {showTemplates && (
        <NoteTemplates onSelect={handleTemplateSelect} onClose={() => setShowTemplates(false)} />
      )}

      <aside className="sidebar">
        <div className="sidebar-actions">
          {!isRecording && !processing && (
            <>
              <button className="record-btn" onClick={() => startRecording()}>
                <span className="record-dot" />
                New Recording
              </button>
              <button className="record-btn template-btn" onClick={() => setShowTemplates(true)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                Template
              </button>
            </>
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
              <div className="rec-actions">
                <button className="pause-btn" onClick={togglePause} title={isPaused ? 'Resume' : 'Pause'}>
                  {isPaused ? '▶' : '⏸'}
                </button>
                <button className="stop-btn" onClick={handleStop}>Stop & Generate</button>
              </div>
            </div>
          )}
          {processing && (
            <div className="processing-card">
              <div className="spinner" />
              <p>Transcribing & generating notes...</p>
            </div>
          )}
        </div>

        <div className="note-search-area">
          <div className="note-search-row">
            <svg className="note-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input className="note-search-input" type="text" placeholder="Search notes..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery && (
              <button className="note-search-clear" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
          <div className="note-type-chips">
            <button className={`note-type-chip ${!filterType ? 'active' : ''}`} onClick={() => setFilterType('')}>
              All <span className="chip-count">{notes.length}</span>
            </button>
            {roles.map((r) => (
              <button key={r.value} className={`note-type-chip ${filterType === r.value ? 'active' : ''}`}
                onClick={() => setFilterType(filterType === r.value ? '' : r.value)}>
                <span className="chip-icon">{typeIcons[r.value]}</span>
                {r.label}
                <span className="chip-count">{countByType[r.value] || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="batch-bar">
            <span className="batch-count">{selectedIds.size} selected</span>
            <button className="batch-export-btn" onClick={handleBatchExport}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
            <button className="batch-clear-btn" onClick={() => setSelectedIds(new Set())}>Clear</button>
          </div>
        )}
        <div className="notes-list">
          {filteredNotes.length === 0 && !isRecording && (
            <div className="empty-notes">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
              <p>{searchQuery || filterType ? 'No notes match your search' : 'Press Record to start your first meeting note'}</p>
            </div>
          )}
          {Object.entries(groups).map(([dateLabel, dateNotes]) => (
            <div key={dateLabel} className="note-group">
              <div className="note-group-label">{dateLabel}</div>
              {dateNotes.map((note) => (
                <div
                  key={note.id}
                  className={`note-item ${selectedNote?.id === note.id ? 'active' : ''} ${selectedIds.has(note.id) ? 'selected' : ''} ${!viewedIds.has(note.id) ? 'unread' : ''}`}
                  onClick={() => handleSelectNote(note)}
                >
                  <div className="note-item-check" onClick={(e) => { e.stopPropagation(); toggleSelectNote(note.id); }}>
                    <div className={`check-box ${selectedIds.has(note.id) ? 'checked' : ''}`}>
                      {selectedIds.has(note.id) && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="note-item-content">
                    <div className="note-item-title">{note.title || 'Untitled'}</div>
                    <div className="note-item-meta">
                      <span>{note.meetingType}</span>
                      <span>{note.audioDurationS.toFixed(0)}s</span>
                    </div>
                  </div>
                  {!viewedIds.has(note.id) && <span className="unread-dot" />}
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
                <h1 className="note-detail-title">
                  {editing
                    ? <input className="note-edit-input note-edit-title" value={editFields.title} onChange={(e) => setEditFields({ ...editFields, title: e.target.value })} />
                    : selectedNote.title}
                </h1>
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
                    className={`icon-btn ${playingNoteId === selectedNote.id ? 'playing' : ''}`}
                    onClick={() => playAudio(selectedNote.audioFile, selectedNote.id)}
                    title={playingNoteId === selectedNote.id ? 'Stop' : 'Play'}
                  >
                    {playingNoteId === selectedNote.id ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"/>
                        <rect x="14" y="4" width="4" height="16"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    )}
                  </button>
                )}
                {!editing && (
                  <button className="icon-btn" onClick={() => exportNote(selectedNote)} title="Export as Markdown">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                )}
                {editing ? (
                  <>
                    <button className="action-btn" onClick={saveEdit} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button className="action-btn" onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="icon-btn" onClick={enterEditMode} title="Edit note">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button className="icon-btn delete-btn" onClick={() => setShowDeleteConfirm(true)} title="Delete note">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        <line x1="10" y1="11" x2="10" y2="17"/>
                        <line x1="14" y1="11" x2="14" y2="17"/>
                      </svg>
                    </button>
                    <button
                      className={`icon-btn ${showChat ? 'active' : ''}`}
                      onClick={() => setShowChat(!showChat)}
                      title="Ask AI"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className={`note-detail-body ${showChat ? 'with-chat' : ''}`}>
              <div className="note-content">
                <section className="detail-section">
                  <h3>Summary</h3>
                  <EditField value={editing ? editFields.shortSummary : selectedNote.shortSummary}
                    onChange={(v) => setEditFields({ ...editFields, shortSummary: v })}
                    isEditing={editing} />
                </section>
                <section className="detail-section">
                  <h3>Full Notes</h3>
                  <EditField value={editing ? editFields.fullSummary : selectedNote.fullSummary}
                    onChange={(v) => setEditFields({ ...editFields, fullSummary: v })}
                    isEditing={editing} multiline />
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
                <section className="detail-section">
                  <h3>Action Items</h3>
                  {editing ? (
                    <textarea className="note-edit-input note-edit-textarea" value={editFields.actionItems}
                      onChange={(e) => setEditFields({ ...editFields, actionItems: e.target.value })}
                      placeholder="One item per line" />
                  ) : (
                    selectedNote.actionItems?.length > 0 ? (
                      <ul className="detail-list">
                        {selectedNote.actionItems.map((item, i) => (
                          <li key={i} className="action-item">{item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="detail-full" style={{ color: 'var(--text3)' }}>No action items</p>
                    )
                  )}
                </section>
                {selectedNote.promises?.length > 0 && !editing && (
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
