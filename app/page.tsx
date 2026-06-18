import { getServiceClient } from '@/lib/supabase';
import { USER_NAME } from '@/lib/config';

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
  const allDone    = (grammarStarted ?? 0) >= (grammarTotal ?? 1) && touched >= (totalWords ?? 1);

  const greeting =
    streak === 0 ? `Hej ${USER_NAME}! Ready for paus number one?` :
    streak >= 7  ? `Hej ${USER_NAME}! ${streak} days — you're properly on a roll.` :
                   `Hej ${USER_NAME}! Good to see you back.`;

  return (
    <div className="wrap">
      <div className="eyebrow">15 minutes, most days</div>
      <h1>🇸🇪 Passet</h1>
      <p className="muted" style={{ marginTop: 6 }}>{greeting}</p>

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

      <div className="card">
        <span className="tag">today</span>
        <div style={{ marginTop: 4 }}>
          <a href="/lesson"><button className="btn btn-primary">Start today's paus</button></a>
          <div style={{ height: 10 }} />
          <a href="/lesson?mode=extra"><button className="btn btn-secondary">Practice more (no new words)</button></a>
        </div>
      </div>

      <div className="card">
        <span className="tag" style={{ background: 'var(--green)', color: '#fff' }}>learn</span>
        {nextGrammar ? (
          <>
            <p style={{ margin: '10px 0 4px', fontWeight: 600 }}>Next up: {nextGrammar.title}</p>
            <p className="muted" style={{ marginBottom: 12 }}>
              <span className={`cefr-tag cefr-${nextGrammar.cefr_level}`}>{nextGrammar.cefr_level}</span>
              {' '}· grammar point #{nextGrammar.sequence_order}
            </p>
          </>
        ) : (
          <p className="muted" style={{ margin: '10px 0 12px' }}>
            {allDone ? 'All content introduced — keep practicing!' : 'New words to learn'}
          </p>
        )}
        <a href="/lesson?mode=learn"><button className="btn btn-plain">Learn something new →</button></a>
      </div>

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
