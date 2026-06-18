import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

const NEEDED = 3;

async function fetchCached(
  supabase: ReturnType<typeof getServiceClient>,
  direction: 'en_to_sv' | 'sv_to_en',
  grammarId: string | null,
  primaryWordId: string | null
) {
  if (!grammarId && !primaryWordId) return [];

  let q = supabase
    .from('generated_sentences')
    .select('*')
    .eq('direction', direction)
    .eq('is_excluded', false)
    .order('last_shown_at', { ascending: true, nullsFirst: true })
    .limit(NEEDED);

  q = grammarId ? q.eq('grammar_point_id', grammarId) : q.eq('primary_word_id', primaryWordId!);

  const { data } = await q;
  return data ?? [];
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: 'daily' | 'extra' = body.mode === 'extra' ? 'extra' : 'daily';

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // 1. Words due for review
  const dueQuery = supabase.from('user_progress').select('word_id, words(*)').order('next_review_date').limit(5);
  const { data: dueProgress } = mode === 'extra'
    ? await dueQuery
    : await dueQuery.lte('next_review_date', today);

  const existingIds = (dueProgress ?? []).map((p: any) => p.word_id);

  // 2. New words — daily mode only
  let newWords: any[] = [];
  if (mode === 'daily') {
    let nq = supabase.from('words').select('*').order('rank').limit(3 + existingIds.length);
    if (existingIds.length) nq = nq.not('id', 'in', `(${existingIds.join(',')})`);
    const { data: candidates } = await nq;
    newWords = (candidates ?? []).filter((w: any) => !existingIds.includes(w.id)).slice(0, 3);
    if (newWords.length) {
      await supabase.from('user_progress').insert(
        newWords.map((w: any) => ({ word_id: w.id, status: 'learning', next_review_date: today }))
      );
    }
  }

  // 3. Grammar point
  const { data: dueGrammar } = await supabase
    .from('user_grammar_progress')
    .select('grammar_point_id, grammar_points(*)')
    .lte('next_review_date', mode === 'extra' ? '9999-12-31' : today)
    .order('next_review_date')
    .limit(1);

  let grammarPoint = dueGrammar?.[0] ? (dueGrammar[0] as any).grammar_points : null;

  if (!grammarPoint && mode === 'daily') {
    const { data: started } = await supabase.from('user_grammar_progress').select('grammar_point_id');
    const startedIds = (started ?? []).map((s: any) => s.grammar_point_id);
    let gq = supabase.from('grammar_points').select('*').order('weight', { ascending: false }).limit(1 + startedIds.length);
    if (startedIds.length) gq = gq.not('id', 'in', `(${startedIds.join(',')})`);
    const { data: candidates } = await gq;
    grammarPoint = (candidates ?? []).find((g: any) => !startedIds.includes(g.id)) ?? null;
    if (grammarPoint) {
      await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
    }
  }

  const vocab = [...(dueProgress ?? []).map((p: any) => p.words), ...newWords];
  const grammarId: string | null = grammarPoint?.id ?? null;
  const primaryWordId: string | null = vocab[0]?.id ?? null;

  // 4. Pull from sentence bank (LRU, non-excluded)
  const [cachedEnToSv, cachedSvToEn] = await Promise.all([
    fetchCached(supabase, 'en_to_sv', grammarId, primaryWordId),
    fetchCached(supabase, 'sv_to_en', grammarId, primaryWordId),
  ]);

  const enToSvNeeded = NEEDED - cachedEnToSv.length;
  const svToEnNeeded = NEEDED - cachedSvToEn.length;

  // 5. Generate only the shortfall
  let newEnToSv: any[] = [];
  let newSvToEn: any[] = [];

  if (enToSvNeeded > 0 || svToEnNeeded > 0) {
    const vocabList = vocab.map((w: any) => `${w.lemma} (${w.pos}, "${w.example_en}")`).join('; ');
    const grammarTitle = grammarPoint?.title ?? 'general review';
    const grammarDesc  = grammarPoint?.description ?? '';

    const parts: string[] = [];
    const outputKeys: string[] = [];

    if (enToSvNeeded > 0) {
      parts.push(`Generate exactly ${enToSvNeeded} English→Swedish sentence(s): naturally exercise the grammar focus using only the listed vocabulary plus any basic function words needed.`);
      outputKeys.push(`"en_to_sv": [{"sentence_en": "English prompt shown to learner", "sentence_sv": "correct Swedish answer"}]`);
    }
    if (svToEnNeeded > 0) {
      parts.push(`Generate exactly ${svToEnNeeded} Swedish→English sentence(s): ORIGINAL simple Swedish at A1/A2 level. NEVER copy or adapt from any real book or identifiable text — this is a hard copyright constraint for this app.`);
      outputKeys.push(`"sv_to_en": [{"sentence_sv": "Swedish prompt shown to learner", "sentence_en": "correct English answer"}]`);
    }

    const prompt = `You are a Swedish tutor generating practice sentences.

Learner vocabulary: ${vocabList}
Grammar focus: "${grammarTitle}" — ${grammarDesc}

${parts.join('\n')}

Return ONLY valid JSON, no markdown:
{ ${outputKeys.join(', ')} }`;

    let generated: any;
    try {
      generated = JSON.parse(await callClaude(prompt));
    } catch {
      // If bank has nothing either, fail; otherwise return what we have
      if (!cachedEnToSv.length && !cachedSvToEn.length) {
        return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
      }
      generated = {};
    }

    const toInsert = [
      ...(generated.en_to_sv ?? []).slice(0, enToSvNeeded).map((s: any) => ({
        grammar_point_id: grammarId,
        primary_word_id:  primaryWordId,
        direction:        'en_to_sv',
        sentence_sv:      s.sentence_sv,
        sentence_en:      s.sentence_en,
      })),
      ...(generated.sv_to_en ?? []).slice(0, svToEnNeeded).map((s: any) => ({
        grammar_point_id: grammarId,
        primary_word_id:  primaryWordId,
        direction:        'sv_to_en',
        sentence_sv:      s.sentence_sv,
        sentence_en:      s.sentence_en,
      })),
    ].filter((r) => r.sentence_sv && r.sentence_en);

    if (toInsert.length) {
      const { data: inserted } = await supabase.from('generated_sentences').insert(toInsert).select();
      const rows = inserted ?? [];
      newEnToSv = rows.filter((r: any) => r.direction === 'en_to_sv');
      newSvToEn = rows.filter((r: any) => r.direction === 'sv_to_en');
    }
  }

  // 6. Mark cached sentences as shown
  const shownNow = [...cachedEnToSv, ...cachedSvToEn];
  for (const row of shownNow) {
    await supabase
      .from('generated_sentences')
      .update({ times_shown: row.times_shown + 1, last_shown_at: now })
      .eq('id', row.id);
  }

  // 7. Shape into exercises — prompt/reference depend on direction
  const allEnToSv = [...cachedEnToSv, ...newEnToSv].slice(0, NEEDED);
  const allSvToEn = [...cachedSvToEn, ...newSvToEn].slice(0, NEEDED);

  const exercises = {
    en_to_sv: allEnToSv.map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_en,
      reference:   r.sentence_sv,
    })),
    sv_to_en: allSvToEn.map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_sv,
      reference:   r.sentence_en,
    })),
  };

  return NextResponse.json({ vocab, grammarPoint, exercises, mode });
}
