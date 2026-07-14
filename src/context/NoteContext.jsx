import { createContext, useContext, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const NoteContext = createContext(null);

export function NoteProvider({ children }) {
  const [notes, setNotes] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [meetingType, setMeetingType] = useState('meeting');
  const [deletedNote, setDeletedNote] = useState(null);
  const [undoTimer, setUndoTimer] = useState(null);
  const [lastSavedToast, setLastSavedToast] = useState('');

  useEffect(() => {
    let timer;
    if (isRecording && !isPaused) {
      timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [isRecording, isPaused]);

  useEffect(() => {
    (async () => {
      try {
        const saved = await invoke('load_notes');
        if (saved?.length) setNotes(saved);
      } catch (e) { console.error(e); }
    })();
  }, []);

  useEffect(() => {
    const unlisteners = [];
    listen('transcription-update', (e) => {
      setTranscript((prev) => prev + ' ' + e.payload.text);
    }).then((f) => unlisteners.push(f));
    listen('note-ready', (e) => {
      const note = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
      setNotes((prev) => [note, ...prev]);
      setStatus('idle');
    }).then((f) => unlisteners.push(f));
    listen('recording-started', () => {
      setTranscript('');
      setElapsed(0);
      setIsRecording(true);
      setIsPaused(false);
      setStatus('recording');
    }).then((f) => unlisteners.push(f));
    listen('recording-paused', () => {
      setIsPaused(true);
    }).then((f) => unlisteners.push(f));
    listen('recording-resumed', () => {
      setIsPaused(false);
    }).then((f) => unlisteners.push(f));
    return () => { unlisteners.forEach((f) => f()); };
  }, []);

  const startRecording = async (mt) => {
    try {
      setStatus('recording');
      setIsRecording(true);
      setIsPaused(false);
      setTranscript('');
      setElapsed(0);
      await invoke('start_recording', { meetingType: mt || meetingType });
    } catch (e) {
      console.error(e);
      setIsRecording(false);
      setStatus('idle');
    }
  };

  const stopRecording = async (t) => {
    try {
      setIsRecording(false);
      setIsPaused(false);
      setStatus('processing');
      const result = await invoke('stop_recording', { title: t || 'Untitled Meeting' });
      if (result) {
        const note = JSON.parse(result);
        setNotes((prev) => [note, ...prev]);
        setTranscript(note.transcript);
        setLastSavedToast('Note saved!');
        setTimeout(() => setLastSavedToast(''), 3000);
      }
    } catch (e) {
      console.error(e);
    }
    setStatus('idle');
  };

  const togglePause = async () => {
    try {
      if (isPaused) {
        setIsPaused(false);
        await invoke('resume_recording');
      } else {
        setIsPaused(true);
        await invoke('pause_recording');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateNote = async (note) => {
    try {
      await invoke('update_note', { note });
      setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
      return true;
    } catch (e) {
      console.error('Failed to update note:', e);
      return false;
    }
  };

  const deleteNote = async (noteId) => {
    try {
      const note = notes.find((n) => n.id === noteId);
      await invoke('delete_note', { noteId });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setDeletedNote(note);
      clearTimeout(undoTimer);
      const timer = setTimeout(() => {
        setDeletedNote(null);
      }, 5000);
      setUndoTimer(timer);
      return true;
    } catch (e) {
      console.error('Failed to delete note:', e);
      return false;
    }
  };

  const undoDelete = async () => {
    if (!deletedNote) return;
    try {
      await invoke('save_note', { note: deletedNote });
      setNotes((prev) => [deletedNote, ...prev]);
      setDeletedNote(null);
      clearTimeout(undoTimer);
    } catch (e) {
      console.error('Failed to undo delete:', e);
    }
  };

  return (
    <NoteContext.Provider value={{
      notes,
      isRecording,
      isPaused,
      status,
      transcript,
      elapsed,
      meetingType, setMeetingType,
      startRecording, stopRecording,
      togglePause,
      updateNote,
      deleteNote,
      undoDelete,
      deletedNote,
      lastSavedToast,
    }}>
      {children}
    </NoteContext.Provider>
  );
}

export function useNotes() {
  const ctx = useContext(NoteContext);
  if (!ctx) throw new Error('useNotes must be used within NoteProvider');
  return ctx;
}
