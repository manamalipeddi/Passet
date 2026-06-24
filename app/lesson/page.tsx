'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

type Mode = 'daily' | 'extra' | 'learn' | 'targeted' | 'words' | 'grammar';
type Vocab = { id: string; lemma: string; pos: string; gender: string | null; forms: any; example_sv: string; example_en: string };
type Exercise = { prompt: string; reference: string; direction: 'en_to_sv' | 'sv_to_en'; sentence_id?: string };
type CarryItem = { direction: 'en_to_sv' | 'sv_to_en'; prompt: string; reference: string; userAnswer: string; correct: boolean };

const LOADING_MSG: Record<Mode, string> = {
  daily:    "Putting today's words together…",
  extra:    'Pulling a practice set together…',
  learn:    'Loading next lesson in the curriculum…',
  targeted: 'Building targeted session…',
  words:    'Pulling your word practice together…',
  grammar:  'Setting up grammar practice…',
};

const STAGE_TAG: Record<Mode, string> = {
  daily:    "today's focus",
  extra:    "practice",
  learn:    'new material',
  targeted: 'targeted practice',
  words:    'word practice',
  grammar:  'grammar focus',
};

export default function Lesson() {
  return (
    <Suspense fallback={<div className="wrap"><div className="card">Loading…</div></div>}>
      <LessonInner />
    </Suspense>
  );
}

function LessonInner() {
  const params  = useSearchParams();
  const rawMode = params.get('mode') ?? 'daily';
  const mode: Mode = (['daily', 'extra', 'learn', 'targeted', 'words', 'grammar'] as const).includes(rawMode as Mode)
    ? (rawMode as Mode) : 'daily';
  const wordId   = params.get('wordId')    ?? undefined;
  const grammarId = params.get('grammarId') ?? undefined;

  const [stage, setStage]       = useState<'loading' | 'vocab' | 'exercise' | 'handoff' | 'done' | 'error'>('loading');
  const [vocab, setVocab]       = useState<Vocab[]>([]);
  const [grammarPoint, setGP]   = useState<any>(null);
  const [exercises, setEx]      = useState<Exercise[]>([]);
  const [idx, setIdx]           = useState(0);
  const [answer, setAnswer]     = useState('');
  const [feedback, setFeedback] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [streak, setStreak]     = useState<number | null>(null);
  const [alreadyDone, setDone]  = useState(false);
  const [readyForNew, setReady] = useState(false);
  const [accuracy, setAccuracy] = useState(0);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining]   = useState(false);
  // Questions flagged (by index) to carry into the tutor chat at the end of the set
  const [carryover, setCarryover]     = useState<Record<number, CarryItem>>({});

  useEffect(() => {
    fetch('/api/lesson/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, wordId, grammarId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        setVocab(data.vocab);
        setGP(data.grammarPoint);
        const ex: Exercise[] = [
          ...data.exercises.en_to_sv.map((e: any) => ({ ...e, direction: 'en_to_sv' as const })),
          ...data.exercises.sv_to_en.map((e: any) => ({ ...e, direction: 'sv_to_en' as const })),
        ];
        setEx(ex);
        // 'extra' and 'words' have no grammar intro — drop straight into sentences
        setStage(mode === 'extra' || mode === 'words' ? 'exercise' : 'vocab');
      })
      .catch(() => setStage('error'));
  }, [mode, wordId, grammarId]);

  async function submitAnswer() {
    setChecking(true);
    const current = exercises[idx];
    const res = await fetch('/api/lesson/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction:      current.direction,
        prompt:         current.prompt,
        reference:      current.reference,
        userAnswer:     answer,
        wordIds:        vocab.map((v) => v.id),
        grammarPointId: grammarPoint?.id,
        grammarTitle:   grammarPoint?.title,
      }),
    });
    setFeedback(await res.json());
    setChecking(false);
  }

  function next() {
    setFeedback(null);
    setAnswer('');
    setExplanation(null);
    setExplaining(false);
    if (idx + 1 < exercises.length) setIdx(idx + 1);
    else finish();
  }

  async function toggleExplain() {
    if (explanation) { setExplanation(null); return; }   // collapse if already shown
    setExplaining(true);
    const current = exercises[idx];
    try {
      const res = await fetch('/api/lesson/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction:          current.direction,
          prompt:             current.prompt,
          reference:          current.reference,
          userAnswer:         answer,
          grammarTitle:       grammarPoint?.title,
          grammarDescription: grammarPoint?.description,
        }),
      });
      const data = await res.json();
      setExplanation(data.explanation ?? "Couldn't load a fuller explanation — try again.");
    } catch {
      setExplanation("Couldn't load a fuller explanation — try again.");
    } finally {
      setExplaining(false);
    }
  }

  function toggleCarryover() {
    const current = exercises[idx];
    setCarryover((prev) => {
      const nextState = { ...prev };
      if (nextState[idx]) {
        delete nextState[idx];
      } else {
        nextState[idx] = {
          direction:  current.direction,
          prompt:     current.prompt,
          reference:  current.reference,
          userAnswer: answer,
          correct:    !!feedback?.correct,
        };
      }
      return nextState;
    });
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

  function composeStudyMessage(items: CarryItem[]) {
    const lines = items.map((it, i) => {
      const dir = it.direction === 'en_to_sv' ? 'English to Swedish' : 'Swedish to English';
      const detail = it.correct
        ? `I translated it correctly as "${it.reference}".`
        : `I answered "${it.userAnswer || '(left blank)'}", but the correct answer is "${it.reference}".`;
      return `${i + 1}. Translate ${dir}: "${it.prompt}". ${detail}`;
    });
    return `I just finished a practice set and want to understand these sentences better. ` +
      `For each one below, please explain the grammar simply and give one or two more examples that follow the same pattern.\n\n` +
      lines.join('\n');
  }

  async function finish() {
    const items = Object.values(carryover);
    if (items.length) setStage('handoff');

    // Record completion once (streak, readiness, etc.)
    const data = await fetch('/api/lesson/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    }).then((r) => r.json()).catch(() => ({}));

    // If anything was flagged, drop it into the tutor chat and jump there
    if (items.length) {
      const ok = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: composeStudyMessage(items) }),
      }).then((r) => r.ok).catch(() => false);
      if (ok) { window.location.assign('/chat'); return; }
      // chat send failed — fall through to the normal done screen
    }

    setStreak(data.streak ?? null);
    setDone(!!data.already_done);
    setReady(!!data.ready_for_new);
    setAccuracy(data.recent_accuracy ?? 0);
    setStage('done');
  }

  if (stage === 'loading') return <div className="wrap"><div className="card">{LOADING_MSG[mode]}</div></div>;
  if (stage === 'error')   return <div className="wrap"><div className="card">Couldn't reach the tutor. Check your connection and try again.</div></div>;
  if (stage === 'handoff') return <div className="wrap"><div className="card">Saving your flagged questions to the tutor chat…</div></div>;

  if (stage === 'vocab') {
    return (
      <div className="wrap">
        <span className="tag">{STAGE_TAG[mode]}</span>
        <h1 style={{ marginTop: 6 }}>{grammarPoint?.title ?? (mode === 'targeted' ? 'Targeted practice' : 'Vocabulary')}</h1>
        <p className="muted">{grammarPoint?.description}</p>
        <div className="card">
          {vocab.map((w) => (
            <div className="vocab-item" key={w.id}>
              <strong>{w.lemma}</strong>{' '}
              <span className="muted">({w.pos}{w.gender ? `, ${w.gender}` : ''})</span>
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
                {!feedback.correct && (
                  <div style={{ marginTop: 12, borderTop: '1.5px dashed var(--ink)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 2 }}>You wrote</div>
                      <div style={{ fontStyle: 'italic' }}>{answer}</div>
                    </div>
                    {feedback.user_answer_translation && current.direction === 'en_to_sv' && (
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 2 }}>Your answer means</div>
                        <div>{feedback.user_answer_translation}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 2 }}>Correct</div>
                      <div style={{ fontWeight: 700 }}>{feedback.corrected}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Dig deeper / flag for chat */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: 10, marginTop: 12 }}>
                <button
                  className="btn btn-plain"
                  style={{ width: 'auto', padding: '8px 14px', fontSize: 13, flexShrink: 0 }}
                  onClick={toggleExplain}
                  disabled={explaining}
                >
                  {explaining ? 'Explaining…' : explanation ? 'Hide explanation' : 'Explain more'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <input type="checkbox" checked={!!carryover[idx]} onChange={toggleCarryover} />
                  Study this in chat
                </label>
              </div>

              {explanation && (
                <div style={{
                  marginTop: 12,
                  padding: 14,
                  border: '2.5px solid var(--ink)',
                  borderRadius: 12,
                  background: 'var(--surface)',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                }}>
                  {explanation}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={next}>
                  {idx + 1 < exercises.length
                    ? 'Next'
                    : Object.keys(carryover).length > 0
                      ? 'Finish & study in chat →'
                      : (mode === 'daily' ? 'Finish today' : 'Finish')}
                </button>
                {current.sentence_id && (
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

  // Done stage
  const doneTag = mode === 'learn' ? 'new material added'
    : mode === 'targeted' ? 'targeted session'
    : (mode === 'extra' || alreadyDone) ? 'bonus round'
    : 'done for today';

  const doneHead = mode === 'learn' ? 'Added to your curriculum.'
    : mode === 'targeted' ? 'Targeted practice done. 🎯'
    : (mode === 'extra' || alreadyDone) ? 'Nice, extra reps in the bank.'
    : "Snyggt! Today's paus is done.";

  return (
    <div className="wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="tag">{doneTag}</span>
        <h2 style={{ marginTop: 10 }}>{doneHead}</h2>
        {streak !== null && <p className="muted">🔥 {streak} day{streak === 1 ? '' : 's'} running.</p>}
        {readyForNew && (
          <div style={{
            marginTop: 16,
            padding: 16,
            border: '3px solid var(--ink)',
            borderRadius: 12,
            background: 'var(--green)',
            boxShadow: '4px 4px 0 var(--ink)',
          }}>
            <p style={{ margin: '0 0 10px', fontWeight: 700, color: '#FAF3E7' }}>
              🌟 {Math.round(accuracy * 100)}% right lately — you're ready for something new.
            </p>
            <a href="/lesson?mode=learn">
              <button className="btn btn-secondary">Learn something new →</button>
            </a>
          </div>
        )}
        <a href="/"><button className="btn btn-plain" style={{ marginTop: 12 }}>Back to dashboard</button></a>
        {mode === 'learn' && (
          <a href="/lesson?mode=learn">
            <button className="btn btn-secondary" style={{ marginTop: 10 }}>Learn more new material</button>
          </a>
        )}
        {mode === 'daily' && (
          <a href="/lesson?mode=extra">
            <button className="btn btn-secondary" style={{ marginTop: 10 }}>Got more time? Practice more</button>
          </a>
        )}
      </div>
    </div>
  );
}
