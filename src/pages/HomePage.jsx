import { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useNotes } from '../context/NoteContext';

export default function HomePage() {
  const { notes } = useNotes();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatRef = useRef(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = { role: 'user', content: input };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const allNotesJson = JSON.stringify(notes);
      const reply = await invoke('ask_all_notes', { allNotesJson, question: input, history });
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e}` }]);
    }
    setLoading(false);
  };

  return (
    <main className="main-content home-content">
      <div className="home-container">
        <div className="home-header">
          <h1>AI Assistant</h1>
          <p className="home-subtitle">
            Ask questions across all your meeting notes — summaries, decisions, action items, or anything discussed.
          </p>
        </div>

        <div className="home-chat" ref={chatRef}>
          {messages.length === 0 && (
            <div className="home-chat-welcome">
              <div className="home-welcome-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3l1.5 3.5L17 5l-1.5 4.5L17 14l-3.5-1.5L12 16l-1.5-3.5L7 14l1.5-4.5L7 5l3.5 1.5L12 3z"/>
                  <path d="M5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/>
                  <path d="M19 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z"/>
                </svg>
              </div>
              <h3>Ask anything about your meetings</h3>
              <p className="home-welcome-hints">
                Try asking:<br />
                "Summarize last week's key decisions"<br />
                "What are all my open action items?"<br />
                "Give me a brief of every meeting this month"<br />
                "What was discussed in the standup?"
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`chat-msg ${m.role}`}>
              <div className="chat-msg-content">{m.content}</div>
            </div>
          ))}
          {loading && (
            <div className="chat-msg assistant">
              <div className="chat-msg-content">
                <span className="chat-typing">Thinking...</span>
              </div>
            </div>
          )}
        </div>

        <div className="home-input-row">
          <input
            className="chat-input"
            placeholder="Ask about all your notes..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button className="chat-send" onClick={sendMessage} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </div>
    </main>
  );
}
