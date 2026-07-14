import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';

export default function AudioPlayer({ audioFile, onClose }) {
  const [waveform, setWaveform] = useState([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await invoke('read_audio_file', { path: audioFile });
        const samples = new Float32Array(data);
        const bars = 200;
        const chunk = Math.floor(samples.length / bars);
        const points = [];
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < chunk; j++) {
            sum += Math.abs(samples[i * chunk + j] || 0);
          }
          points.push(sum / chunk);
        }
        const max = Math.max(...points, 0.01);
        setWaveform(points.map((v) => v / max));
      } catch (e) {
        console.error('Failed to load audio:', e);
      }
    })();
  }, [audioFile]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setDuration(audio.duration);
    const onEnd = () => setPlaying(false);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoaded);
    audio.addEventListener('ended', onEnd);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoaded);
      audio.removeEventListener('ended', onEnd);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || waveform.length === 0) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const audio = audioRef.current;
      const progress = audio && duration ? audio.currentTime / duration : 0;
      const barWidth = width / waveform.length;
      const mid = height / 2;

      waveform.forEach((amp, i) => {
        const x = i * barWidth;
        const barH = amp * mid * 0.9;
        const isPlayed = i / waveform.length <= progress;
        ctx.fillStyle = isPlayed ? '#f5f5f5' : '#333';
        ctx.fillRect(x + 1, mid - barH, Math.max(barWidth - 2, 1), barH * 2);
      });

      animRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [waveform, duration]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  };

  const handleSeek = (e) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = x / rect.width;
    audio.currentTime = pct * duration;
    setCurrentTime(audio.currentTime);
  };

  const formatTime = (t) => {
    if (!t || isNaN(t)) return '0:00';
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="audio-player">
      <div className="audio-header">
        <span className="audio-title">Playback</span>
        <button className="audio-close" onClick={onClose}>&times;</button>
      </div>
      <canvas
        ref={canvasRef}
        className="audio-waveform"
        width={600}
        height={120}
        onClick={handleSeek}
      />
      <div className="audio-controls">
        <button className="audio-play-btn" onClick={togglePlay}>
          {playing ? '⏸' : '▶'}
        </button>
        <span className="audio-time">{formatTime(currentTime)}</span>
        <span className="audio-time audio-duration">{formatTime(duration)}</span>
      </div>
      <audio ref={audioRef} src={audioFile} preload="auto" />
    </div>
  );
}
