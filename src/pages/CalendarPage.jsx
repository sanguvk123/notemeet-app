import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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

export default function CalendarPage() {
  const { notes } = useNotes();
  const [events, setEvents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', date: '', time: '', notes: '' });
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);

  useEffect(() => {
    invoke('load_calendar_events').then((data) => {
      if (data?.length) setEvents(data);
    }).catch(console.error);
  }, []);

  const noteDates = notes
    .map(parseDateFromNote)
    .filter(Boolean);

  const addEvent = async () => {
    if (!formData.title.trim() || !formData.date) return;
    try {
      const newEvent = await invoke('add_calendar_event', {
        title: formData.title,
        date: formData.date,
        time: formData.time || '',
        notes: formData.notes || '',
      });
      setEvents((prev) => [...prev, newEvent]);
      setShowForm(false);
      setFormData({ title: '', date: '', time: '', notes: '' });
    } catch (e) {
      console.error(e);
    }
  };

  const deleteEvent = async (id) => {
    try {
      await invoke('delete_calendar_event', { eventId: id });
      setEvents((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const dayHasNote = (day) => {
    return noteDates.some((d) =>
      d.getFullYear() === currentYear &&
      d.getMonth() === currentMonth &&
      d.getDate() === day
    );
  };

  const dayEvents = (day) => {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter((e) => e.date === dateStr);
  };

  return (
    <main className="main-content calendar-content">
      <div className="calendar-container">
        <div className="calendar-header">
          <h1>Calendar</h1>
          <button className="calendar-add-btn" onClick={() => setShowForm(!showForm)}>
            {showForm ? '✕ Cancel' : '+ New Event'}
          </button>
        </div>

        {showForm && (
          <div className="calendar-form">
            <input
              className="title-input" placeholder="Event title" value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
            <input
              type="date" className="title-input" value={formData.date}
              onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            />
            <input
              type="time" className="title-input" value={formData.time}
              onChange={(e) => setFormData({ ...formData, time: e.target.value })}
            />
            <textarea
              className="title-input calendar-notes-input" placeholder="Notes (optional)"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
            <button className="record-btn" onClick={addEvent} disabled={!formData.title.trim() || !formData.date}>
              Save Event
            </button>
          </div>
        )}

        <div className="calendar-nav">
          <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
          <span className="cal-nav-label">{MONTHS[currentMonth]} {currentYear}</span>
          <button className="cal-nav-btn" onClick={nextMonth}>›</button>
        </div>

        <div className="calendar-grid">
          {DAYS.map((d) => (
            <div key={d} className="cal-day-header">{d}</div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="cal-day empty" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const hasNote = dayHasNote(day);
            const dayEvts = dayEvents(day);
            const isSelected = selectedDate === day;
            const today = new Date();
            const isToday = today.getFullYear() === currentYear && today.getMonth() === currentMonth && today.getDate() === day;
            return (
              <div
                key={day}
                className={`cal-day ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${hasNote ? 'has-note' : ''}`}
                onClick={() => setSelectedDate(selectedDate === day ? null : day)}
              >
                <span className="cal-day-num">{day}</span>
                {hasNote && <span className="cal-note-dot" />}
                {dayEvts.length > 0 && <span className="cal-event-dot" />}
              </div>
            );
          })}
        </div>

        {selectedDate && (() => {
          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`;
          const dayEvts = events.filter((e) => e.date === dateStr);
          const dayNotes = notes.filter((n) => {
            const d = parseDateFromNote(n);
            return d && d.getFullYear() === currentYear && d.getMonth() === currentMonth && d.getDate() === selectedDate;
          });
          return (
            <div className="calendar-day-detail">
              <h3>{dateStr}</h3>
              {dayNotes.length > 0 && (
                <div className="cal-detail-section">
                  <h4>Meeting Notes</h4>
                  {dayNotes.map((n) => (
                    <div key={n.id} className="cal-detail-item">{n.title || n.shortSummary?.slice(0, 60)}</div>
                  ))}
                </div>
              )}
              {dayEvts.length > 0 && (
                <div className="cal-detail-section">
                  <h4>Events</h4>
                  {dayEvts.map((e) => (
                    <div key={e.id} className="cal-detail-item">
                      <div className="cal-detail-item-header">
                        <strong>{e.title}</strong>
                        <button className="cal-delete-btn" onClick={() => deleteEvent(e.id)}>✕</button>
                      </div>
                      {e.time && <span className="cal-detail-time">{e.time}</span>}
                      {e.notes && <p className="cal-detail-notes">{e.notes}</p>}
                    </div>
                  ))}
                </div>
              )}
              {dayNotes.length === 0 && dayEvts.length === 0 && (
                <p className="cal-no-events">No notes or events for this day</p>
              )}
            </div>
          );
        })()}
      </div>
    </main>
  );
}
