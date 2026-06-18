import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export default async function Plan() {
  const supabase = getServiceClient();

  const [
    { data: allGrammar },
    { data: startedGrammar },
    { data: startedWords },
    { count: totalWords },
  ] = await Promise.all([
    supabase.from('grammar_points').select('id, title, cefr_level, description, sequence_order').order('sequence_order'),
    supabase.from('user_grammar_progress').select('grammar_point_id, status'),
    supabase.from('user_progress').select('word_id'),
    supabase.from('words').select('*', { count: 'exact', head: true }),
  ]);

  const startedGpMap = Object.fromEntries(
    (startedGrammar ?? []).map((r: any) => [r.grammar_point_id, r.status])
  );
  const startedWordIds = new Set((startedWords ?? []).map((r: any) => r.word_id));
  const wordsIntroduced = startedWordIds.size;
  const wordsPct = totalWords ? Math.round((wordsIntroduced / totalWords) * 100) : 0;

  // Next un-introduced words
  const { data: nextWordRows } = await supabase
    .from('words')
    .select('lemma, rank')
    .not('id', 'in', startedWordIds.size ? `(${[...startedWordIds].join(',')})` : '(00000000-0000-0000-0000-000000000000)')
    .order('rank')
    .limit(5);
  const nextWords = nextWordRows ?? [];

  const gpDone       = (startedGrammar ?? []).filter((r: any) => r.status === 'known').length;
  const gpInProgress = (startedGrammar ?? []).filter((r: any) => r.status !== 'known').length;
  const gpNotStarted = (allGrammar ?? []).length - (startedGrammar ?? []).length;

  return (
    <div className="wrap">
      <span className="tag">plan</span>
      <h1 style={{ marginTop: 6 }}>Curriculum</h1>
      <p className="muted">
        {gpDone} done · {gpInProgress} in progress · {gpNotStarted} not started
      </p>

      {/* ── Word progress ─────────────────────────────────────── */}
      <div className="card">
        <span className="tag">vocabulary</span>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
            <span>{wordsIntroduced} / {totalWords ?? 0} words introduced</span>
            <span>{wordsPct}%</span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${wordsPct}%` }} />
          </div>
          {nextWords.length > 0 && (
            <p className="muted" style={{ marginTop: 8 }}>
              Next up:{' '}
              {nextWords.map((w: any, i: number) => (
                <span key={w.rank}>
                  <strong>{w.lemma}</strong>{i < nextWords.length - 1 ? ', ' : ''}
                </span>
              ))}
            </p>
          )}
          <a href="/lesson?mode=learn">
            <button className="btn btn-plain" style={{ marginTop: 12 }}>Learn next batch →</button>
          </a>
        </div>
      </div>

      {/* ── Grammar sequence ──────────────────────────────────── */}
      <div className="card" style={{ marginTop: 18 }}>
        <span className="tag">grammar sequence</span>
        <div style={{ marginTop: 12 }}>
          {(allGrammar ?? []).map((gp: any) => {
            const status: 'done' | 'active' | 'upcoming' =
              startedGpMap[gp.id] === 'known' ? 'done' :
              startedGpMap[gp.id] != null     ? 'active' :
              'upcoming';

            const icon = status === 'done' ? '✅' : status === 'active' ? '🟡' : '○';

            return (
              <div key={gp.id} className="seq-row">
                <span className="seq-num" style={{ color: status === 'upcoming' ? 'var(--text-muted)' : 'var(--ink)' }}>
                  {icon}
                </span>
                <div style={{ flex: 1, opacity: status === 'upcoming' ? 0.55 : 1 }}>
                  <span style={{ fontWeight: 700 }}>{gp.title}</span>
                  <span className={`cefr-tag cefr-${gp.cefr_level}`}>{gp.cefr_level}</span>
                  <div className="muted" style={{ marginTop: 2, fontSize: 12 }}>{gp.description}</div>
                </div>
                {status !== 'upcoming' && (
                  <a href={`/lesson?mode=targeted&grammarId=${gp.id}`}>
                    <button className="btn btn-plain" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', boxShadow: '2px 2px 0 var(--ink)' }}>
                      Practice
                    </button>
                  </a>
                )}
                {status === 'upcoming' && (
                  <a href="/lesson?mode=learn">
                    <button className="btn btn-plain" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', boxShadow: '2px 2px 0 var(--ink)', opacity: 0.5 }}>
                      Start
                    </button>
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
