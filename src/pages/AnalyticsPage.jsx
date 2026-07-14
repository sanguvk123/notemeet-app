import { useMemo } from 'react';
import { useNotes } from '../context/NoteContext';

function StatCard({ title, value, subtitle }) {
  return (
    <div className="analytics-card">
      <div className="analytics-card-title">{title}</div>
      <div className="analytics-card-value">{value}</div>
      {subtitle && <div className="analytics-card-subtitle">{subtitle}</div>}
    </div>
  );
}

function BarChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="analytics-chart">
      <div className="analytics-chart-title">Notes per Day</div>
      <div className="analytics-chart-bars">
        {data.map((d, i) => (
          <div key={i} className="analytics-chart-col" title={`${d.label}: ${d.count}`}>
            <div className="analytics-chart-bar" style={{ height: `${(d.count / max) * 100}%` }} />
            <div className="analytics-chart-label">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds || seconds === 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export default function AnalyticsPage() {
  const { notes } = useNotes();

  const totalMeetings = notes.length;

  const totalDuration = useMemo(() => {
    return notes.reduce((sum, n) => sum + (n.audioDurationS || 0), 0);
  }, [notes]);

  const avgDuration = totalMeetings > 0 ? totalDuration / totalMeetings : 0;

  const weekAgo = useMemo(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d;
  }, []);
  const monthAgo = useMemo(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d;
  }, []);

  const notesThisWeek = useMemo(() => {
    return notes.filter((n) => new Date(n.date) >= weekAgo).length;
  }, [notes, weekAgo]);

  const notesThisMonth = useMemo(() => {
    return notes.filter((n) => new Date(n.date) >= monthAgo).length;
  }, [notes, monthAgo]);

  const meetingTypeCounts = useMemo(() => {
    const counts = {};
    for (const n of notes) {
      const type = n.meetingType || 'other';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }, [notes]);

  const mostUsedType = useMemo(() => {
    let maxCount = 0;
    let maxType = 'N/A';
    for (const [type, count] of Object.entries(meetingTypeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        maxType = type;
      }
    }
    return maxType;
  }, [meetingTypeCounts]);

  const speakerCounts = useMemo(() => {
    const counts = {};
    for (const n of notes) {
      if (n.speakers?.length) {
        for (const s of n.speakers) {
          counts[s] = (counts[s] || 0) + 1;
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [notes]);

  const notesPerDay = useMemo(() => {
    const counts = {};
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-IN', { weekday: 'short' });
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86400000);
      counts[key] = 0;
      for (const n of notes) {
        const nd = new Date(n.date);
        if (nd >= dayStart && nd < dayEnd) {
          counts[key] = (counts[key] || 0) + 1;
        }
      }
    }
    return Object.entries(counts).map(([label, count]) => ({ label, count }));
  }, [notes]);

  return (
    <main className="main-content">
      <div className="analytics-page">
        <div className="analytics-header">
          <h1 className="analytics-title">Analytics</h1>
          <p className="analytics-subtitle">Meeting statistics and insights</p>
        </div>

        <div className="analytics-grid">
          <StatCard title="Total Meetings" value={totalMeetings} />
          <StatCard title="Total Recording Time" value={formatDuration(totalDuration)} />
          <StatCard title="Average Duration" value={formatDuration(Math.round(avgDuration))} />
          <StatCard title="This Week" value={notesThisWeek} subtitle="new meetings" />
          <StatCard title="This Month" value={notesThisMonth} subtitle="new meetings" />
          <StatCard title="Most Used Type" value={mostUsedType.charAt(0).toUpperCase() + mostUsedType.slice(1)} />
        </div>

        <div className="analytics-section">
          <BarChart data={notesPerDay} />
        </div>

        {speakerCounts.length > 0 && (
          <div className="analytics-section">
            <div className="analytics-card-title">Top Speakers</div>
            <div className="analytics-speakers">
              {speakerCounts.map(([name, count], i) => (
                <div key={i} className="analytics-speaker-row">
                  <div className="analytics-speaker-info">
                    <span className="analytics-speaker-rank">#{i + 1}</span>
                    <span className="analytics-speaker-name">{name}</span>
                  </div>
                  <span className="analytics-speaker-count">{count} meeting{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {notes.length === 0 && (
          <div className="analytics-empty">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 20V10"/>
              <path d="M12 20V4"/>
              <path d="M6 20v-6"/>
            </svg>
            <p>No data yet. Start recording meetings to see analytics.</p>
          </div>
        )}
      </div>
    </main>
  );
}
