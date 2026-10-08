'use client';
import { useEffect, useRef, useState } from 'react';

// Listening / dictation: a Swedish sentence from the dedicated listening pool
// (built from already-learned vocabulary, NOT spaced repetition) is spoken aloud
// via Google TTS. You type what you heard (graded — deterministic, diacritics
// strict) and, optionally, the English translation (never graded). 10 sentences,
// stoppable after 6. Getting a sentence right twice in a row retires it.

type Item = { id: string; prompt: string; reference: string };  // prompt=English, reference=Swedish
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
  const [preparing, setPreparing] = useState(false);
  const audioCache = useRef<Map<string, string>>(new Map());   // `${slow?1:0}|${text}` → base64 mp3
  const audioEl = useRef<HTMLAudioElement | null>(null);

  const deviceSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    if (deviceSupported) window.speechSynthesis.getVoices();   // warm device voices (fallback)
    fetch('/api/listen/session', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        const sv: Item[] = (data?.sentences ?? [])
          .map((e: any) => ({ id: e.id, prompt: e.sentence_en, reference: e.sentence_sv }))
          .filter((e: Item) => e.reference);
        if (!sv.length) { setStage('error'); return; }
        setItems(sv.slice(0, TOTAL));
        setStage('practice');
      })
      .catch(() => setStage('error'));
    return () => stopAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = items[idx];

  // Warm the audio cache for the current sentence so the Play tap plays
  // instantly (and synchronously within the gesture — mobile requires that).
  useEffect(() => {
    if (stage === 'practice' && item?.reference) fetchAudio(item.reference, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, idx, item?.reference]);

  async function fetchAudio(text: string, slow: boolean): Promise<string | null> {
    const ck = `${slow ? 1 : 0}|${text}`;
    const hit = audioCache.current.get(ck);
    if (hit) return hit;
    try {
      const r = await fetch('/api/listen/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, slow }),
      });
      if (!r.ok) return null;
      const d = await r.json();
      if (d?.audio) { audioCache.current.set(ck, d.audio); return d.audio; }
    } catch { /* fall through to device voice */ }
    return null;
  }

  function stopAudio() {
    if (audioEl.current) { audioEl.current.pause(); audioEl.current = null; }
    if (deviceSupported) window.speechSynthesis.cancel();
  }

  function playBase64(b64: string) {
    const a = new Audio('data:audio/mpeg;base64,' + b64);
    audioEl.current = a;
    spokenOnce.current = true;
    a.play().catch(() => {});
  }

  function deviceSpeak(text: string, rate: number) {
    if (!deviceSupported) return;
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

  // Prefer the cloud (Google) voice; fall back to the device voice if it's not
  // configured or the call fails, so listening always works.
  async function speak(text: string, slow = false) {
    stopAudio();
    const cached = audioCache.current.get(`${slow ? 1 : 0}|${text}`);
    if (cached) { playBase64(cached); return; }   // synchronous → stays inside the tap gesture
    setPreparing(true);
    const b64 = await fetchAudio(text, slow);
    setPreparing(false);
    if (b64) playBase64(b64);
    else deviceSpeak(text, slow ? 0.6 : 0.9);
  }

  function check() {
    if (!item) return;
    const correct = normalize(heard) === normalize(item.reference) && normalize(heard).length > 0;
    setFeedback({ correct });
    setAnswered((n) => n + 1);
    if (correct) setScore((s) => s + 1);
    if (!correct && heard.trim()) setGloss('loading');
    // Record the attempt (its own 'listen' accuracy track) and, on a miss, get
    // the English meaning of what the learner actually wrote.
    fetch('/api/listen/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentenceId: item.id, userAnswer: heard, sentenceSv: item.reference, sentenceEn: item.prompt, correct }),
    })
      .then((r) => r.json())
      .then((d) => setGloss(d?.gloss ?? null))
      .catch(() => setGloss(null));
  }

  async function complete() {
    stopAudio();
    const data = await fetch('/api/lesson/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'listen' }),
    }).then((r) => r.json()).catch(() => ({}));
    setStreak(data.streak ?? null);
    setStage('done');
  }

  function next() {
    stopAudio();
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
        <>
            <p className="muted" style={{ marginTop: 0 }}>Listen, then write the Swedish you hear.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 20px' }} onClick={() => speak(item.reference)} disabled={preparing}>
                {preparing ? '…' : spokenOnce.current ? '▶ Play again' : '▶ Play'}
              </button>
              <button className="btn btn-plain" style={{ width: 'auto', padding: '12px 16px' }} onClick={() => speak(item.reference, true)} disabled={preparing}>
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
      </div>
    </div>
  );
}
