import { getServiceClient } from '@/lib/supabase';
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
  ] = await Promise.all([
    supabase.from('streak_state').select('*').eq('id', 1).single(),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'learning'),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }).eq('status', 'known'),
    supabase.from('words').select('*', { count: 'exact', head: true }),
    supabase.from('user_grammar_progress').select('*', { count: 'exact', head: true }),
    supabase.from('grammar_points').select('*', { count: 'exact', head: true }),
    supabase.from('attempts').select('*').order('created_at', { ascending: false }).limit(8),
    supabase.from('user_grammar_progress').select('grammar_point_id'),
  ]);

  // Next un-introduced grammar point (for "Learn" card preview)
  const startedGpIds = (startedGpRows ?? []).map((r: any) => r.grammar_point_id);
  let nextGpQ = supabase.from('grammar_points').select('title, cefr_level, sequence_order').order('sequence_order').limit(1);
  if (startedGpIds.length) nextGpQ = nextGpQ.not('id', 'in', `(${startedGpIds.join(',')})`);
  const { data: nextGpData } = await nextGpQ;
  const nextGrammar = nextGpData?.[0] ?? null;

  const lastLesson = (recent ?? []).slice().reverse();
  const mistakes   = (recent ?? []).filter((a: any) => !a.is_correct).slice(0, 4);
  const touched    = (learning ?? 0) + (known ?? 0);
  const streak     = state?.current_streak ?? 0;
  const allDone  = (grammarStarted ?? 0) >= (grammarTotal ?? 1) && touched >= (totalWords ?? 1);
  const greeting = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];

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

      {/* Hero — learn section */}
      <div style={{
        background: 'var(--green)',
        border: '3px solid var(--green)',
        borderRadius: 16,
        padding: '26px 24px',
        marginTop: 18,
        boxShadow: '7px 7px 0 var(--mustard)',
      }}>
        <span className="tag" style={{ background: 'var(--mustard)', color: 'var(--ink)' }}>learn</span>
        {nextGrammar ? (
          <>
            <p style={{ margin: '14px 0 4px', fontWeight: 700, fontSize: 18, color: '#FAF3E7', lineHeight: 1.3 }}>
              Next up: {nextGrammar.title}
            </p>
            <p style={{ margin: '0 0 22px', fontSize: 12, color: 'rgba(250,243,231,0.5)' }}>
              <span className={`cefr-tag cefr-${nextGrammar.cefr_level}`}>{nextGrammar.cefr_level}</span>
              {' '}· grammar point #{nextGrammar.sequence_order}
            </p>
          </>
        ) : (
          <p style={{ margin: '14px 0 22px', color: 'rgba(250,243,231,0.55)', fontSize: 14 }}>
            {allDone ? 'All content introduced — keep practicing!' : 'New words to learn'}
          </p>
        )}
        <a href="/lesson?mode=learn">
          <button className="btn btn-secondary" style={{ boxShadow: '4px 4px 0 rgba(250,243,231,0.15)' }}>
            Learn something new →
          </button>
        </a>
        <div style={{ height: 10 }} />
        <a href="/lesson?mode=extra">
          <button className="btn" style={{
            background: 'transparent',
            color: '#FAF3E7',
            border: '3px solid rgba(250,243,231,0.25)',
            boxShadow: '4px 4px 0 rgba(250,243,231,0.06)',
          }}>
            Practice more (no new words)
          </button>
        </a>
      </div>

      <HearAWord />

      {lastLesson.length > 0 && (
        <div className="card">
          <span className="tag">last time</span>
          <div style={{ marginTop: 10 }}>
            {lastLesson.map((a: any) => (
              <div className="vocab-item" key={a.id}>
                <strong>{a.is_correct ? '✅' : '✏️'}</strong> {a.prompt_text}
              </div>
            ))}
          </div>
        </div>
      )}

      {mistakes.length > 0 && (
        <div className="card">
          <span className="tag" style={{ background: 'var(--red)', color: '#fff' }}>worth a second look</span>
          <div style={{ marginTop: 10 }}>
            {mistakes.map((m: any) => (
              <div className="vocab-item" key={m.id}>
                <div className="muted">{m.prompt_text}</div>
                <div style={{ fontWeight: 600 }}>{m.target_text}</div>
                <div className="muted" style={{ marginTop: 4 }}>{m.explanation}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="muted" style={{ marginTop: 20, textAlign: 'center' }}>
        {grammarStarted ?? 0} of {grammarTotal ?? 0} grammar points underway
      </p>
    </div>
  );
}
