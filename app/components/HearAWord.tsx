'use client';
import { useState } from 'react';

type Stage = 'idle' | 'loading' | 'preview' | 'exists' | 'added' | 'error';

export default function HearAWord() {
  const [input, setInput]       = useState('');
  const [stage, setStage]       = useState<Stage>('idle');
  const [preview, setPreview]   = useState<any>(null);
  const [existing, setExisting] = useState<any>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setStage('loading');
    try {
      const res  = await fetch('/api/words/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: input }),
      });
      const data = await res.json();
      if (data.error) { setStage('error'); return; }
      if (data.already_exists) { setExisting(data.word); setStage('exists'); }
      else                     { setPreview(data.preview); setStage('preview'); }
    } catch {
      setStage('error');
    }
  }

  async function handleConfirm() {
    try {
      // Fast-track path: word already in DB, send only the word_id
      const payload = preview.word_id ? { word_id: preview.word_id } : preview;
      const res  = await fetch('/api/words/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) { setStage('error'); return; }
      setStage('added');
    } catch {
      setStage('error');
    }
  }

  function reset() {
    setInput('');
    setPreview(null);
    setExisting(null);
    setStage('idle');
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <span className="tag">heard a word?</span>

      {(stage === 'idle' || stage === 'loading') && (
        <form onSubmit={handleSubmit} style={{ marginTop: 10, display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="type it, even if misspelled"
            disabled={stage === 'loading'}
            style={{ flex: 1, width: 'auto' }}
          />
          <button
            type="submit"
            className="btn btn-secondary"
            style={{ width: 'auto', padding: '0 18px', flexShrink: 0 }}
            disabled={stage === 'loading' || !input.trim()}
          >
            {stage === 'loading' ? '…' : 'Look up →'}
          </button>
        </form>
      )}

      {stage === 'preview' && preview && (
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 16 }}>{preview.lemma}</strong>{' '}
            <span className="muted">({preview.pos}{preview.gender ? `, ${preview.gender}` : ''})</span>
            {preview.definition && <>{' — '}<span>{preview.definition}</span></>}
          </div>
          {preview.example_sv && (
            <p className="muted" style={{ margin: '2px 0 14px', fontStyle: 'italic' }}>
              {preview.example_sv} — {preview.example_en}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirm}>
              {preview.word_id ? 'Add to my heard list →' : 'Add to my list'}
            </button>
            <button className="btn btn-plain" style={{ flex: 1 }} onClick={reset}>
              Not this
            </button>
          </div>
        </div>
      )}

      {stage === 'exists' && existing && (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ marginBottom: 10 }}>
            <strong>{existing.lemma}</strong> is already in your list
            {existing.source === 'user_added' ? ' (you added it)' : ' (curriculum word)'}.
          </p>
          <button className="btn btn-plain" style={{ width: 'auto', padding: '8px 16px' }} onClick={reset}>
            Got it
          </button>
        </div>
      )}

      {stage === 'added' && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: '0 0 10px' }}>
            <strong>{preview?.lemma}</strong> added — it'll come up in practice.
          </p>
          <button className="btn btn-plain" style={{ width: 'auto', padding: '8px 16px' }} onClick={reset}>
            Add another
          </button>
        </div>
      )}

      {stage === 'error' && (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ marginBottom: 10 }}>Something went wrong. Try again.</p>
          <button className="btn btn-plain" style={{ width: 'auto', padding: '8px 16px' }} onClick={reset}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
