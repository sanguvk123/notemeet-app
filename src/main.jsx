import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import MiniRecorder from './MiniRecorder';
import './styles.css';

const isMini = window.location.search.includes('mini=true');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isMini ? <MiniRecorder /> : <App />}
  </React.StrictMode>
);
