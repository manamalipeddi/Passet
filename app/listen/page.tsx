'use client';
import { useEffect, useRef, useState } from 'react';

// Listening / dictation: a Swedish sentence (same pool as grammar practice) is
// spoken aloud via the browser's built-in text-to-speech. You type what you
// heard (graded — deterministic, diacritics strict) and, optionally, the English
// translation (never graded). 10 sentences, stoppable after 6.

type Item = { sentence_id?: string; prompt: string; reference: string };  // prompt=English, reference=Swedish
const STOP_AFTER = 6;
const TOTAL = 10;

// Normalize for a dictation match: keep Swedish letters (å/ä/ö/é are distinct —
// a wrong one is a different word), drop punctuation, ignore case/whitespace.
function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFC').toLowerCase().trim()
    .replace(/[^a-z0-9åäöé\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ListenPage() {
  const [stage, setStage] = useState<'loading' | 'practice' | 'done' | 'error'>('loading');
  const [items, setItems] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [heard, setHeard] = useState('');
  const [eng, setEng] = useState('');
  const [feedback, setFeedback] = useState<{ correct: boolean } | null>(null);
  const [gloss, setGloss] = useState<string | 'loading' | null>(null);   // English meaning of what you wrote (wrong answers)
  const [answered, setAnswered] = useState(0);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState<number | null>(null);
  const spokenOnce = useRef(false);

  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    // Nudge the voice list to load (some engines populate it lazily).
    if (supported) window.speechSynthesis.getVoices();
    fetch('/api/lesson/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'practice' }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        const sv: Item[] = (data?.exercises?.en_to_sv ?? [])
          .map((e: any) => ({ sentence_id: e.sentence_id, prompt: e.prompt, reference: e.reference }))
          .filter((e: Item) => e.reference);
        if (!sv.length) { setStage('error'); return; }
        setItems(sv.slice(0, TOTAL));
        setStage('practice');
      })
      .catch(() => setStage('error'));
    return () => { if (supported) window.speechSynthesis.cancel(); };
  }, [supported]);

  function speak(text: string, rate = 0.9) {
    if (!supported) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'sv-SE';
    const sv = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith('sv'));
    if (sv) u.voice = sv;
    u.rate = rate;
    spokenOnce.current = true;
    synth.speak(u);
  }

  const item = items[idx];

  function check() {
    if (!item) return;
    const correct = normalize(heard) === normalize(item.reference) && normalize(heard).length > 0;
    setFeedback({ correct });
    setAnswered((n) => n + 1);
    if (correct) setScore((s) => s + 1);
    // On a miss, show what the learner's Swedish actually means (not an echo).
    if (!correct && heard.trim()) {
      setGloss('loading');
      fetch('/api/listen/gloss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: heard }),
      })
        .then((r) => r.json())
        .then((d) => setGloss(d?.gloss ?? null))
        .catch(() => setGloss(null));
    }
  }

  async function complete() {
    if (supported) window.speechSynthesis.cancel();
    const data = await fetch('/api/lesson/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'listen' }),
    }).then((r) => r.json()).catch(() => ({}));
    setStreak(data.streak ?? null);
    setStage('done');
  }

  function next() {
    setFeedback(null);
    setGloss(null);
    setHeard('');
    setEng('');
    if (idx + 1 < items.length) { setIdx(idx + 1); return; }
    complete();
  }

  // ── LOADING / ERROR ──────────────────────────────────────────────────────
  if (stage === 'loading') return <div className="wrap"><div className="card">Preparing your listening set…</div></div>;
  if (stage === 'error') return (
    <div className="wrap"><div className="card">
      <p>Couldn’t build a listening set — you need some learned grammar and words first.</p>
      <a href="/"><button className="btn btn-plain" style={{ marginTop: 10 }}>Back to dashboard</button></a>
    </div></div>
  );

  // ── DONE ───────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <div className="wrap">
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="tag">done</span>
          <h2 style={{ marginTop: 10 }}>Bra lyssnat! 👂</h2>
          {answered > 0 && (
            <div style={{ margin: '12px 0 6px' }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 40, fontWeight: 700, color: 'var(--red)', lineHeight: 1 }}>
                {Math.round((score / answered) * 100)}%
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{score} of {answered} transcribed right</div>
            </div>
          )}
          {streak !== null && <p className="muted">🔥 {streak} day{streak === 1 ? '' : 's'} running.</p>}
          <a href="/listen"><button className="btn btn-secondary" style={{ marginTop: 12 }}>Listen again →</button></a>
          <a href="/"><button className="btn btn-plain" style={{ marginTop: 10 }}>Back to dashboard</button></a>
        </div>
      </div>
    );
  }

  // ── PRACTICE ─────────────────────────────────────────────────────────────
  const canStop = answered >= STOP_AFTER && idx + 1 < items.length;
  return (
    <div className="wrap">
      <span className="tag" style={{ background: 'var(--red)', color: '#fff' }}>listening</span>
      <span className="pill" style={{ marginLeft: 8 }}>{idx + 1} of {items.length}</span>
      <div className="card">
        {!supported ? (
          <p>Your browser doesn’t support speech playback. Try Chrome on your phone.</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>Listen, then write the Swedish you hear.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 20px' }} onClick={() => speak(item.reference)}>
                {spokenOnce.current ? '▶ Play again' : '▶ Play'}
              </button>
              <button className="btn btn-plain" style={{ width: 'auto', padding: '12px 16px' }} onClick={() => speak(item.reference, 0.6)}>
                🐢 Slower
              </button>
            </div>

            <p className="muted" style={{ margin: '16px 0 4px', fontSize: 12 }}>What did you hear? (graded)</p>
            <textarea
              value={heard}
              onChange={(e) => setHeard(e.target.value)}
              disabled={!!feedback}
              placeholder="på svenska…"
              autoFocus
            />

            <p className="muted" style={{ margin: '12px 0 4px', fontSize: 12 }}>English translation (optional, not graded)</p>
            <textarea
              value={eng}
              onChange={(e) => setEng(e.target.value)}
              disabled={!!feedback}
              placeholder="in English…"
            />

            {!feedback && (
              <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={check} disabled={!heard.trim()}>
                Check
              </button>
            )}

            {feedback && (
              <>
                <div className={`feedback ${feedback.correct ? 'ok' : 'fix'}`}>
                  <strong>{feedback.correct ? 'Rätt! 🎉' : 'Not quite.'}</strong>
                  <div style={{ marginTop: 10, borderTop: '1.5px dashed var(--ink)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {!feedback.correct && heard.trim() && (
                      <div>
                        <div className="eyebrow">You wrote — meaning</div>
                        <div style={{ fontStyle: 'italic' }}>
                          {heard}
                          {gloss === 'loading' ? ' — …' : gloss ? ` — “${gloss}”` : ''}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="eyebrow">The sentence</div>
                      <div style={{ fontWeight: 700 }}>{item.reference}</div>
                    </div>
                    <div>
                      <div className="eyebrow">English</div>
                      <div>{item.prompt}</div>
                      {eng.trim() && <div className="muted" style={{ fontStyle: 'italic', marginTop: 2 }}>yours: {eng}</div>}
                    </div>
                  </div>
                </div>

                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={next}>
                  {idx + 1 < items.length ? 'Next' : 'Finish'}
                </button>
                {canStop && (
                  <button className="btn btn-plain" style={{ marginTop: 10 }} onClick={complete}>
                    End here ({answered} done) →
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
