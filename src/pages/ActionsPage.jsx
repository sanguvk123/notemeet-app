import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotes } from '../context/NoteContext';
import { useToast } from '../components/ToastContext';

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );
}

export default function ActionsPage() {
  const { notes } = useNotes();
  const navigate = useNavigate();
  const showToast = useToast();

  const [checkedItems, setCheckedItems] = useState(() => {
    try {
      const saved = localStorage.getItem('actionItems_checked');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');

  useEffect(() => {
    try {
      localStorage.setItem('actionItems_checked', JSON.stringify(checkedItems));
    } catch {}
  }, [checkedItems]);

  const actionItems = useMemo(() => {
    const items = [];
    for (const note of notes) {
      if (note.actionItems?.length) {
        for (const text of note.actionItems) {
          const key = `${note.id}-${text}`;
          items.push({
            key,
            text,
            noteId: note.id,
            noteTitle: note.title || 'Untitled',
            date: note.date,
            done: !!checkedItems[key],
          });
        }
      }
    }
    if (sortBy === 'date') {
      items.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    return items;
  }, [notes, checkedItems, sortBy]);

  const filteredItems = useMemo(() => {
    if (filter === 'open') return actionItems.filter((i) => !i.done);
    if (filter === 'done') return actionItems.filter((i) => i.done);
    return actionItems;
  }, [actionItems, filter]);

  const toggleItem = (key) => {
    setCheckedItems((prev) => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  };

  const groupedByNote = useMemo(() => {
    if (sortBy !== 'note') return null;
    const groups = {};
    for (const item of filteredItems) {
      if (!groups[item.noteId]) groups[item.noteId] = [];
      groups[item.noteId].push(item);
    }
    return groups;
  }, [filteredItems, sortBy]);

  const openCount = actionItems.filter((i) => !i.done).length;
  const doneCount = actionItems.filter((i) => i.done).length;

  return (
    <main className="main-content">
      <div className="actions-page">
        <div className="actions-header">
          <h1 className="actions-title">Action Items</h1>
          <p className="actions-subtitle">{openCount} open · {doneCount} done</p>
        </div>

        <div className="actions-toolbar">
          <div className="actions-filters">
            <button className={`actions-filter-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
              All <span className="actions-filter-count">{actionItems.length}</span>
            </button>
            <button className={`actions-filter-btn ${filter === 'open' ? 'active' : ''}`} onClick={() => setFilter('open')}>
              Open <span className="actions-filter-count">{openCount}</span>
            </button>
            <button className={`actions-filter-btn ${filter === 'done' ? 'active' : ''}`} onClick={() => setFilter('done')}>
              Done <span className="actions-filter-count">{doneCount}</span>
            </button>
          </div>
          <select className="actions-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date">Sort by Date</option>
            <option value="note">Sort by Note</option>
          </select>
        </div>

        {filteredItems.length === 0 ? (
          <div className="actions-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            <p>No action items found</p>
          </div>
        ) : sortBy === 'note' && groupedByNote ? (
          Object.entries(groupedByNote).map(([noteId, items]) => {
            const note = notes.find((n) => n.id === noteId);
            return (
              <div key={noteId} className="actions-group">
                <button className="actions-group-header" onClick={() => navigate('/notes', { state: { focusNoteId: noteId } })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                  <span className="actions-group-title">{note?.title || 'Untitled'}</span>
                  <span className="actions-group-meta">{items.length} items</span>
                </button>
                <div className="actions-items">
                  {items.map((item) => (
                    <div key={item.key} className={`actions-item ${item.done ? 'actions-item-done' : ''}`}>
                      <button className={`actions-checkbox ${item.done ? 'actions-checkbox-checked' : ''}`} onClick={() => toggleItem(item.key)}>
                        {item.done && <CheckIcon />}
                      </button>
                      <span className="actions-item-text">{item.text}</span>
                      <span className="actions-item-date">{new Date(item.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <div className="actions-items">
            {filteredItems.map((item) => (
              <div key={item.key} className={`actions-item ${item.done ? 'actions-item-done' : ''}`}>
                <button className={`actions-checkbox ${item.done ? 'actions-checkbox-checked' : ''}`} onClick={() => toggleItem(item.key)}>
                  {item.done && <CheckIcon />}
                </button>
                <span className="actions-item-text">{item.text}</span>
                <div className="actions-item-right">
                  <button className="actions-item-note" onClick={() => navigate('/notes', { state: { focusNoteId: item.noteId } })}>
                    {item.noteTitle}
                  </button>
                  <span className="actions-item-date">{new Date(item.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
