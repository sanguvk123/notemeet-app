import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

const isMini = window.location.search.includes('mini=true');
const isNotif = window.location.search.includes('notif=meeting');

if (isMini) {
  import('./MiniRecorder').then(({ default: MiniRecorder }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <MiniRecorder />
      </React.StrictMode>
    );
  });
} else if (isNotif) {
  import('./MeetingNotification').then(({ default: MeetingNotification }) => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <MeetingNotification />
      </React.StrictMode>
    );
  });
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <HashRouter>
        <App />
      </HashRouter>
    </React.StrictMode>
  );
}
