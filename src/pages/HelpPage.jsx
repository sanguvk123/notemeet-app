
const shortcuts = [
  { keys: 'Cmd+K', description: 'Open command palette' },
  { keys: 'Cmd+N', description: 'Start new recording' },
  { keys: 'Cmd+Shift+N', description: 'Stop recording' },
  { keys: 'Cmd+1–5', description: 'Navigate to pages' },
  { keys: 'Cmd+F', description: 'Search notes' },
  { keys: 'Esc', description: 'Close modals / deselect' },
  { keys: 'Enter', description: 'Go to today (calendar)' },
  { keys: '← / →', description: 'Navigate months/weeks (calendar)' },
  { keys: 'Cmd+E', description: 'Export note as Markdown' },
  { keys: 'Cmd+Backspace', description: 'Delete selected note' },
];

const features = [
  { title: 'AI Meeting Notes', desc: 'Record meetings with one click, get AI-generated summaries of key points, decisions, and discussions.' },
  { title: 'Live Transcription', desc: 'See transcription in real-time as you record, with speaker identification and timestamped segments.' },
  { title: 'Action Items', desc: 'Automatically extracted action items from meetings with checkable to-do tracking across all notes.' },
  { title: 'Calendar Integration', desc: 'Google Calendar sync and event management with meeting detection and one-click recording.' },
  { title: 'Search', desc: 'Full-text search across all notes, transcripts, action items, and summaries with type filters.' },
  { title: 'Export', desc: 'Export notes to Markdown files with all metadata, summaries, action items, and transcripts included.' },
  { title: 'Mini Recorder', desc: 'Floating recording indicator that stays accessible across all windows and screens.' },
  { title: 'Meeting Detection', desc: 'Automatically detects when you\'re in a meeting using calendar events and system audio.' },
  { title: 'Note Templates', desc: 'Pre-built templates for common meeting types including standups, client calls, and interviews.' },
  { title: 'Action Dashboard', desc: 'All action items from every meeting aggregated in one place with filtering and sorting.' },
  { title: 'Analytics', desc: 'Meeting statistics and insights including duration, frequency, speaker analysis, and trends.' },
  { title: 'Command Palette', desc: 'Cmd+K for quick actions including navigation, recording controls, and common operations.' },
];

function ShortcutRow({ keys, description }) {
  return (
    <div className="help-shortcut-row">
      <div className="help-shortcut-keys">
        {keys.split(' ').map((k, i) => (
          <span key={i} className="help-key">{k}</span>
        ))}
      </div>
      <span className="help-shortcut-desc">{description}</span>
    </div>
  );
}

function FeatureCard({ title, desc }) {
  return (
    <div className="help-feature-card">
      <h3 className="help-feature-title">{title}</h3>
      <p className="help-feature-desc">{desc}</p>
    </div>
  );
}

export default function HelpPage() {
  return (
    <main className="main-content">
      <div className="help-page">
        <div className="help-header">
          <h1 className="help-title">Help & Features</h1>
          <p className="help-subtitle">Everything you need to know about NoteMeet</p>
        </div>

        <section className="help-section">
          <h2 className="help-section-title">Keyboard Shortcuts</h2>
          <div className="help-shortcuts">
            {shortcuts.map((s, i) => (
              <ShortcutRow key={i} keys={s.keys} description={s.description} />
            ))}
          </div>
        </section>

        <section className="help-section">
          <h2 className="help-section-title">Features</h2>
          <div className="help-features-grid">
            {features.map((f, i) => (
              <FeatureCard key={i} title={f.title} desc={f.desc} />
            ))}
          </div>
        </section>

        <section className="help-section help-version-section">
          <h2 className="help-section-title">Version</h2>
          <div className="help-version">
            <span className="help-version-label">NoteMeet</span>
            <span className="help-version-number">2.1.0</span>
          </div>
        </section>
      </div>
    </main>
  );
}
