import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (dateStr === today) return 'Today';
  const tmrw = new Date(now);
  tmrw.setDate(tmrw.getDate() + 1);
  const tomorrow = `${tmrw.getFullYear()}-${String(tmrw.getMonth() + 1).padStart(2, '0')}-${String(tmrw.getDate()).padStart(2, '0')}`;
  if (dateStr === tomorrow) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function CalendarPage({ isGuest }) {
  const { notes } = useNotes();
  const [localEvents, setLocalEvents] = useState([]);
  const [googleEvents, setGoogleEvents] = useState([]);
  const [authStatus, setAuthStatus] = useState({ signedIn: false, email: '' });
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', date: '', time: '', notes: '' });
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [error, setError] = useState('');

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
    } catch (_) {}
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
    } catch (e) {
      showError(String(e));
    }
    setSyncing(false);
  };

  const signIn = async () => {
    try {
      setSyncing(true);
      setError('');
      await invoke('google_sign_in');
      const status = await invoke('google_auth_status');
      setAuthStatus({ signedIn: status.signedIn, email: status.email || '' });
      if (status.signedIn) await doSync();
    } catch (e) {
      showError(String(e));
    }
    setSyncing(false);
  };

  const signOut = async () => {
    try {
      await invoke('google_sign_out');
      setAuthStatus({ signedIn: false, email: '' });
      setGoogleEvents([]);
    } catch (_) {}
  };

  const addEvent = async () => {
    if (!formData.title.trim() || !formData.date) return;
    try {
      if (authStatus.signedIn) {
        await invoke('google_create_event', {
          title: formData.title,
          date: formData.date,
          time: formData.time || '',
          notes: formData.notes || '',
        });
        await doSync();
      } else {
        await invoke('add_calendar_event', {
          title: formData.title,
          date: formData.date,
          time: formData.time || '',
          notes: formData.notes || '',
        });
      }
      setLocalEvents((prev) => [...prev]);
      setShowForm(false);
      setFormData({ title: '', date: '', time: '', notes: '' });
      showError('Event saved');
    } catch (e) {
      showError(String(e));
    }
  };

  const deleteEvent = async (id) => {
    try {
      await invoke('delete_calendar_event', { eventId: id });
      setLocalEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (_) {}
  };

  const noteDates = notes.map(parseDateFromNote).filter(Boolean);
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
    setSelectedDate(null);
  };

  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
    setSelectedDate(null);
  };

  const dayHasNote = (day) =>
    noteDates.some((d) => d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === day);

  const allEvents = [
    ...localEvents.map((e) => ({ ...e, source: 'local' })),
    ...googleEvents.map((e) => ({ ...e, source: 'google' })),
  ];

  const dayEvents = (day) => {
    const ds = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return allEvents.filter((e) => e.date === ds);
  };

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nowStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const upcoming = [...allEvents]
    .filter((e) => e.date >= todayStr() || (e.date === todayStr() && e.time >= nowStr()))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const selectedDs = selectedDate
    ? `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`
    : null;
  const selectedEvts = selectedDs ? allEvents.filter((e) => e.date === selectedDs) : [];
  const selectedNotes = selectedDs ? notes.filter((n) => {
    const d = parseDateFromNote(n);
    return d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === selectedDate;
  }) : [];

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === currentYear && today.getMonth() === currentMonth;

  return (
    <main className="main-content cal-content">
      <div className="cal-layout">
        <div className="cal-main">
          <div className="cal-topbar">
            <div className="cal-topbar-left">
              <h1 className="cal-title">Calendar</h1>
              <span className="cal-month-label">{MONTHS[currentMonth]} {currentYear}</span>
            </div>
            <div className="cal-topbar-right">
              {!isGuest && (
                <div className="cal-google-row">
                  {syncing && <span className="sync-spinner" />}
                  {authStatus.signedIn ? (
                    <>
                      <span className="cal-google-dot-active" />
                      <button className="cal-ghost-btn" onClick={() => doSync()} disabled={syncing}>
                        Sync
                      </button>
                      <button className="cal-ghost-btn cal-ghost-btn-danger" onClick={signOut}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button className="cal-ghost-btn" onClick={signIn} disabled={syncing}>
                      {syncing ? 'Connecting...' : 'Connect Google'}
                    </button>
                  )}
                </div>
              )}
              {isGuest && <span className="guest-badge">Guest</span>}
              <button className="cal-primary-btn" onClick={() => setShowForm(!showForm)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {showForm ? 'Cancel' : 'New Event'}
              </button>
            </div>
          </div>

          {error && (
            <div className={`cal-toast ${error === 'Event saved' ? 'cal-toast-success' : 'cal-toast-error'}`}>
              {error}
            </div>
          )}

          {showForm && (
            <div className="cal-event-form">
              <input className="cal-input" placeholder="Event title" value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })} />
              <div className="cal-form-row">
                <input type="date" className="cal-input cal-input-half" value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
                <input type="time" className="cal-input cal-input-half" value={formData.time}
                  onChange={(e) => setFormData({ ...formData, time: e.target.value })} />
              </div>
              <textarea className="cal-input cal-textarea" placeholder="Notes (optional)"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })} />
              <button className="cal-primary-btn cal-primary-btn-full" onClick={addEvent}
                disabled={!formData.title.trim() || !formData.date}>
                Save Event
              </button>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="cal-upcoming-section">
              <div className="cal-section-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="2" strokeLinecap="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                <span>Upcoming</span>
              </div>
              <div className="cal-upcoming-list">
                {upcoming.slice(0, 5).map((e, i) => (
                  <div key={`${e.source}-${e.id || i}`} className="cal-upcoming-card">
                    <div className="cal-upcoming-time">
                      <span className="cal-upcoming-time-value">{e.time ? formatTimeDisplay(e.date, e.time) : 'All day'}</span>
                      <span className="cal-upcoming-date-text">{dateLabel(e.date)}</span>
                    </div>
                    <div className="cal-upcoming-info">
                      <span className="cal-upcoming-title">{e.title}</span>
                    </div>
                    {e.source === 'google' && <span className="cal-source-chip">G</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="cal-nav-bar">
            <button className="cal-nav-arrow" onClick={prevMonth}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <div className="cal-nav-dots">
              {Array.from({ length: 12 }, (_, i) => (
                <button key={i}
                  className={`cal-nav-dot ${i === currentMonth ? 'cal-nav-dot-active' : ''}`}
                  onClick={() => { setCurrentMonth(i); setSelectedDate(null); }}
                  title={MONTHS[i]} />
              ))}
            </div>
            <button className="cal-nav-arrow" onClick={nextMonth}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          <div className="cal-grid">
            {DAYS.map((d) => (
              <div key={d} className="cal-grid-header">{d}</div>
            ))}
            {Array.from({ length: firstDay }).map((_, i) => (
              <div key={`e-${i}`} className="cal-cell cal-cell-empty" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const hasNote = dayHasNote(day);
              const evts = dayEvents(day);
              const isSelected = selectedDate === day;
              const isToday = isCurrentMonth && today.getDate() === day;
              return (
                <div key={day}
                  className={`cal-cell ${isToday ? 'cal-cell-today' : ''} ${isSelected ? 'cal-cell-selected' : ''} ${hasNote || evts.length > 0 ? 'cal-cell-active' : ''}`}
                  onClick={() => setSelectedDate(selectedDate === day ? null : day)}>
                  <span className="cal-cell-num">{day}</span>
                  {(hasNote || evts.length > 0) && (
                    <div className="cal-cell-indicators">
                      {hasNote && <span className="cal-cell-dot" />}
                      {evts.some(e => e.source === 'google') && <span className="cal-cell-dot cal-cell-dot-google" />}
                      {evts.some(e => e.source === 'local') && <span className="cal-cell-dot cal-cell-dot-local" />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {selectedDate && (
          <aside className="cal-sidebar">
            <div className="cal-sidebar-header">
              <span className="cal-sidebar-date">{selectedDs}</span>
              <button className="cal-sidebar-close" onClick={() => setSelectedDate(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {selectedNotes.length > 0 && (
              <div className="cal-sidebar-section">
                <div className="cal-sidebar-section-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  Notes
                </div>
                {selectedNotes.map((n) => (
                  <div key={n.id} className="cal-sidebar-item">{n.title || n.shortSummary?.slice(0, 60)}</div>
                ))}
              </div>
            )}

            {selectedEvts.length > 0 && (
              <div className="cal-sidebar-section">
                <div className="cal-sidebar-section-title">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  Events
                </div>
                {selectedEvts.map((e) => (
                  <div key={`${e.source}-${e.id}`} className="cal-sidebar-event">
                    <div className="cal-sidebar-event-top">
                      <span className="cal-sidebar-event-title">{e.title}</span>
                      <div className="cal-sidebar-event-actions">
                        {e.source === 'google' && <span className="cal-source-chip-sm">G</span>}
                        {e.source === 'local' && (
                          <button className="cal-sidebar-delete" onClick={() => deleteEvent(e.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                    {e.time && <span className="cal-sidebar-event-time">{formatTimeDisplay(e.date, e.time)}</span>}
                  </div>
                ))}
              </div>
            )}

            {selectedNotes.length === 0 && selectedEvts.length === 0 && (
              <div className="cal-sidebar-empty">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p>Nothing scheduled for this day</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </main>
  );
}
