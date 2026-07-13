import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/tauri';
import { NoteProvider } from './context/NoteContext';
import HomePage from './pages/HomePage';
import NotesPage from './pages/NotesPage';
import CalendarPage from './pages/CalendarPage';

function Layout() {
  return (
    <div className="app">
      <nav className="nav-sidebar">
        <div className="nav-header">
          <div className="logo">NoteMeet</div>
          <span className="badge">beta</span>
        </div>
        <div className="nav-links">
          <NavLink to="/home" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🤖</span>
            <span>Home</span>
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📝</span>
            <span>Notes</span>
          </NavLink>
          <NavLink to="/calendar" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📅</span>
            <span>Calendar</span>
          </NavLink>
        </div>
        <div className="nav-footer">
          <button className="mini-launch-btn" onClick={() => invoke('create_mini_window')} title="Open Mini Recorder">
            ⤢
          </button>
        </div>
      </nav>
      <div className="page-area">
        <Routes>
          <Route path="/home" element={<HomePage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <NoteProvider>
      <Layout />
    </NoteProvider>
  );
}
