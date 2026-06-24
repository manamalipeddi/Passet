import { getServiceClient } from '@/lib/supabase';
import { GRAMMAR_INTERVAL } from '@/lib/config';
import HearAWord from './components/HearAWord';

const GREETINGS = [
  'Hej Manasa! Välkommen tillbaka.',
  'Kul att se dig igen, Manasa!',
  'Hej igen! Dags att öva lite svenska.',
  'Välkommen tillbaka, Manasa!',
  'Hej Manasa! Redo att lära dig mer?',
  'Kul att du är tillbaka, Manasa!',
  'God dag, Manasa! Ska vi öva?',
];

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = getServiceClient();

  const [
    { data: state },
    { count: learning },
    { count: known },
    { count: totalWords },
    { count: grammarStarted },
    { count: grammarTotal },
    { data: recent },
    { data: startedGpRows },
    { data: wordProgRows },
    { data: grammarProgRows },
  ] = await Promise.all([
    supabase.from('streak_state').select('*').eq('id', 1).single(),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'learning'),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'known'),
    supabase.from('words').select('*', { count: 'exact', head: true }),
    supabase.from('user_grammar_progress').select('*', { count: 'exact', head: true }),
    supabase.from('grammar_points').select('*', { count: 'exact', head: true }),
    supabase.from('attempts').select('*').order('created_at', { ascending: false }).limit(60),
    supabase.from('user_grammar_progress').select('grammar_point_id'),
    supabase.from('user_progress').select('word_id, times_correct, times_wrong, words(id, lemma, translation, pos)'),
    supabase.from('user_grammar_progress').select('grammar_point_id, times_correct, times_wrong, grammar_points(id, title)'),
  ]);

  // Next un-introduced grammar point (for "Learn" card preview)
  const startedGpIds = (startedGpRows ?? []).map((r: any) => r.grammar_point_id);
  let nextGpQ = supabase.from('grammar_points').select('title, cefr_level, sequence_order').order('sequence_order').limit(1);
  if (startedGpIds.length) nextGpQ = nextGpQ.not('id', 'in', `(${startedGpIds.join(',')})`);
  const { data: nextGpData } = await nextGpQ;
  const nextGrammar = nextGpData?.[0] ?? null;

  const touched    = (learning ?? 0) + (known ?? 0);
  const streak     = state?.current_streak ?? 0;
  const allDone  = (grammarStarted ?? 0) >= (grammarTotal ?? 1) && touched >= (totalWords ?? 1);
  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

  // Worth a second look — wrong answers from the last 3 practice sessions,
  // deduped to just the prompt line. Sessions aren't stored, so we cluster
  // recent attempts: a gap of >30 min between answers starts a new session.
  const SESSION_GAP_MS = 30 * 60 * 1000;
  let sessionsSeen = 0;
  let lastT: number | null = null;
  const seenWrong = new Set<string>();
  const secondLook: any[] = [];
  for (const a of (recent ?? [])) {
    const t = new Date(a.created_at).getTime();
    if (lastT === null) sessionsSeen = 1;
    else if (lastT - t > SESSION_GAP_MS) sessionsSeen += 1;
    if (sessionsSeen > 3) break;
    lastT = t;
    if (a.is_correct) continue;
    const key = (a.prompt_text ?? '').trim().toLowerCase();
    if (!key || seenWrong.has(key)) continue;
    seenWrong.add(key);
    secondLook.push(a);
  }

  // Trouble spots — grammar points and words ranked by accuracy (worst first).
  // Only things gotten wrong at least once; accuracy from running tallies.
  type Trouble = { kind: 'grammar' | 'word'; id: string; name: string; accuracy: number; attempts: number };
  const wordTrouble: Trouble[] = (wordProgRows ?? [])
    .filter((p: any) => p.words && (p.times_wrong ?? 0) > 0)
    .map((p: any) => {
      const c = p.times_correct ?? 0, w = p.times_wrong ?? 0;
      return { kind: 'word', id: p.words.id, name: p.words.lemma, accuracy: c / (c + w), attempts: c + w };
    });
  const grammarTrouble: Trouble[] = (grammarProgRows ?? [])
    .filter((g: any) => g.grammar_points && (g.times_wrong ?? 0) > 0)
    .map((g: any) => {
      const c = g.times_correct ?? 0, w = g.times_wrong ?? 0;
      return { kind: 'grammar', id: g.grammar_points.id, name: g.grammar_points.title, accuracy: c / (c + w), attempts: c + w };
    });
  const trouble = [...grammarTrouble, ...wordTrouble]
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 10);

  // Grammar pacing — a new grammar point only every GRAMMAR_INTERVAL vocab lessons.
  const sinceGrammar       = state?.vocab_lessons_since_grammar ?? 0;
  const nextIsGrammar      = sinceGrammar >= GRAMMAR_INTERVAL && !!nextGrammar;
  const lessonsTilGrammar  = Math.max(GRAMMAR_INTERVAL - sinceGrammar, 0);

  return (
    <div className="wrap">
      <h1 style={{ fontSize: 26, lineHeight: 1.3, margin: 0 }}>{greeting}</h1>

      <div className="row2" style={{ marginTop: 18 }}>
        <div className="stat">
          <div className="num">{streak === 0 ? '—' : `🔥 ${streak}`}</div>
          <div className="lbl">day streak</div>
        </div>
        <div className="stat">
          <div className="num">{touched}<span style={{ fontSize: 16, color: 'var(--text-muted)' }}> / {totalWords ?? 0}</span></div>
          <div className="lbl">words started · {known ?? 0} mastered</div>
        </div>
      </div>

      {/* Hero — learn section (collapsible) */}
      <details className="sec hero-green" style={{
        background: 'var(--green)',
        border: '3px solid var(--green)',
        borderRadius: 16,
        padding: '26px 24px',
        marginTop: 18,
        boxShadow: '7px 7px 0 var(--mustard)',
      }} open>
        <summary><span className="tag" style={{ background: 'var(--mustard)', color: 'var(--ink)' }}>learn</span></summary>
        {nextIsGrammar ? (
          <>
            <p style={{ margin: '14px 0 4px', fontWeight: 700, fontSize: 18, color: '#FAF3E7', lineHeight: 1.3 }}>
              Next up: {nextGrammar.title}
            </p>
            <p style={{ margin: '0 0 22px', fontSize: 12, color: 'rgba(250,243,231,0.5)' }}>
              <span className={`cefr-tag cefr-${nextGrammar.cefr_level}`}>{nextGrammar.cefr_level}</span>
              {' '}· new grammar point #{nextGrammar.sequence_order}
            </p>
          </>
        ) : !allDone ? (
          <>
            <p style={{ margin: '14px 0 4px', fontWeight: 700, fontSize: 18, color: '#FAF3E7', lineHeight: 1.3 }}>
              Next up: new words
            </p>
            <p style={{ margin: '0 0 22px', fontSize: 12, color: 'rgba(250,243,231,0.5)' }}>
              {nextGrammar
                ? `${lessonsTilGrammar} more word ${lessonsTilGrammar === 1 ? 'lesson' : 'lessons'}, then grammar — “${nextGrammar.title}”`
                : 'All grammar introduced — building vocabulary'}
            </p>
          </>
        ) : (
          <p style={{ margin: '14px 0 22px', color: 'rgba(250,243,231,0.55)', fontSize: 14 }}>
            All content introduced — keep practicing!
          </p>
        )}
        <a href="/lesson?mode=learn">
          <button className="btn btn-secondary" style={{ boxShadow: '4px 4px 0 rgba(250,243,231,0.15)' }}>
            {nextIsGrammar ? 'Learn new grammar →' : 'Learn new words →'}
          </button>
        </a>
        <div style={{ height: 10 }} />
        <div className="row2">
          <a href="/lesson?mode=words" style={{ display: 'block' }}>
            <button className="btn btn-primary">Practice words</button>
          </a>
          <a href="/lesson?mode=grammar" style={{ display: 'block' }}>
            <button className="btn btn-primary">Practice grammar</button>
          </a>
        </div>
      </details>

      <details className="card sec" style={{ marginTop: 18 }} open>
        <summary><span className="tag">heard a word?</span></summary>
        <HearAWord />
      </details>

      {/* Trouble spots — lowest accuracy first */}
      <details className="card sec" style={{ marginTop: 18 }} open>
        <summary>
          <span className="tag" style={{ background: 'var(--mustard)', color: 'var(--ink)' }}>trouble spots</span>
          <span className="sec-count">{trouble.length}</span>
        </summary>
        <div style={{ marginTop: 10 }}>
          {trouble.length === 0 && <p className="muted">No trouble spots yet — keep practicing.</p>}
          {trouble.map((s) => (
            <div className="seq-row" key={`${s.kind}-${s.id}`}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 700 }}>{s.name}</span>
                <span className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}> · {s.kind}</span>
              </div>
              <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{Math.round(s.accuracy * 100)}%</span>
              <a href={s.kind === 'grammar' ? `/lesson?mode=targeted&grammarId=${s.id}` : `/lesson?mode=targeted&wordId=${s.id}`}>
                <button className="btn btn-plain" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', boxShadow: '2px 2px 0 var(--ink)' }}>
                  Practice
                </button>
              </a>
            </div>
          ))}
        </div>
      </details>

      {/* Worth a second look — wrong in the last 3 sessions, deduped */}
      <details className="card sec" style={{ marginTop: 18 }} open>
        <summary>
          <span className="tag" style={{ background: 'var(--red)', color: '#fff' }}>worth a second look</span>
          <span className="sec-count">{secondLook.length}</span>
        </summary>
        <div style={{ marginTop: 10 }}>
          {secondLook.length === 0 && <p className="muted">Nothing wrong in your last few sessions — nice.</p>}
          {secondLook.map((m: any) => (
            <div className="vocab-item" key={m.id}>
              <span style={{ marginRight: 6 }}>✏️</span>{m.prompt_text}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
