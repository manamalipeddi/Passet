'use client';
import { useEffect, useState } from 'react';

type Use = { sv: string; en: string };
type Enrichment = { uses: Use[]; note: string };
type ShortEnrichment = { note?: string; use?: Use } | null;

type LearnItem = {
  id: string; lemma: string; pos: string | null; gender: string | null;
  answer: string; options: string[]; enrichment: Enrichment | null;
};
type QuizItem = {
  id: string; prompt: string; pos: string | null; gender: string | null;
  isNew: boolean; enrichment: ShortEnrichment;
};
type Feedback = { correct: boolean; comment: string; corrected: string };

export default function VocabPage() {
  const [stage, setStage] = useState<'loading' | 'learn' | 'quiz' | 'done' | 'error'>('loading');
  const [learn, setLearn] = useState<LearnItem[]>([]);
  const [quiz, setQuiz]   = useState<QuizItem[]>([]);
  const [meta, setMeta]   = useState<{ introducedNow: number; dailyTargetMet: boolean }>({ introducedNow: 0, dailyTargetMet: false });

  // Learn phase
  const [li, setLi] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);

  // Quiz phase
  const [qi, setQi] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [score, setScore] = useState(0);

  // Done
  const [streak, setStreak] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/vocab/session', { method: 'POST' })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        setLearn(data.learn ?? []);
        setQuiz(data.quiz ?? []);
        setMeta({ introducedNow: data.introducedNow ?? 0, dailyTargetMet: !!data.dailyTargetMet });
        setStage((data.learn ?? []).length ? 'learn' : (data.quiz ?? []).length ? 'quiz' : 'done');
      })
      .catch(() => setStage('error'));
  }, []);

  function nextLearn() {
    setPicked(null);
    if (li + 1 < learn.length) setLi(li + 1);
    else setStage(quiz.length ? 'quiz' : 'done');
  }

  async function submitQuiz() {
    setChecking(true);
    const item = quiz[qi];
    try {
      const res = await fetch('/api/vocab/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wordId: item.id, userAnswer: answer }),
      });
      const fb: Feedback = await res.json();
      setFeedback(fb);
      if (fb.correct) setScore((s) => s + 1);
    } catch {
      setFeedback({ correct: false, comment: "Couldn't reach the tutor — try again.", corrected: '' });
    } finally {
      setChecking(false);
    }
  }

  async function nextQuiz() {
    setFeedback(null);
    setAnswer('');
    if (qi + 1 < quiz.length) { setQi(qi + 1); return; }
    // Session finished — record completion (streak, etc.)
    const data = await fetch('/api/lesson/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'words' }),
    }).then((r) => r.json()).catch(() => ({}));
    setStreak(data.streak ?? null);
    setStage('done');
  }

  // ── LOADING / ERROR ──────────────────────────────────────────────────────
  if (stage === 'loading') return <div className="wrap"><div className="card">Putting today's words together…</div></div>;
  if (stage === 'error')   return <div className="wrap"><div className="card">Couldn't load your words. Check your connection and try again.</div></div>;

  // ── LEARN PHASE ──────────────────────────────────────────────────────────
  if (stage === 'learn') {
    const w = learn[li];
    const revealed = picked !== null;
    return (
      <div className="wrap">
        <span className="tag">new words</span>
        <span className="pill" style={{ marginLeft: 8 }}>{li + 1} of {learn.length}</span>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>What does this word mean?</p>
          <p style={{ fontSize: 30, fontWeight: 700, margin: '4px 0 2px', fontFamily: "'Space Grotesk',sans-serif" }}>{w.lemma}</p>
          <p className="muted" style={{ marginTop: 0 }}>{w.pos}{w.gender ? `, ${w.gender}` : ''}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {w.options.map((opt) => {
              const isCorrect = opt === w.answer;
              const isPicked  = opt === picked;
              let bg = 'var(--surface)';
              if (revealed && isCorrect) bg = '#DCEEE3';
              else if (revealed && isPicked) bg = '#FCE9D8';
              return (
                <button
                  key={opt}
                  className="btn"
                  style={{ background: bg, color: 'var(--ink)', textAlign: 'left', textTransform: 'none' }}
                  disabled={revealed}
                  onClick={() => setPicked(opt)}
                >
                  {opt}{revealed && isCorrect ? '  ✓' : revealed && isPicked ? '  ✗' : ''}
                </button>
              );
            })}
          </div>

          {revealed && (
            <>
              {w.enrichment && (w.enrichment.note || w.enrichment.uses?.length > 0) && (
                <div style={{ marginTop: 16, padding: 14, border: '2.5px solid var(--ink)', borderRadius: 12, background: 'var(--bg)' }}>
                  {w.enrichment.note && (
                    <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.5 }}>💡 {w.enrichment.note}</p>
                  )}
                  {w.enrichment.uses?.length > 0 && (
                    <>
                      <div className="eyebrow" style={{ marginBottom: 6 }}>In use</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {w.enrichment.uses.map((u, i) => (
                          <div key={i} style={{ fontSize: 14, lineHeight: 1.4 }}>
                            <div style={{ fontWeight: 600 }}>{u.sv}</div>
                            <div className="muted">{u.en}</div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={nextLearn}>
                {li + 1 < learn.length ? 'Next word →' : quiz.length ? 'Start the quiz →' : 'Finish →'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── QUIZ PHASE ───────────────────────────────────────────────────────────
  if (stage === 'quiz') {
    const item = quiz[qi];
    return (
      <div className="wrap">
        <span className="tag" style={{ background: 'var(--green)', color: '#FAF3E7' }}>quiz</span>
        <span className="pill" style={{ marginLeft: 8 }}>{qi + 1} of {quiz.length}</span>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>Type the Swedish word for:</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '4px 0 2px' }}>{item.prompt}</p>
          <p className="muted" style={{ marginTop: 0 }}>
            {item.pos}{item.gender ? `, ${item.gender}` : ''}
            {item.isNew ? ' · from today' : ' · review'}
          </p>

          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!!feedback}
            placeholder="på svenska…"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && !feedback && answer.trim()) submitQuiz(); }}
            style={{ marginTop: 8 }}
          />

          {!feedback && (
            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={submitQuiz} disabled={checking || !answer.trim()}>
              {checking ? 'Checking…' : 'Check'}
            </button>
          )}

          {feedback && (
            <>
              <div className={`feedback ${feedback.correct ? 'ok' : 'fix'}`}>
                <strong>{feedback.correct ? 'Rätt!' : 'Not quite.'}</strong> {feedback.comment}
                {!feedback.correct && feedback.corrected && (
                  <div style={{ marginTop: 8 }}>
                    <div className="eyebrow">Answer</div>
                    <div style={{ fontWeight: 700 }}>{feedback.corrected}</div>
                  </div>
                )}
              </div>

              {item.enrichment && (item.enrichment.note || item.enrichment.use) && (
                <div style={{ marginTop: 12, padding: 12, border: '2px dashed var(--ink)', borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
                  {item.enrichment.note && <div>💡 {item.enrichment.note}</div>}
                  {item.enrichment.use && (
                    <div style={{ marginTop: item.enrichment.note ? 6 : 0 }}>
                      <span style={{ fontWeight: 600 }}>{item.enrichment.use.sv}</span>
                      <span className="muted"> — {item.enrichment.use.en}</span>
                    </div>
                  )}
                </div>
              )}

              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={nextQuiz}>
                {qi + 1 < quiz.length ? 'Next' : 'Finish'}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── DONE ─────────────────────────────────────────────────────────────────
  const quizTotal = quiz.length;
  return (
    <div className="wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="tag">done</span>
        <h2 style={{ marginTop: 10 }}>Snyggt! Vocabulary done.</h2>
        {quizTotal > 0 && <p className="muted">You got {score} of {quizTotal} right.</p>}
        {streak !== null && <p className="muted">🔥 {streak} day{streak === 1 ? '' : 's'} running.</p>}

        <div style={{
          marginTop: 16, padding: 16, border: '3px solid var(--ink)', borderRadius: 12,
          background: meta.dailyTargetMet ? 'var(--mustard)' : 'var(--green)',
          boxShadow: '4px 4px 0 var(--ink)',
        }}>
          <p style={{ margin: 0, fontWeight: 700, color: meta.dailyTargetMet ? 'var(--ink)' : '#FAF3E7' }}>
            {meta.dailyTargetMet
              ? "That's your 10 new words for today — nicely done."
              : meta.introducedNow > 0
                ? `Learned ${meta.introducedNow} new ${meta.introducedNow === 1 ? 'word' : 'words'}.`
                : 'No new words left right now — good review session.'}
          </p>
        </div>

        <a href="/vocab"><button className="btn btn-secondary" style={{ marginTop: 12 }}>Do more words →</button></a>
        <a href="/"><button className="btn btn-plain" style={{ marginTop: 10 }}>Back to dashboard</button></a>
      </div>
    </div>
  );
}
