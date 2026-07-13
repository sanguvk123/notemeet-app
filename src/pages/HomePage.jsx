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
              <div className="home-welcome-icon">🤖</div>
              <h3>Ask anything about your meetings</h3>
              <p className="home-welcome-hints">
                Try questions like:<br />
                "What were the key decisions from last week?"<br />
                "Summarize all action items across my notes"<br />
                "Who was assigned to the onboarding project?"<br />
                "What was the general tone of recent meetings?"
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
