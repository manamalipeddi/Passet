'use client';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  suggestedWords?: string[];
};

type WordStatus = 'idle' | 'adding' | 'added' | 'exists' | 'error';

export default function ChatInterface({ initialMessages }: { initialMessages: Message[] }) {
  const [messages, setMessages]     = useState<Message[]>(initialMessages);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [wordStatus, setWordStatus] = useState<Record<string, WordStatus>>({});
  const [navH, setNavH]             = useState(50);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Measure actual nav height so the fixed panel sits flush against it
  useLayoutEffect(() => {
    const nav = document.querySelector('nav');
    if (nav) setNavH(Math.ceil(nav.getBoundingClientRect().height));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 2 ? 'smooth' : 'instant' });
  }, [messages, loading]);

  function resizeTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res  = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong — try again.', suggestedWords: [] }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply, suggestedWords: data.suggestedWords ?? [] }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "Couldn't reach the tutor. Check your connection.", suggestedWords: [] }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  async function addWord(word: string, msgIdx: number) {
    const key = `${msgIdx}-${word}`;
    setWordStatus(p => ({ ...p, [key]: 'adding' }));
    try {
      const addRes  = await fetch('/api/words/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: word }),
      });
      const addData = await addRes.json();
      if (addData.already_exists) { setWordStatus(p => ({ ...p, [key]: 'exists' })); return; }

      const payload = addData.preview.word_id ? { word_id: addData.preview.word_id } : addData.preview;
      const confRes  = await fetch('/api/words/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const confData = await confRes.json();
      setWordStatus(p => ({ ...p, [key]: confData.error ? 'error' : 'added' }));
    } catch {
      setWordStatus(p => ({ ...p, [key]: 'error' }));
    }
  }

  return (
    /*
     * position:fixed from nav-bottom to screen-bottom.
     * CSS grid rows: [section-header auto] [messages 1fr] [input auto]
     * Messages row scrolls internally; input row sticks to the bottom
     * regardless of content height or mobile keyboard state.
     */
    <div style={{
      position: 'fixed',
      top: navH, bottom: 0, left: 0, right: 0,
      display: 'grid',
      gridTemplateRows: 'auto 1fr auto',
      background: 'var(--bg)',
    }}>

      {/* ── Section header ─────────────────────────────────────── */}
      <div style={{ borderBottom: '2.5px solid var(--ink)' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '12px 20px' }}>
          <span className="tag">swedish tutor</span>
        </div>
      </div>

      {/* ── Messages (scrolls) ─────────────────────────────────── */}
      <div style={{ overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.length === 0 && (
            <p className="muted" style={{ textAlign: 'center', marginTop: 48 }}>
              Ask me anything about Swedish — grammar, vocabulary, how to say something.
            </p>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                background: msg.role === 'user' ? 'var(--ink)' : 'var(--surface)',
                color: msg.role === 'user' ? '#FAF3E7' : 'var(--ink)',
                border: msg.role === 'assistant' ? '2.5px solid var(--ink)' : 'none',
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>

              {msg.role === 'assistant' && (msg.suggestedWords?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, paddingLeft: 2 }}>
                  {msg.suggestedWords!.map(word => {
                    const key    = `${idx}-${word}`;
                    const status = wordStatus[key] ?? 'idle';
                    const done   = status === 'added' || status === 'exists';
                    return (
                      <button
                        key={word}
                        onClick={() => addWord(word, idx)}
                        disabled={status !== 'idle'}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                          border: '2px solid var(--ink)',
                          background: done ? '#DCEEE3' : 'var(--surface)',
                          color: 'var(--ink)',
                          cursor: status === 'idle' ? 'pointer' : 'default',
                          opacity: status === 'error' ? 0.45 : 1,
                          transition: 'background .15s',
                        }}
                      >
                        {status === 'idle'   && <>＋ {word}</>}
                        {status === 'adding' && <>… {word}</>}
                        {status === 'added'  && <>{word} ✓</>}
                        {status === 'exists' && <>{word} ✓</>}
                        {status === 'error'  && <>{word} ✕ retry</>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'flex-start' }}>
              <div style={{
                padding: '10px 14px',
                borderRadius: '4px 16px 16px 16px',
                background: 'var(--surface)',
                border: '2.5px solid var(--ink)',
                fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic',
              }}>
                Tutor is thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input (always visible at bottom) ───────────────────── */}
      <div style={{ borderTop: '2.5px solid var(--ink)', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 620, margin: '0 auto', padding: '12px 20px 16px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => { setInput(e.target.value); resizeTextarea(); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about Swedish…"
              rows={1}
              disabled={loading}
              style={{ flex: 1, width: 'auto', resize: 'none', overflowY: 'hidden', lineHeight: 1.5 }}
            />
            <button
              className="btn btn-primary"
              onClick={send}
              disabled={loading || !input.trim()}
              style={{ width: 'auto', padding: '10px 20px', flexShrink: 0, alignSelf: 'flex-end' }}
            >
              Send
            </button>
          </div>
          <p className="muted" style={{ margin: '6px 0 0', fontSize: 11 }}>Enter to send · Shift+Enter for new line</p>
        </div>
      </div>

    </div>
  );
}
