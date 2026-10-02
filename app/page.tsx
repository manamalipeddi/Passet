import { getServiceClient } from '@/lib/supabase';
import { computeHomeStats } from '@/lib/homeStats';
import HearAWord from './components/HearAWord';
import RefreshOnRestore from './components/RefreshOnRestore';
import DashboardStats from './components/DashboardStats';

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
    stats,
    { data: recent },
    { data: startedGpRows },
    { data: wordProgRows },
    { data: grammarProgRows },
  ] = await Promise.all([
    computeHomeStats(supabase),
    supabase.from('attempts').select('*').order('created_at', { ascending: false }).limit(150),
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

  // Stable per day so re-renders don't flicker it.
  const greeting = GREETINGS[new Date().getDate() % GREETINGS.length];

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
  // Only things gotten wrong at least WRONG_THRESHOLD times; accuracy from tallies.
  const WRONG_THRESHOLD = 2;
  type Trouble = { kind: 'grammar' | 'word'; id: string; name: string; accuracy: number; attempts: number };
  const wordTrouble: Trouble[] = (wordProgRows ?? [])
    .filter((p: any) => p.words && (p.times_wrong ?? 0) >= WRONG_THRESHOLD)
    .map((p: any) => {
      const c = p.times_correct ?? 0, w = p.times_wrong ?? 0;
      return { kind: 'word', id: p.words.id, name: p.words.lemma, accuracy: c / (c + w), attempts: c + w };
    });
  const grammarTrouble: Trouble[] = (grammarProgRows ?? [])
    .filter((g: any) => g.grammar_points && (g.times_wrong ?? 0) >= WRONG_THRESHOLD)
    .map((g: any) => {
      const c = g.times_correct ?? 0, w = g.times_wrong ?? 0;
      return { kind: 'grammar', id: g.grammar_points.id, name: g.grammar_points.title, accuracy: c / (c + w), attempts: c + w };
    });
  const trouble = [...grammarTrouble, ...wordTrouble]
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
    .slice(0, 10);

  // Grammar practice only unlocks once at least one point has been introduced.
  const hasGrammar = stats.grammarStartedCount > 0;

  return (
    <div className="wrap">
      <RefreshOnRestore />
      <h1 style={{ fontSize: 26, lineHeight: 1.3, margin: 0 }}>{greeting}</h1>

      {/* Streak / last-session / accuracy / progress — self-refreshing so it
          always reflects the session you just finished (see DashboardStats). */}
      <DashboardStats initial={stats} />

      {/* Hero — LEARN: introduce new concepts (with a little built-in review) */}
      <details className="sec hero-green" style={{
        background: 'var(--green)',
        border: '3px solid var(--green)',
        borderRadius: 16,
        padding: '26px 24px',
        marginTop: 18,
        boxShadow: '7px 7px 0 var(--mustard)',
      }} open>
        <summary><span className="tag" style={{ background: 'var(--mustard)', color: 'var(--ink)' }}>learn</span></summary>

        {/* Vocabulary — 10 new words: meet them, drill them, then review old ones */}
        <p style={{ margin: '14px 0 4px', fontWeight: 700, fontSize: 18, color: '#FAF3E7', lineHeight: 1.3 }}>
          Build your vocabulary
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(250,243,231,0.5)' }}>
          10 new words — meet them, drill them, then review words that are due
        </p>
        <a href="/vocab">
          <button className="btn btn-secondary" style={{ boxShadow: '4px 4px 0 rgba(250,243,231,0.15)' }}>
            Learn today&rsquo;s words →
          </button>
        </a>

        <div style={{ height: 22, borderTop: '1.5px dashed rgba(250,243,231,0.25)', marginTop: 22 }} />

        {/* Grammar — unlock the next structure, drilled with a little old review */}
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 18, color: '#FAF3E7', lineHeight: 1.3 }}>
          Build your grammar
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(250,243,231,0.5)' }}>
          {nextGrammar ? `Next up · ${nextGrammar.title}` : 'One new structure at a time, then practice it'}
        </p>
        {nextGrammar ? (
          <a href="/lesson?mode=learn">
            <button className="btn btn-secondary" style={{ boxShadow: '4px 4px 0 rgba(250,243,231,0.15)' }}>
              {hasGrammar ? 'Learn a new grammar point →' : 'Learn your first grammar point →'}
            </button>
          </a>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(250,243,231,0.6)' }}>All grammar introduced.</p>
        )}
      </details>

      {/* PRACTICE: no new concepts — reinforce what's already been learned.
          Mustard hero with a green shadow: a clear, warm counterpart to the green
          Learn card (and its mustard shadow), so the two never blur together and
          neither blends into the white cards. Red buttons to distinguish from
          Learn's gold ones. */}
      <details className="sec" style={{
        background: 'var(--mustard)',
        border: '3px solid var(--mustard)',
        borderRadius: 16,
        padding: '26px 24px',
        marginTop: 18,
        boxShadow: '7px 7px 0 var(--green)',
      }} open>
        <summary><span className="tag" style={{ background: 'var(--green)', color: '#FAF3E7' }}>practice</span></summary>

        {/* Vocabulary practice — up to 50 due/weak words, stoppable at 25 */}
        <p style={{ margin: '14px 0 4px', fontWeight: 700, fontSize: 18, lineHeight: 1.3 }}>
          Practice vocabulary
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(36,21,17,0.65)' }}>
          Up to 50 words you already know, hardest first · stop at 25 anytime
        </p>
        <a href="/vocab?mode=practice">
          <button className="btn btn-primary">Practice vocabulary →</button>
        </a>

        <div style={{ height: 22, borderTop: '1.5px dashed rgba(36,21,17,0.3)', marginTop: 22 }} />

        {/* Grammar practice — 10 sentence constructions from learned material, stop at 6 */}
        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: 18, lineHeight: 1.3 }}>
          Practice grammar
        </p>
        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(36,21,17,0.65)' }}>
          {hasGrammar
            ? '10 sentence constructions from what you’ve learned · stop after 6'
            : 'Learn a grammar point first to unlock practice'}
        </p>
        {hasGrammar ? (
          <a href="/lesson?mode=practice">
            <button className="btn btn-primary">Practice grammar →</button>
          </a>
        ) : (
          <a href="/lesson?mode=learn">
            <button className="btn btn-plain" style={{ boxShadow: '2px 2px 0 var(--ink)' }}>Learn your first grammar point →</button>
          </a>
        )}
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
              <div className="muted">{m.prompt_text}</div>
              <div style={{ fontWeight: 600 }}>{m.target_text}</div>
              <div className="muted" style={{ marginTop: 4 }}>{m.explanation}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
