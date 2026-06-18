import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type Filter = 'all' | 'learning' | 'known';

export default async function Learned({ searchParams }: { searchParams?: { filter?: string } }) {
  const filter: Filter = (['all', 'learning', 'known'].includes(searchParams?.filter ?? ''))
    ? (searchParams!.filter as Filter) : 'all';

  const supabase = getServiceClient();

  // Words
  let wq = supabase
    .from('user_progress')
    .select('word_id, status, next_review_date, times_correct, times_wrong, words(id, lemma, pos, gender)');
  if (filter !== 'all') wq = wq.eq('status', filter);
  const { data: wordRows } = await wq;
  const words = (wordRows ?? [])
    .filter((r: any) => r.words)
    .sort((a: any, b: any) => a.words.lemma.localeCompare(b.words.lemma, 'sv'));

  // Grammar
  const { data: gpRows } = await supabase
    .from('user_grammar_progress')
    .select('grammar_point_id, status, created_at, times_correct, times_wrong, grammar_points(id, title, cefr_level, description, sequence_order)');
  const grammar = (gpRows ?? [])
    .filter((r: any) => r.grammar_points)
    .sort((a: any, b: any) => (a.grammar_points.sequence_order ?? 99) - (b.grammar_points.sequence_order ?? 99));

  const filterLinks: { label: string; value: Filter }[] = [
    { label: 'All',       value: 'all'      },
    { label: 'Learning',  value: 'learning' },
    { label: 'Mastered',  value: 'known'    },
  ];

  return (
    <div className="wrap">
      <span className="tag">learned</span>
      <h1 style={{ marginTop: 6 }}>What you know</h1>
      <p className="muted">{words.length} words · {grammar.length} grammar points introduced</p>

      {/* ── Grammar ──────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 24 }}>
        <span className="tag">grammar</span>
        <div style={{ marginTop: 10 }}>
          {grammar.length === 0 && <p className="muted">No grammar points started yet.</p>}
          {grammar.map((r: any) => {
            const gp = r.grammar_points;
            return (
              <div className="seq-row" key={r.grammar_point_id}>
                <span className="seq-num">#{gp.sequence_order}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700 }}>{gp.title}</span>
                  <span className={`cefr-tag cefr-${gp.cefr_level}`}>{gp.cefr_level}</span>
                  <div className="muted" style={{ marginTop: 2 }}>{gp.description}</div>
                </div>
                <span className={`status-pill ${r.status}`}>{r.status}</span>
                <a href={`/lesson?mode=targeted&grammarId=${gp.id}`}>
                  <button className="btn btn-plain" style={{ padding: '6px 12px', fontSize: 12, width: 'auto', boxShadow: '2px 2px 0 var(--ink)' }}>
                    Practice
                  </button>
                </a>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Words ────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span className="tag">words</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {filterLinks.map(({ label, value }) => (
              <a key={value} href={`/learned?filter=${value}`}>
                <span style={{
                  display: 'inline-block', padding: '3px 12px', borderRadius: 999,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  border: `2px solid var(--ink)`,
                  background: filter === value ? 'var(--ink)' : 'transparent',
                  color: filter === value ? '#fff' : 'var(--ink)',
                }}>
                  {label}
                </span>
              </a>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          {words.length === 0 && <p className="muted">No words match this filter.</p>}
          {words.map((r: any) => {
            const w = r.words;
            const due = r.next_review_date
              ? new Date(r.next_review_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
              : '—';
            return (
              <div key={r.word_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1.5px dashed var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 700 }}>{w.lemma}</span>{' '}
                  <span className="muted">
                    {w.pos}{w.gender ? `, ${w.gender}` : ''}
                  </span>
                </div>
                <span className={`status-pill ${r.status}`}>{r.status === 'known' ? 'mastered' : r.status}</span>
                <span className="muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>due {due}</span>
                <a href={`/lesson?mode=targeted&wordId=${w.id}`}>
                  <button className="btn btn-plain" style={{ padding: '4px 10px', fontSize: 11, width: 'auto', boxShadow: '2px 2px 0 var(--ink)' }}>
                    Practice
                  </button>
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
