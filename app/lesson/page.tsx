'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

type Vocab = { id: string; lemma: string; pos: string; gender: string | null; forms: any; example_sv: string; example_en: string };
type Exercise = { prompt: string; reference: string; direction: 'en_to_sv' | 'sv_to_en'; sentence_id?: string };

export default function Lesson() {
  return (
    <Suspense fallback={<div className="wrap"><div className="card">Loading…</div></div>}>
      <LessonInner />
    </Suspense>
  );
}

function LessonInner() {
  const params = useSearchParams();
  const mode = params.get('mode') === 'extra' ? 'extra' : 'daily';

  const [stage, setStage] = useState<'loading' | 'vocab' | 'exercise' | 'done' | 'error'>('loading');
  const [vocab, setVocab] = useState<Vocab[]>([]);
  const [grammarPoint, setGrammarPoint] = useState<any>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [streak, setStreak] = useState<number | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);

  useEffect(() => {
    fetch('/api/lesson/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        setVocab(data.vocab);
        setGrammarPoint(data.grammarPoint);
        const ex: Exercise[] = [
          ...data.exercises.en_to_sv.map((e: any) => ({ ...e, direction: 'en_to_sv' as const, sentence_id: e.sentence_id })),
          ...data.exercises.sv_to_en.map((e: any) => ({ ...e, direction: 'sv_to_en' as const, sentence_id: e.sentence_id })),
        ];
        setExercises(ex);
        setStage('vocab');
      })
      .catch(() => setStage('error'));
  }, [mode]);

  async function submitAnswer() {
    setChecking(true);
    const current = exercises[idx];
    const res = await fetch('/api/lesson/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: current.direction,
        prompt: current.prompt,
        reference: current.reference,
        userAnswer: answer,
        wordIds: vocab.map((v) => v.id),
        grammarPointId: grammarPoint?.id,
        grammarTitle: grammarPoint?.title,
      }),
    });
    const data = await res.json();
    setFeedback(data);
    setChecking(false);
  }

  function next() {
    setFeedback(null);
    setAnswer('');
    if (idx + 1 < exercises.length) setIdx(idx + 1);
    else finish();
  }

  function excludeAndNext() {
    const sid = exercises[idx]?.sentence_id;
    if (sid) {
      fetch('/api/lesson/exclude-sentence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence_id: sid }),
      }).catch(() => {});
    }
    next();
  }

  async function finish() {
    const res = await fetch('/api/lesson/complete', { method: 'POST' });
    const data = await res.json();
    setStreak(data.streak);
    setAlreadyDone(!!data.already_done);
    setStage('done');
  }

  if (stage === 'loading') return <div className="wrap"><div className="card">Putting today's words together…</div></div>;
  if (stage === 'error') return <div className="wrap"><div className="card">Couldn't reach the tutor. Check your connection and try again.</div></div>;

  if (stage === 'vocab') {
    return (
      <div className="wrap">
        <span className="tag">today's focus</span>
        <h1 style={{ marginTop: 6 }}>{grammarPoint?.title}</h1>
        <p className="muted">{grammarPoint?.description}</p>
        <div className="card">
          {vocab.map((w) => (
            <div className="vocab-item" key={w.id}>
              <strong>{w.lemma}</strong> <span className="muted">({w.pos}{w.gender ? `, ${w.gender}` : ''})</span>
              <div className="muted">{w.example_sv} — {w.example_en}</div>
            </div>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setStage('exercise')}>
            Start the sentences →
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'exercise') {
    const current = exercises[idx];
    return (
      <div className="wrap">
        <span className="pill">{idx + 1} of {exercises.length}</span>
        <div className="card">
          <p>{current.direction === 'en_to_sv' ? 'Translate into Swedish:' : 'Translate into English:'}</p>
          <p style={{ fontSize: 18, fontWeight: 600 }}>{current.prompt}</p>
          <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={!!feedback} />
          {!feedback && (
            <button className="btn btn-secondary" style={{ marginTop: 12 }} onClick={submitAnswer} disabled={checking || !answer.trim()}>
              {checking ? 'Checking…' : 'Check my answer'}
            </button>
          )}
          {feedback && (
            <>
              <div className={`feedback ${feedback.correct ? 'ok' : 'fix'}`}>
                <strong>{feedback.correct ? 'Looks right.' : 'Almost there.'}</strong> {feedback.feedback}
                {!feedback.correct && <div style={{ marginTop: 6, fontStyle: 'italic' }}>{feedback.corrected}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={next}>
                  {idx + 1 < exercises.length ? 'Next' : 'Finish today'}
                </button>
                {exercises[idx]?.sentence_id && (
                  <button className="btn-skip" onClick={excludeAndNext} title="Don't show this sentence again">
                    🙄 skip this one
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="tag">{mode === 'extra' || alreadyDone ? 'bonus round' : 'done for today'}</span>
        <h2 style={{ marginTop: 10 }}>{mode === 'extra' || alreadyDone ? 'Nice, extra reps in the bank.' : 'Snyggt! Today\'s paus is done.'}</h2>
        <p className="muted">🔥 {streak} day{streak === 1 ? '' : 's'} running.</p>
        <a href="/"><button className="btn btn-plain" style={{ marginTop: 12 }}>Back to dashboard</button></a>
        {mode !== 'extra' && (
          <a href="/lesson?mode=extra">
            <button className="btn btn-secondary" style={{ marginTop: 10 }}>Got more time? Practice more</button>
          </a>
        )}
      </div>
    </div>
  );
}
