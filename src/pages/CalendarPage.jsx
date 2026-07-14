import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKEND_DAYS = [0, 6]; // Sun, Sat

function parseDateFromNote(note) {
  if (!note?.date) return null;
  const d = new Date(note.date);
  return isNaN(d.getTime()) ? null : d;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

function formatTimeDisplay(dateStr, timeStr) {
  if (!timeStr) return 'All day';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function dateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  const today = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  if (dateStr === today) return 'Today';
  const tmrw = new Date(now);
  tmrw.setDate(tmrw.getDate() + 1);
  const tomorrow = toDateStr(tmrw.getFullYear(), tmrw.getMonth(), tmrw.getDate());
  if (dateStr === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function toDateStr(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getWeekStart(date, weekStartsOn = 0) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  d.setDate(d.getDate() - diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isPast(dateStr, timeStr) {
  const now = new Date();
  const d = new Date(dateStr + 'T' + (timeStr || '12:00'));
  return d < now;
}

function getWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function isWeekend(dayIndex) {
  return WEEKEND_DAYS.includes(dayIndex);
}

function getEventDuration(event) {
  if (!event.time) return 0;
  if (event.endTime) {
    const [sh, sm] = event.time.split(':').map(Number);
    const [eh, em] = event.endTime.split(':').map(Number);
    const dur = (eh * 60 + em) - (sh * 60 + sm);
    return Math.max(20, dur);
  }
  return 60;
}

function getEventTop(timeStr, startHour) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return Math.max(0, ((h - startHour) * 60 + m));
}

function titleMatchesEvent(note, event) {
  if (!event?.title) return false;
  const words = note.title.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const summary = (note.shortSummary || '').toLowerCase();
  const eventTitle = event.title.toLowerCase();
  return words.some(w => eventTitle.includes(w)) || summary.includes(eventTitle);
}

export default function CalendarPage({ isGuest }) {
  const navigate = useNavigate();
  const { notes } = useNotes();
  const gridRef = useRef(null);
  const longPressTimer = useRef(null);
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);

  const [localEvents, setLocalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [authStatus, setAuthStatus] = useState({ signedIn: false, email: '' });
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(null);
  const [quickAddDay, setQuickAddDay] = useState(null);
  const [formData, setFormData] = useState({ title: '', date: '', time: '', notes: '' });
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('month');
  const [compactView, setCompactView] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [editingEvent, setEditingEvent] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', time: '', notes: '' });
  const [sidebarMonth, setSidebarMonth] = useState(() => new Date().getMonth());
  const [sidebarYear, setSidebarYear] = useState(() => new Date().getFullYear());

  const [currentMonth, setCurrentMonth] = useState(() => {
    try { const m = parseInt(localStorage.getItem('calMonth')); return m >= 0 && m <= 11 ? m : new Date().getMonth(); }
    catch { return new Date().getMonth(); }
  });
  const [currentYear, setCurrentYear] = useState(() => {
    try { const y = parseInt(localStorage.getItem('calYear')); return y > 2000 ? y : new Date().getFullYear(); }
    catch { return new Date().getFullYear(); }
  });
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    try {
      const s = localStorage.getItem('calWeekStart');
      if (s) { const d = new Date(s); if (!isNaN(d.getTime())) return d; }
    } catch {}
    return getWeekStart(now);
  });

  const persistMonth = useCallback((m, y) => {
    try { localStorage.setItem('calMonth', String(m)); localStorage.setItem('calYear', String(y)); } catch {}
  }, []);

  const persistWeekStart = useCallback((d) => {
    try { localStorage.setItem('calWeekStart', d.toISOString()); } catch {}
  }, []);

  useEffect(() => {
    invoke('load_calendar_events').then((data) => {
      if (data?.length) setLocalEvents(data);
    }).catch(console.error);
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const status = await invoke('google_auth_status');
      setAuthStatus({ signedIn: status.signedIn, email: status.email || '' });
      if (status.signedIn) await doSync();
    } catch {}
  };

  const showError = (msg) => {
    setError(msg);
    setTimeout(() => setError(''), 8000);
  };

  const doSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const events = await invoke('google_sync_events');
      setGoogleEvents(events || []);
    } catch (e) { showError(String(e)); }
    setSyncing(false);
  };

  const signIn = async () => {
    try {
      setSyncing(true); setError('');
      await invoke('google_sign_in');
      const status = await invoke('google_auth_status');
      setAuthStatus({ signedIn: status.signedIn, email: status.email || '' });
      if (status.signedIn) await doSync();
    } catch (e) { showError(String(e)); }
    setSyncing(false);
  };

  const signOut = async () => {
    try {
      await invoke('google_sign_out');
      setAuthStatus({ signedIn: false, email: '' });
      setGoogleEvents([]);
    } catch {}
  };

  const addEvent = async () => {
    if (!formData.title.trim() || !formData.date) return;
    try {
      if (authStatus.signedIn) {
        await invoke('google_create_event', { title: formData.title, date: formData.date, time: formData.time || '', notes: formData.notes || '' });
        await doSync();
      } else {
        await invoke('add_calendar_event', { title: formData.title, date: formData.date, time: formData.time || '', notes: formData.notes || '' });
        const saved = await invoke('load_calendar_events');
        setLocalEvents(saved || []);
      }
      setShowForm(false);
      setShowQuickAdd(null);
      setFormData({ title: '', date: '', time: '', notes: '' });
      showError('Event saved');
    } catch (e) { showError(String(e)); }
  };

  const deleteEvent = async (id) => {
    try {
      await invoke('delete_calendar_event', { eventId: id });
      setLocalEvents((prev) => prev.filter((e) => e.id !== id));
    } catch {}
  };

  const updateEvent = async () => {
    if (!editingEvent || !editForm.title.trim()) return;
    try {
      if (editingEvent.source === 'google') {
        await invoke('google_create_event', { title: editForm.title, date: editingEvent.date, time: editForm.time || '', notes: editForm.notes || '' });
        await doSync();
      } else {
        await deleteEvent(editingEvent.id);
        await invoke('add_calendar_event', { title: editForm.title, date: editingEvent.date, time: editForm.time || '', notes: editForm.notes || '' });
        const saved = await invoke('load_calendar_events');
        setLocalEvents(saved || []);
      }
      setEditingEvent(null);
      setEditForm({ title: '', time: '', notes: '' });
      showError('Event updated');
    } catch (e) { showError(String(e)); }
  };

  const moveEventToDate = async (event, newDate) => {
    try {
      if (event.source === 'local') {
        try { await invoke('delete_calendar_event', { eventId: event.id }); } catch {}
        await invoke('add_calendar_event', { title: event.title, date: newDate, time: event.time || '', notes: event.notes || '' });
        const saved = await invoke('load_calendar_events');
        setLocalEvents(saved || []);
      } else if (authStatus.signedIn) {
        await invoke('google_create_event', { title: event.title, date: newDate, time: event.time || '', notes: event.notes || '' });
        await doSync();
      }
      showError('Event moved');
    } catch (e) { showError(String(e)); }
  };

  const startEditEvent = (e) => {
    setEditingEvent(e);
    setEditForm({ title: e.title, time: e.time || '', notes: e.notes || '' });
  };

  const cancelEdit = () => {
    setEditingEvent(null);
    setEditForm({ title: '', time: '', notes: '' });
  };

  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(now.getMonth());
    setCurrentYear(now.getFullYear());
    setSelectedDate(now.getDate());
    setSidebarMonth(now.getMonth());
    setSidebarYear(now.getFullYear());
    persistMonth(now.getMonth(), now.getFullYear());
    if (viewMode === 'week') {
      const ws = getWeekStart(now);
      setWeekStart(ws);
      persistWeekStart(ws);
    }
  };

  const handleCellDoubleClick = (day) => {
    const ds = toDateStr(currentYear, currentMonth, day);
    setFormData({ ...formData, date: ds });
    setShowForm(true);
  };

  const handleWeekSlotClick = (dateStr, timeStr) => {
    setFormData({ title: '', date: dateStr, time: timeStr || '', notes: '' });
    setShowForm(true);
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (editingEvent) { cancelEdit(); return; }
        if (showForm || showQuickAdd) { setShowForm(false); setShowQuickAdd(null); return; }
        setSelectedDate(null);
      }
      if (e.key === 'Enter' && !e.target.closest('input,textarea,select')) goToToday();
      if (e.key === 'ArrowLeft' && !e.target.closest('input,textarea,select')) {
        if (viewMode === 'month') {
          if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
          else setCurrentMonth((m) => m - 1);
        } else {
          setWeekStart((prev) => { const p = addDays(prev, -7); persistWeekStart(p); return p; });
        }
      }
      if (e.key === 'ArrowRight' && !e.target.closest('input,textarea,select')) {
        if (viewMode === 'month') {
          if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
          else setCurrentMonth((m) => m + 1);
        } else {
          setWeekStart((prev) => { const n = addDays(prev, 7); persistWeekStart(n); return n; });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [viewMode, currentMonth, currentYear, editingEvent, showForm, showQuickAdd]);

  useEffect(() => { persistMonth(currentMonth, currentYear); }, [currentMonth, currentYear]);
  useEffect(() => { if (selectedDate) { setSidebarMonth(currentMonth); setSidebarYear(currentYear); } }, [selectedDate]);

  const noteDates = useMemo(() =>
    notes.map(parseDateFromNote).filter(Boolean),
  [notes]);
  const daysInMonth = useMemo(() => getDaysInMonth(currentYear, currentMonth), [currentYear, currentMonth]);
  const firstDay = useMemo(() => getFirstDayOfMonth(currentYear, currentMonth), [currentYear, currentMonth]);

  const allEvents = useMemo(() => [
    ...localEvents.map((e) => ({ ...e, source: 'local' })),
    ...googleEvents.map((e) => ({ ...e, source: 'google' })),
  ], [localEvents, googleEvents]);

  const eventsByDate = useMemo(() => {
    const map = {};
    for (const e of allEvents) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    return map;
  }, [allEvents]);

  const dayEvents = (day) => {
    const ds = toDateStr(currentYear, currentMonth, day);
    return eventsByDate[ds] || [];
  };

  const dayHasNote = (day) =>
    noteDates.some((d) => d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day);

  const today = useMemo(() => new Date(), []);

  function todayStr() { const d = new Date(); return toDateStr(d.getFullYear(), d.getMonth(), d.getDate()); }
  function nowStr() { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

  const upcoming = useMemo(() =>
    [...allEvents]
      .filter((e) => {
        const ts = todayStr();
        if (e.date > ts) return true;
        if (e.date < ts) return false;
        if (!e.time) return true;
        return e.time >= nowStr();
      })
      .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '')),
  [allEvents]);

  const prepareEvents = useMemo(() =>
    upcoming.filter((e) => {
      const eventDate = new Date(e.date + 'T' + (e.time || '00:00'));
      const diffMs = eventDate.getTime() - Date.now();
      return diffMs > 0 && diffMs <= 3600000;
    }),
  [upcoming]);

  const selectedDs = selectedDate ? toDateStr(currentYear, currentMonth, selectedDate) : null;
  const selectedEvts = useMemo(() =>
    selectedDs ? (eventsByDate[selectedDs] || []) : [],
  [selectedDs, eventsByDate]);
  const selectedNotes = useMemo(() =>
    selectedDs ? notes.filter((n) => {
      const d = parseDateFromNote(n);
      return d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === selectedDate;
    }) : [],
  [selectedDs, notes, currentYear, currentMonth, selectedDate]);
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;
  const weekDates = getWeekDates(weekStart);

  const sidebarDaysInMonth = getDaysInMonth(sidebarYear, sidebarMonth);
  const sidebarFirstDay = getFirstDayOfMonth(sidebarYear, sidebarMonth);

  const swipeHandlers = {
    onTouchStart: (e) => {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
    },
    onTouchEnd: (e) => {
      if (touchStartX.current === null) return;
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      const dy = e.changedTouches[0].clientY - touchStartY.current;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        if (viewMode === 'month') {
          if (dx < 0) {
            if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
            else setCurrentMonth((m) => m + 1);
          } else {
            if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
            else setCurrentMonth((m) => m - 1);
          }
        } else {
          if (dx < 0) { setWeekStart((prev) => { const n = addDays(prev, 7); persistWeekStart(n); return n; }); }
          else { setWeekStart((prev) => { const p = addDays(prev, -7); persistWeekStart(p); return p; }); }
        }
      }
      touchStartX.current = null;
      touchStartY.current = null;
    },
  };

  const handleDragStart = (e, event) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: event.id, source: event.source }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const allEventsRef = useRef(allEvents);
  allEventsRef.current = allEvents;

  const handleDrop = (e, day) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const evts = allEventsRef.current;
      const event = evts.find((ev) => ev.id === data.id && ev.source === data.source);
      if (event) {
        const ds = toDateStr(currentYear, currentMonth, day);
        if (ds !== event.date) {
          moveEventToDate(event, ds);
        }
      }
    } catch {}
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const startHour = 6;
  const endHour = 23;
  const hourHeight = 56;

  const [currentTimePos, setCurrentTimePos] = useState(0);
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const minutes = (now.getHours() - startHour) * 60 + now.getMinutes();
      setCurrentTimePos(Math.max(0, (minutes / 60) * hourHeight));
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, []);

  const linkedNotesMap = useMemo(() => {
    if (selectedDate == null) return {};
    const map = {};
    for (const n of notes) {
      const nd = parseDateFromNote(n);
      if (nd && nd.getFullYear() === currentYear && nd.getMonth() === currentMonth && nd.getDate() === selectedDate) {
        for (const e of (eventsByDate[toDateStr(currentYear, currentMonth, selectedDate)] || [])) {
          if (titleMatchesEvent(n, e)) {
            if (!map[e.id]) map[e.id] = [];
            map[e.id].push(n);
          }
        }
      }
    }
    return map;
  }, [selectedDate, notes, currentYear, currentMonth, eventsByDate]);

  const linkedNotes = (event) => linkedNotesMap[event?.id] || [];

  return (
    <main className="main-content cal-content" tabIndex={-1} ref={gridRef} {...swipeHandlers}>
      {prepareEvents.length > 0 && (
        <div className="cal-prepare-banner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span className="cal-prepare-text">
            <strong>{prepareEvents[0].title}</strong> — {prepareEvents[0].time ? formatTimeDisplay(prepareEvents[0].date, prepareEvents[0].time) : 'All day'}
            <span className="cal-prepare-when"> in {Math.ceil((new Date(prepareEvents[0].date + 'T' + (prepareEvents[0].time || '00:00')).getTime() - Date.now()) / 60000)} min</span>
          </span>
          <button className="cal-prepare-btn" onClick={() => navigate('/notes')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Start Recording
          </button>
          <button className="cal-prepare-btn" onClick={goToToday}>Go to Calendar</button>
        </div>
      )}

      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-topbar">
            <div className="cal-topbar-left">
              <button className="cal-nav-arrow cal-nav-arrow-left" onClick={() => {
                if (viewMode === 'month') {
                  if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
                  else setCurrentMonth((m) => m - 1);
                } else {
                  const p = addDays(weekStart, -7); setWeekStart(p); persistWeekStart(p);
                }
                setSelectedDate(null);
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <h1 className="cal-title">
                {viewMode === 'month'
                  ? `${MONTHS[currentMonth]} ${currentYear}`
                  : `${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getDate()} – ${SHORT_MONTHS[addDays(weekStart, 6).getMonth()]} ${addDays(weekStart, 6).getDate()}, ${addDays(weekStart, 6).getFullYear()}`
                }
              </h1>
              <button className="cal-nav-arrow cal-nav-arrow-right" onClick={() => {
                if (viewMode === 'month') {
                  if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
                  else setCurrentMonth((m) => m + 1);
                } else {
                  const n = addDays(weekStart, 7); setWeekStart(n); persistWeekStart(n);
                }
                setSelectedDate(null);
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
            <div className="cal-topbar-right">
              <button className="cal-today-btn" onClick={goToToday}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>Today</span>
              </button>
              <div className="cal-topbar-divider" />
              <div className="cal-view-toggle">
                <button className={`cal-view-btn ${viewMode === 'month' ? 'active' : ''}`} onClick={() => setViewMode('month')}>Month</button>
                <button className={`cal-view-btn ${viewMode === 'week' ? 'active' : ''}`} onClick={() => setViewMode('week')}>Week</button>
              </div>
              <div className="cal-topbar-divider" />
              {!isGuest && (
                <div className="cal-google-row">
                  {syncing && <span className="sync-spinner sync-pulse" />}
                  {authStatus.signedIn ? (
                    <>
                      <span className="cal-google-dot-active" />
                      <button className="cal-ghost-btn" onClick={() => doSync()} disabled={syncing}>{syncing ? 'Syncing...' : 'Sync'}</button>
                      <button className="cal-ghost-btn cal-ghost-btn-danger" onClick={signOut}>Disconnect</button>
                    </>
                  ) : (
                    <button className="cal-ghost-btn" onClick={signIn} disabled={syncing}>{syncing ? 'Connecting...' : 'Connect Google'}</button>
                  )}
                </div>
              )}
              {isGuest && <span className="guest-badge">Guest</span>}
              <button className="cal-primary-btn" onClick={() => setShowForm(!showForm)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {showForm ? 'Cancel' : 'New Event'}
              </button>
            </div>
          </div>

          {error && (
            <div className={`cal-toast ${error === 'Event saved' || error === 'Event updated' || error === 'Event moved' ? 'cal-toast-success' : 'cal-toast-error'}`}>
              {error}
            </div>
          )}

          {showForm && (
            <div className="modal-overlay" onClick={() => { setShowForm(false); setError(''); }}>
              <div className="cal-modal-card" onClick={(e) => e.stopPropagation()}>
                <div className="cal-modal-header">
                  <span className="cal-modal-title">{formData.id ? 'Edit Event' : 'New Event'}</span>
                  <button className="cal-modal-close" onClick={() => { setShowForm(false); setError(''); }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
                <input className="cal-input" placeholder="Event title" value={formData.title}
                  autoFocus
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
                <div className="cal-form-row">
                  <input type="date" className="cal-input cal-input-half" value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                  <input type="time" className="cal-input cal-input-half" value={formData.time}
                    onChange={(e) => setFormData({ ...formData, time: e.target.value })} />
                </div>
                <textarea className="cal-input cal-textarea" placeholder="Notes (optional)" value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
                <div className="cal-modal-actions">
                  <button className="cal-ghost-btn" onClick={() => { setShowForm(false); setError(''); }}>Cancel</button>
                  <button className="cal-primary-btn" onClick={addEvent}
                    disabled={!formData.title.trim() || !formData.date}>Save Event</button>
                </div>
              </div>
            </div>
          )}

          {viewMode === 'month' ? (
            <>
              <div className={`cal-grid ${compactView ? 'cal-grid-compact' : ''}`}>
                {DAYS.map((d, i) => (
                  <div key={d} className={`cal-grid-header ${isWeekend(i) ? 'cal-grid-header-weekend' : ''}`}>{d}</div>
                ))}
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`e-${i}`} className="cal-cell cal-cell-empty" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const hasNote = dayHasNote(day);
                  const evts = dayEvents(day);
                  const isSelected = selectedDate === day;
                  const isToday = isCurrentMonth && today.getDate() === day;
                  const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
                  return (
                    <div key={day}
                      className={`cal-cell ${isToday ? 'cal-cell-today' : ''} ${isSelected ? 'cal-cell-selected' : ''} ${evts.length > 0 ? 'cal-cell-active' : ''} ${isWeekend(dayOfWeek) ? 'cal-cell-weekend' : ''}`}
                      onClick={() => {
                        setSelectedDate(selectedDate === day ? null : day);
                        setShowQuickAdd(null);
                      }}
                      onDoubleClick={() => handleCellDoubleClick(day)}
                      onMouseDown={() => {
                        longPressTimer.current = setTimeout(() => {
                          const ds = toDateStr(currentYear, currentMonth, day);
                          setQuickAddDay(day);
                          setFormData({ ...formData, date: ds });
                          setShowQuickAdd(day);
                        }, 500);
                      }}
                      onMouseUp={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
                      onMouseLeave={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDrop(e, day)}>
                      <span className="cal-cell-num">{day}</span>
                      {evts.length > 0 && (
                        <div className="cal-cell-events">
                          {evts.slice(0, compactView ? 1 : 3).map((ev, ei) => (
                            <span key={ei}
                              className="cal-cell-ev"
                              title={ev.title}
                              style={{ '--ev-color': `var(--ev-${['blue','green','orange','purple','pink','cyan'][ei % 6]})` }}>
                              <span className="cal-cell-ev-dot" />
                              {ev.title}
                            </span>
                          ))}
                          {evts.length > (compactView ? 1 : 3) && <span className="cal-cell-more">+{evts.length - (compactView ? 1 : 3)}</span>}
                        </div>
                      )}
                      {!evts.length && <span className="cal-cell-add" onClick={(e) => { e.stopPropagation(); handleCellDoubleClick(day); }}>+</span>}
                      {showQuickAdd === day && (
                        <div className="cal-quick-add" onClick={(e) => e.stopPropagation()}>
                          <input className="cal-quick-input" placeholder="New event..." value={formData.title}
                            onChange={(e2) => setFormData({ ...formData, title: e2.target.value })}
                            onKeyDown={(e2) => { if (e2.key === 'Enter') addEvent(); if (e2.key === 'Escape') setShowQuickAdd(null); }}
                            autoFocus />
                          <div className="cal-quick-actions">
                            <button className="cal-quick-save" onClick={addEvent} disabled={!formData.title.trim()}>Add</button>
                            <button className="cal-quick-cancel" onClick={() => setShowQuickAdd(null)}>×</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="cal-week-timegrid" style={{ minHeight: (endHour - startHour) * hourHeight + 30 }}>
                <div className="cal-week-timecol">
                  {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                    <div key={i} className="cal-week-timecell" style={{ height: hourHeight }}>
                      <span className="cal-week-timelabel">{i + startHour > 12 ? `${i + startHour - 12} PM` : i + startHour === 12 ? '12 PM' : `${i + startHour} AM`}</span>
                    </div>
                  ))}
                </div>
                {weekDates.map((d, i) => {
                  const ds = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
                  const evts = allEvents.filter((e) => e.date === ds);
                  const notesForDay = notes.filter((n) => {
                    const nd = parseDateFromNote(n);
                    return nd && nd.getFullYear() === d.getFullYear() && nd.getMonth() === d.getMonth() && nd.getDate() === d.getDate();
                  });
                  const isToday = toDateStr(today.getFullYear(), today.getMonth(), today.getDate()) === ds;
                  return (
                    <div key={i} className={`cal-week-daycol ${isToday ? 'cal-week-daycol-today' : ''} ${isWeekend(d.getDay()) ? 'cal-week-daycol-weekend' : ''}`}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const y = e.clientY - rect.top;
                        const hour = Math.floor(y / hourHeight) + startHour;
                        const timeStr = `${String(hour).padStart(2, '0')}:00`;
                        handleWeekSlotClick(ds, timeStr);
                      }}>
                      {evts.map((e) => {
                        const top = getEventTop(e.time, startHour);
                        const dur = getEventDuration(e);
                        const h = Math.max(20, (dur / 60) * hourHeight);
                        return (
                          <div key={`${e.source}-${e.id}`}
                            className={`cal-week-slot-event ${isPast(e.date, e.time) ? 'cal-week-slot-past' : ''}`}
                            style={{ top: top, height: h }}
                            title={`${e.title} ${e.time ? formatTimeDisplay(e.date, e.time) : ''}`}
                            draggable
                            onDragStart={(ev) => handleDragStart(ev, e)}>
                            <span className="cal-week-slot-time">{e.time ? formatTimeDisplay(e.date, e.time) : ''}</span>
                            <span className="cal-week-slot-title">{e.title}</span>
                          </div>
                        );
                      })}
                      {isToday && (
                        <div className="cal-week-nowline" style={{ top: currentTimePos }} />
                      )}
                      {evts.length === 0 && notesForDay.length === 0 && (
                        <div className="cal-week-daycol-empty">Click to add event</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <aside className="cal-sidebar">
          {/* Mini Calendar */}
          <div className="cal-sidebar-section cal-sidebar-mini-wrap">
            <div className="cal-mini-header">
              <button className="cal-mini-nav" onClick={() => {
                if (sidebarMonth === 0) { setSidebarMonth(11); setSidebarYear((y) => y - 1); }
                else setSidebarMonth((m) => m - 1);
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="cal-mini-label">{SHORT_MONTHS[sidebarMonth]} {sidebarYear}</span>
              <button className="cal-mini-nav" onClick={() => {
                if (sidebarMonth === 11) { setSidebarMonth(0); setSidebarYear((y) => y + 1); }
                else setSidebarMonth((m) => m + 1);
              }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
            <div className="cal-mini-grid">
              {DAYS.map((d) => <span key={d} className="cal-mini-dayname">{d[0]}</span>)}
              {Array.from({ length: sidebarFirstDay }).map((_, i) => <span key={`e-${i}`} className="cal-mini-cell cal-mini-empty" />)}
              {Array.from({ length: sidebarDaysInMonth }, (_, i) => i + 1).map((day) => {
                const isSel = selectedDate === day && sidebarMonth === currentMonth && sidebarYear === currentYear;
                const isToday = today.getDate() === day && today.getMonth() === sidebarMonth && today.getFullYear() === sidebarYear;
                return (
                  <span key={day}
                    className={`cal-mini-cell ${isSel ? 'cal-mini-sel' : ''} ${isToday ? 'cal-mini-today' : ''}`}
                    onClick={() => { setSelectedDate(day); setCurrentMonth(sidebarMonth); setCurrentYear(sidebarYear); }}>
                    {day}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="cal-sidebar-section">
            <div className="cal-sidebar-section-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              Upcoming
            </div>
            {upcoming.length > 0 ? (
              <div className="cal-sidebar-events">
                {upcoming.slice(0, 5).map((e, i) => (
                  <div key={`${e.source}-${e.id || i}`} className="cal-sidebar-ev-row"
                    onClick={() => {
                      const d = new Date(e.date + 'T00:00:00');
                      setSelectedDate(d.getDate());
                      setCurrentMonth(d.getMonth());
                      setCurrentYear(d.getFullYear());
                    }}
                    style={{ '--ev-color': `var(--ev-${['blue','green','orange','purple','pink','cyan'][i % 6]})` }}>
                    <div className="cal-sidebar-ev-bar" />
                    <div className="cal-sidebar-ev-info">
                      <span className="cal-sidebar-ev-title">{e.title}</span>
                      <span className="cal-sidebar-ev-time">
                        {dateLabel(e.date)}
                        {e.time ? ` · ${formatTimeDisplay(e.date, e.time)}` : ''}
                      </span>
                    </div>
                    {e.source === 'google' && <span className="cal-source-chip-sm">G</span>}
                  </div>
                ))}
              </div>
            ) : (
              <div className="cal-sidebar-empty-sm">
                <p>No upcoming events</p>
              </div>
            )}
          </div>

          {/* Selected day detail (if a date is selected) */}
          {selectedDate && (
            <>
              <div className="cal-sidebar-divider" />
              <div className="cal-sidebar-section">
                <div className="cal-sidebar-section-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  {selectedDs}
                  <span className="cal-sidebar-ev-count">{selectedEvts.length}</span>
                  <button className="cal-sidebar-add-event" onClick={() => { setFormData({ ...formData, date: selectedDs }); setShowForm(true); }} title="Add event">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                </div>

                {selectedEvts.map((e) => (
                  editingEvent?.id === e.id && editingEvent?.source === e.source ? (
                    <div key={`edit-${e.source}-${e.id}`} className="cal-sidebar-event cal-sidebar-event-editing">
                      <div className="cal-sidebar-ev-bar" />
                      <input className="cal-edit-input" value={editForm.title}
                        onChange={(t) => setEditForm({ ...editForm, title: t.target.value })} />
                      <input type="time" className="cal-edit-input cal-edit-input-half" value={editForm.time}
                        onChange={(t) => setEditForm({ ...editForm, time: t.target.value })} />
                      <textarea className="cal-edit-input cal-edit-textarea" placeholder="Notes" value={editForm.notes}
                        onChange={(t) => setEditForm({ ...editForm, notes: t.target.value })} />
                      <div className="cal-edit-actions">
                        <button className="cal-edit-save" onClick={updateEvent} disabled={!editForm.title.trim()}>Save</button>
                        <button className="cal-edit-cancel" onClick={cancelEdit}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div key={`${e.source}-${e.id}`}
                      className={`cal-sidebar-event ${isPast(e.date, e.time) ? 'cal-sidebar-event-past' : ''}`}>
                      <div className="cal-sidebar-ev-bar" />
                      <div className="cal-sidebar-ev-row">
                        <div className="cal-sidebar-ev-info">
                          <span className="cal-sidebar-ev-title">{e.title}</span>
                          {e.time && <span className="cal-sidebar-ev-time">{formatTimeDisplay(e.date, e.time)}</span>}
                        </div>
                        <div className="cal-sidebar-ev-actions">
                          {e.source === 'google' && <span className="cal-source-chip-sm">G</span>}
                          <button className="cal-sidebar-edit" onClick={() => startEditEvent(e)} title="Edit">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                          </button>
                          {e.source === 'local' && (
                            <button className="cal-sidebar-delete" onClick={() => deleteEvent(e.id)} title="Delete">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      {e.notes && <span className="cal-sidebar-event-notes">{e.notes}</span>}
                      {linkedNotes(e).length > 0 && (
                        <span className="cal-sidebar-linked">Linked to {linkedNotes(e).length} note(s)</span>
                      )}
                    </div>
                  )
                ))}

                {selectedNotes.length > 0 && (
                  <>
                    <div className="cal-sidebar-subsection-title">Linked Notes</div>
                    {selectedNotes.map((n) => (
                      <div key={n.id} className="cal-sidebar-item cal-sidebar-item-clickable" onClick={() => navigate('/notes', { state: { focusNoteId: n.id } })}>
                        <span>{n.title || n.shortSummary?.slice(0, 60)}</span>
                        <span className="cal-sidebar-item-meta">{n.meetingType} · {n.audioDurationS != null ? n.audioDurationS.toFixed(0) : 0}s</span>
                      </div>
                    ))}
                  </>
                )}

                {selectedEvts.length === 0 && selectedNotes.length === 0 && (
                  <div className="cal-sidebar-empty-sm">
                    <p>Nothing scheduled for this day</p>
                    <button className="cal-sidebar-add-btn" onClick={() => { setFormData({ ...formData, date: selectedDs }); setShowForm(true); }}>+ Add Event</button>
                  </div>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
