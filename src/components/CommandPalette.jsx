import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNavigate } from 'react-router-dom';

const COMMANDS = [
  { id: 'new-recording', label: 'New Recording', icon: '⏺', action: (nav, onClose) => { invoke('start_recording'); onClose(); } },
  { id: 'search-notes', label: 'Search Notes…', icon: '🔍', action: (nav, onClose) => { window.dispatchEvent(new CustomEvent('focus-search')); onClose(); } },
  { id: 'open-calendar', label: 'Open Calendar', icon: '📅', action: (nav, onClose) => { nav('/calendar'); onClose(); } },
  { id: 'open-actions', label: 'Open Actions', icon: '⚡', action: (nav, onClose) => { nav('/actions'); onClose(); } },
  { id: 'open-analytics', label: 'Open Analytics', icon: '📊', action: (nav, onClose) => { nav('/analytics'); onClose(); } },
  { id: 'export-all', label: 'Export All Notes', icon: '📦', action: (nav, onClose) => { invoke('export_all_notes'); onClose(); } },
  { id: 'help-features', label: 'Help & Features', icon: '❓', action: (nav, onClose) => { nav('/help'); onClose(); } },
  { id: 'mini-recorder', label: 'Mini Recorder', icon: '🎙', action: (nav, onClose) => { invoke('create_mini_window'); onClose(); } },
];

function highlightMatch(text, query) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="cmd-item-highlight">{part}</mark>
      : part
  );
}

export default function CommandPalette({ isOpen, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  const filtered = COMMANDS.filter((cmd) =>
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  const execute = (cmd) => {
    cmd.action(navigate, onClose);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      execute(filtered[selectedIndex]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
        />
        <div className="cmd-list">
          {filtered.map((cmd, i) => (
            <div
              key={cmd.id}
              className={`cmd-item ${i === selectedIndex ? 'highlighted' : ''}`}
              onClick={() => execute(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="cmd-item-icon">{cmd.icon}</span>
              <span className="cmd-item-label">{highlightMatch(cmd.label, query)}</span>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="cmd-empty">No matching commands</div>
          )}
        </div>
      </div>
    </div>
  );
}
