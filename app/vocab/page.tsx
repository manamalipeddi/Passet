'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

type Use = { sv: string; en: string };
type IntroItem = {
  id: string; wordId: string; prompt: string; label: string | null; kind: string;
  answer: string; note: string | null; example: Use | null;
};
type QuizItem = {
  id: string; wordId: string; prompt: string; label: string | null; kind: string;
  isNew: boolean; note: string | null; example: Use | null;
};
type Feedback = {
  correct: boolean; comment: string; corrected: string;
  userAnswerMeaning: string | null; mastered: boolean;
};
// A question flagged to forward to the tutor at the end of the session.
type CarryItem = {
  prompt: string; label: string | null; correctAnswer: string;
  userAnswer: string; correct: boolean; explanation: string; note: string;
};
type SegKind = 'drill' | 'review' | 'practice';
type Segment = { kind: SegKind; items: QuizItem[] };

const PRACTICE_MIN_TO_END = 25;   // practice counts as done once you've answered this many

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function VocabPage() {
  return (
    <Suspense fallback={<div className="wrap"><div className="card">Loading…</div></div>}>
      <VocabInner />
    </Suspense>
  );
}

function VocabInner() {
  const params = useSearchParams();
  const mode: 'new' | 'review' | 'practice' =
    params.get('mode') === 'review' ? 'review' : params.get('mode') === 'practice' ? 'practice' : 'new';

  const [stage, setStage] = useState<'loading' | 'intro' | 'quiz' | 'routing' | 'done' | 'error'>('loading');
  const [intro, setIntro] = useState<IntroItem[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [meta, setMeta] = useState<{ introducedNow: number; dailyTargetMet: boolean }>({ introducedNow: 0, dailyTargetMet: false });

  // Intro phase (new flow only)
  const [ii, setII] = useState(0);
  const [introTyped, setIntroTyped] = useState('');

  // Quiz phases (drill / review / practice)
  const [segIdx, setSegIdx] = useState(0);
  const [qi, setQi] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [checking, setChecking] = useState(false);
  const [answered, setAnswered] = useState(0);   // graded answers this session (for score + practice cap)
  const [score, setScore] = useState(0);

  // Questions flagged to forward to the tutor, keyed by "<segIdx>-<qi>".
  const [carryover, setCarryover] = useState<Record<string, CarryItem>>({});

  // Done
  const [streak, setStreak] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState(false);

  useEffect(() => {
    fetch('/api/vocab/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setStage('error'); return; }
        const introItems: IntroItem[] = data.intro ?? [];
        const reviewItems: QuizItem[] = data.review ?? [];
        setIntro(introItems);
        setMeta({ introducedNow: data.introducedNow ?? 0, dailyTargetMet: !!data.dailyTargetMet });

        if (mode === 'practice') {
          setSegments([{ kind: 'practice', items: reviewItems }]);
        } else if (mode === 'review') {
          setSegments([{ kind: 'review', items: reviewItems }]);
        } else {
          // New flow: drill the just-introduced items, then review the old ones.
          const segs: Segment[] = [];
          if (introItems.length) {
            segs.push({ kind: 'drill', items: shuffle(introItems.map(introToQuiz)) });
          }
          if (reviewItems.length) segs.push({ kind: 'review', items: reviewItems });
          setSegments(segs);
        }

        if (mode === 'new' && introItems.length) setStage('intro');
        else if (reviewItems.length) setStage('quiz');
        else setStage('done');

        if (data.bufferLow) fetch('/api/vocab/topup', { method: 'POST' }).catch(() => {});
      })
      .catch(() => setStage('error'));
  }, [mode]);

  function introToQuiz(it: IntroItem): QuizItem {
    return { id: it.id, wordId: it.wordId, prompt: it.prompt, label: it.label, kind: it.kind, isNew: true, note: it.note, example: it.example };
  }

  function nextIntro() {
    setIntroTyped('');
    if (ii + 1 < intro.length) setII(ii + 1);
    else setStage(segments.length ? 'quiz' : 'done');
  }

  const seg = segments[segIdx];

  async function submitQuiz() {
    setChecking(true);
    const item = seg.items[qi];
    try {
      const res = await fetch('/api/vocab/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id, userAnswer: answer }),
      });
      const fb: Feedback = await res.json();
      setFeedback(fb);
      setAnswered((n) => n + 1);
      if (fb.correct) setScore((s) => s + 1);
    } catch {
      setFeedback({ correct: false, comment: "Couldn't reach the tutor — try again.", corrected: '', userAnswerMeaning: null, mastered: false });
    } finally {
      setChecking(false);
    }
  }

  // Flag / unflag the current answered item to forward to the tutor.
  function toggleCarryover() {
    const item = seg.items[qi];
    const key = `${segIdx}-${qi}`;
    setCarryover((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = {
        prompt: item.prompt,
        label: item.label,
        correctAnswer: feedback?.corrected ?? '',
        userAnswer: answer,
        correct: !!feedback?.correct,
        explanation: (feedback?.comment ?? '').trim(),
        note: '',
      };
      return next;
    });
  }

  // Update the typed question/doubt for a flagged item.
  function setCarryoverNote(key: string, note: string) {
    setCarryover((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], note } } : prev));
  }

  // Build the message sent to the tutor: for each flagged item, the whole
  // question, the correct answer, my answer, the app's explanation, and an
  // up-front note telling the tutor what to do with them.
  function composeStudyMessage(items: CarryItem[]) {
    const lines = items.map((it, i) => {
      const mine = it.correct
        ? `My answer (correct): "${it.userAnswer || '(left blank)'}"`
        : `My answer: "${it.userAnswer || '(left blank)'}"`;
      const expl = it.explanation ? `\n   What the app told me: "${it.explanation}"` : '';
      const q = it.note?.trim() ? `\n   My question: ${it.note.trim()}` : '';
      return `${i + 1}. Translate to Swedish: "${it.prompt}"${it.label ? ` (${it.label})` : ''}\n   Correct answer: "${it.correctAnswer}"\n   ${mine}${expl}${q}`;
    });
    return `I just finished a Swedish vocabulary practice session and flagged these words/phrases to go over with you.\n\n` +
      `Where I wrote "My question", answer that directly. Otherwise, explain what it means and how it's used, why my answer was right or wrong, and give one or two more example sentences using it.\n\n` +
      lines.join('\n\n');
  }

  async function complete() {
    const flagged = Object.values(carryover);
    if (flagged.length) setStage('routing');

    // Vocab always completes as a 'words' session (updates the vocab streak/last-seen).
    const data = await fetch('/api/lesson/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'words' }),
    }).then((r) => r.json()).catch(() => ({}));

    // Anything flagged goes to the tutor chat, then we jump there. The chat
    // route saves the question before calling the tutor, so it's never lost.
    if (flagged.length) {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: composeStudyMessage(flagged) }),
      }).catch(() => {});
      window.location.assign('/chat');
      return;
    }

    setStreak(data.streak ?? null);
    setNewRecord(!!data.newRecord);
    setStage('done');
  }

  async function nextQuiz() {
    setFeedback(null);
    setAnswer('');
    if (qi + 1 < seg.items.length) { setQi(qi + 1); return; }
    // Segment finished — move to the next one, or complete the session.
    if (segIdx + 1 < segments.length) { setSegIdx(segIdx + 1); setQi(0); return; }
    await complete();
  }

  // Practice can be ended early once you've answered enough — it still counts.
  async function endPractice() {
    setFeedback(null);
    await complete();
  }

  // ── LOADING / ERROR / ROUTING ────────────────────────────────────────────
  if (stage === 'loading') return <div className="wrap"><div className="card">{mode === 'new' ? "Putting today's words together…" : 'Pulling your practice together…'}</div></div>;
  if (stage === 'error')   return <div className="wrap"><div className="card">Couldn't load your words. Check your connection and try again.</div></div>;
  if (stage === 'routing') return <div className="wrap"><div className="card">Hold on — routing you to the tutor with your flagged words. This takes a moment…</div></div>;

  // ── INTRO PHASE (new flow) ───────────────────────────────────────────────
  if (stage === 'intro') {
    const item = intro[ii];
    return (
      <div className="wrap">
        <span className="tag">new words</span>
        <span className="pill" style={{ marginLeft: 8 }}>{ii + 1} of {intro.length}</span>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>New{item.label ? ` · ${item.label}` : ''} — meet it, then type it once to lock it in.</p>
          <p style={{ fontSize: 16, margin: '4px 0 2px' }}>{item.prompt}</p>
          <p style={{ fontSize: 30, fontWeight: 700, margin: '2px 0 10px', fontFamily: "'Space Grotesk',sans-serif" }}>{item.answer}</p>

          {(item.note || item.example) && (
            <div style={{ margin: '4px 0 12px', padding: 12, border: '2px dashed var(--ink)', borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
              {item.note && <div>💡 {item.note}</div>}
              {item.example && (
                <div style={{ marginTop: item.note ? 6 : 0 }}>
                  <span style={{ fontWeight: 600 }}>{item.example.sv}</span>
                  <span className="muted"> — {item.example.en}</span>
                </div>
              )}
            </div>
          )}

          <input
            value={introTyped}
            onChange={(e) => setIntroTyped(e.target.value)}
            placeholder="type it here…"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && introTyped.trim()) nextIntro(); }}
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={nextIntro} disabled={!introTyped.trim()}>
            {ii + 1 < intro.length ? 'Next word →' : 'Start the drill →'}
          </button>
        </div>
      </div>
    );
  }

  // ── QUIZ PHASES (drill / review / practice) ──────────────────────────────
  if (stage === 'quiz' && seg) {
    const item = seg.items[qi];
    const isPractice = seg.kind === 'practice';
    const tagText = seg.kind === 'drill' ? 'drill' : seg.kind === 'practice' ? 'practice' : 'review';
    // Items answered in this segment so far — drives the practice countdown.
    const answeredInSeg = qi + (feedback ? 1 : 0);
    const remaining = seg.items.length - answeredInSeg;
    const canEndPractice = isPractice && answered >= PRACTICE_MIN_TO_END;
    return (
      <div className="wrap">
        <span className="tag" style={{ background: 'var(--green)', color: '#FAF3E7' }}>{tagText}</span>
        <span className="pill" style={{ marginLeft: 8 }}>
          {isPractice ? `${remaining} of ${seg.items.length} left` : `${qi + 1} of ${seg.items.length}`}
        </span>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            {seg.kind === 'drill' ? 'From memory now — type the Swedish for:' : 'Type the Swedish for:'}
          </p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: '4px 0 2px' }}>{item.prompt}</p>
          <p className="muted" style={{ marginTop: 0 }}>
            {item.label ? `${item.label} · ` : ''}{seg.kind === 'drill' ? 'from today' : 'review'}
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
                <strong>{feedback.correct ? (feedback.mastered ? 'Mastered! 🏆' : 'Rätt!') : 'Not quite.'}</strong> {feedback.comment}
                {!feedback.correct && (
                  <div style={{ marginTop: 10, borderTop: '1.5px dashed var(--ink)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {answer.trim() && (
                      <div>
                        <div className="eyebrow">You wrote</div>
                        <div style={{ fontStyle: 'italic' }}>{answer}{feedback.userAnswerMeaning ? ` — “${feedback.userAnswerMeaning}”` : ''}</div>
                      </div>
                    )}
                    <div>
                      <div className="eyebrow">Answer</div>
                      <div style={{ fontWeight: 700 }}>{feedback.corrected}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Per-item note + an example using the exact phrase being quizzed. */}
              {(item.note || item.example) && (
                <div style={{ marginTop: 12, padding: 12, border: '2px dashed var(--ink)', borderRadius: 10, fontSize: 13, lineHeight: 1.5 }}>
                  {item.note && <div>💡 {item.note}</div>}
                  {item.example && (
                    <div style={{ marginTop: item.note ? 6 : 0 }}>
                      <span style={{ fontWeight: 600 }}>{item.example.sv}</span>
                      <span className="muted"> — {item.example.en}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Flag this word to forward to the tutor, with your own question. */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', fontWeight: 600, marginTop: 12 }}>
                <input type="checkbox" checked={!!carryover[`${segIdx}-${qi}`]} onChange={toggleCarryover} />
                Ask the tutor about this
              </label>
              {carryover[`${segIdx}-${qi}`] && (
                <textarea
                  value={carryover[`${segIdx}-${qi}`].note}
                  onChange={(e) => setCarryoverNote(`${segIdx}-${qi}`, e.target.value)}
                  placeholder="What do you want to ask the tutor about this? (optional)"
                  style={{ marginTop: 8 }}
                />
              )}

              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={nextQuiz}>
                {qi + 1 < seg.items.length ? 'Next'
                  : segIdx + 1 < segments.length ? 'Next phase →'
                  : Object.keys(carryover).length > 0 ? 'Finish & send to tutor →'
                  : 'Finish'}
              </button>
              {/* Stop anywhere past the threshold — but only after answering, and
                  not on the last item where "Finish" already ends the session. */}
              {canEndPractice && qi + 1 < seg.items.length && (
                <button className="btn btn-plain" style={{ marginTop: 10 }} onClick={endPractice}>
                  End practice here ({answered} done) →
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // ── DONE ─────────────────────────────────────────────────────────────────
  return (
    <div className="wrap">
      <div className="card" style={{ textAlign: 'center' }}>
        <span className="tag">done</span>
        <h2 style={{ marginTop: 10 }}>{mode === 'new' ? 'Snyggt! Vocabulary done.' : 'Nice practice. 💪'}</h2>
        {answered > 0 && <p className="muted">You got {score} of {answered} right ({Math.round((score / answered) * 100)}%).</p>}
        {streak !== null && <p className="muted">🔥 {streak} day{streak === 1 ? '' : 's'} running.</p>}
        {newRecord && <p style={{ fontWeight: 700, color: 'var(--green)' }}>🏆 New personal best — longest streak yet!</p>}

        {mode === 'new' && (
          <div style={{
            marginTop: 16, padding: 16, border: '3px solid var(--ink)', borderRadius: 12,
            background: meta.dailyTargetMet ? 'var(--mustard)' : 'var(--green)',
            boxShadow: '4px 4px 0 var(--ink)',
          }}>
            <p style={{ margin: 0, fontWeight: 700, color: meta.dailyTargetMet ? 'var(--ink)' : '#FAF3E7' }}>
              {meta.dailyTargetMet
                ? "That's your 10 new words for today — nicely done."
                : meta.introducedNow > 0
                  ? `Learned ${meta.introducedNow} new ${meta.introducedNow === 1 ? 'item' : 'items'}.`
                  : 'No new items left right now — good review session.'}
            </p>
          </div>
        )}

        {mode === 'new' ? (
          <>
            <a href="/vocab"><button className="btn btn-secondary" style={{ marginTop: 12 }}>Learn more words →</button></a>
            <a href="/vocab?mode=practice"><button className="btn btn-primary" style={{ marginTop: 10 }}>Practice without new words →</button></a>
          </>
        ) : (
          <a href="/vocab?mode=practice"><button className="btn btn-secondary" style={{ marginTop: 12 }}>Practice more →</button></a>
        )}
        <a href="/"><button className="btn btn-plain" style={{ marginTop: 10 }}>Back to dashboard</button></a>
      </div>
    </div>
  );
}
