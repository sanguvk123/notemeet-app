import { createContext, useContext, useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const NoteContext = createContext(null);

export function NoteProvider({ children }) {
  const [notes, setNotes] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('idle');
  const [transcript, setTranscript] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [meetingType, setMeetingType] = useState('meeting');

  useEffect(() => {
    let timer;
    if (isRecording) {
      timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    }
    return () => clearInterval(timer);
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

  const startRecording = async (mt) => {
    try {
      setStatus('recording');
      setIsRecording(true);
      setTranscript('');
      setElapsed(0);
      await invoke('start_recording', { meetingType: mt || meetingType });
    } catch (e) {
      console.error(e);
      setStatus('idle');
    }
  };

  const stopRecording = async (t) => {
    try {
      setIsRecording(false);
      setStatus('processing');
      const result = await invoke('stop_recording', { title: t || 'Untitled Meeting' });
      if (result) {
        const note = JSON.parse(result);
        setNotes((prev) => [note, ...prev]);
        setTranscript(note.transcript);
      }
    } catch (e) {
      console.error(e);
    }
    setStatus('idle');
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
      await invoke('delete_note', { noteId });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      return true;
    } catch (e) {
      console.error('Failed to delete note:', e);
      return false;
    }
  };

  return (
    <NoteContext.Provider value={{
      notes, setNotes,
      isRecording, setIsRecording,
      status, setStatus,
      transcript, setTranscript,
      elapsed,
      meetingType, setMeetingType,
      startRecording, stopRecording,
      updateNote,
      deleteNote,
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
