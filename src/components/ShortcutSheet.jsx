const SHORTCUTS = [
  { keys: '⌘K', desc: 'Command palette' },
  { keys: '⌘R', desc: 'Start/Stop recording' },
  { keys: '⌘⇧N', desc: 'Show/Hide NoteMeet' },
  { keys: '⌘N', desc: 'New note' },
  { keys: '⌘⇧F', desc: 'Focus search' },
  { keys: '⌘⇧E', desc: 'Export note' },
  { keys: '⌘Z', desc: 'Undo delete' },
  { keys: 'Esc', desc: 'Close modals' },
  { keys: '?', desc: 'This shortcuts sheet' },
];

export default function ShortcutSheet({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="shortcut-overlay" onClick={onClose}>
      <div className="shortcut-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcut-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="shortcut-close" onClick={onClose}>&times;</button>
        </div>
        <div className="shortcut-grid">
          {SHORTCUTS.map((sc) => (
            <div key={sc.keys} className="shortcut-row">
              <kbd className="shortcut-keys">{sc.keys}</kbd>
              <span className="shortcut-desc">{sc.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
