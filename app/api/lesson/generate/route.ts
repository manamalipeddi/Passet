import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';
import { GRAMMAR_INTERVAL } from '@/lib/config';

const NEEDED = 3;

type Mode = 'daily' | 'extra' | 'learn' | 'targeted' | 'words' | 'grammar';

async function fetchCached(
  supabase: ReturnType<typeof getServiceClient>,
  direction: 'en_to_sv' | 'sv_to_en',
  grammarId: string | null,
  primaryWordId: string | null,
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
  const mode: Mode = (['daily', 'extra', 'learn', 'targeted', 'words', 'grammar'] as const).includes(body.mode)
    ? body.mode : 'daily';

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date().toISOString();

  let vocab: any[]       = [];
  let grammarPoint: any  = null;

  // ── DAILY ────────────────────────────────────────────────────────────────
  if (mode === 'daily' || mode === 'extra') {
    const dueQ = supabase.from('user_progress').select('word_id, words(*)').order('next_review_date').limit(15);
    const { data: rawDue } = mode === 'extra'
      ? await dueQ
      : await dueQ.lte('next_review_date', today);
    // Curriculum words take priority; sort is stable so within-source order (by date) is preserved
    const dueProgress = (rawDue ?? [])
      .sort((a: any, b: any) =>
        (a.words?.source === 'curriculum' ? 0 : 1) - (b.words?.source === 'curriculum' ? 0 : 1)
      )
      .slice(0, 5);
    const existingIds = dueProgress.map((p: any) => p.word_id);

    let newWords: any[] = [];
    if (mode === 'daily') {
      let nq = supabase.from('words').select('*').order('rank').limit(3 + existingIds.length);
      if (existingIds.length) nq = nq.not('id', 'in', `(${existingIds.join(',')})`);
      const { data: cands } = await nq;
      newWords = (cands ?? []).filter((w: any) => !existingIds.includes(w.id)).slice(0, 3);
      if (newWords.length) {
        await supabase.from('user_progress').insert(
          newWords.map((w: any) => ({ word_id: w.id, status: 'learning', next_review_date: today })),
        );
      }
    }

    // Grammar — due first, then introduce next by sequence_order (daily only)
    const { data: dueGrammar } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, grammar_points(*)')
      .lte('next_review_date', mode === 'extra' ? '9999-12-31' : today)
      .order('next_review_date')
      .limit(1);
    grammarPoint = dueGrammar?.[0] ? (dueGrammar[0] as any).grammar_points : null;

    if (!grammarPoint && mode === 'daily') {
      const { data: started } = await supabase.from('user_grammar_progress').select('grammar_point_id');
      const startedIds = (started ?? []).map((s: any) => s.grammar_point_id);
      let gq = supabase.from('grammar_points').select('*').order('sequence_order').limit(1);
      if (startedIds.length) gq = gq.not('id', 'in', `(${startedIds.join(',')})`);
      const { data: cands } = await gq;
      grammarPoint = cands?.[0] ?? null;
      if (grammarPoint) {
        await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
      }
    }

    vocab = [...(dueProgress ?? []).map((p: any) => p.words), ...newWords];
  }

  // ── LEARN (paced: one new grammar point per GRAMMAR_INTERVAL vocab lessons)
  if (mode === 'learn') {
    // What new grammar point would be next, if/when it's grammar's turn?
    const { data: startedGp } = await supabase.from('user_grammar_progress').select('grammar_point_id');
    const startedGpIds = (startedGp ?? []).map((s: any) => s.grammar_point_id);
    let gq = supabase.from('grammar_points').select('*').order('sequence_order').limit(1);
    if (startedGpIds.length) gq = gq.not('id', 'in', `(${startedGpIds.join(',')})`);
    const { data: gpCands } = await gq;
    const nextNewGrammar = gpCands?.[0] ?? null;

    // Where we are in the grammar/vocab cycle
    const { data: st } = await supabase.from('streak_state').select('vocab_lessons_since_grammar').eq('id', 1).single();
    const sinceGrammar = st?.vocab_lessons_since_grammar ?? 0;

    // Helper: introduce the next word batch by rank
    const introduceWords = async () => {
      const { data: startedW } = await supabase.from('user_progress').select('word_id');
      const startedWIds = (startedW ?? []).map((p: any) => p.word_id);
      let wq = supabase.from('words').select('*').eq('source', 'curriculum').order('rank').limit(3 + startedWIds.length);
      if (startedWIds.length) wq = wq.not('id', 'in', `(${startedWIds.join(',')})`);
      const { data: wCands } = await wq;
      const newWords = (wCands ?? []).filter((w: any) => !startedWIds.includes(w.id)).slice(0, 3);
      if (newWords.length) {
        await supabase.from('user_progress').insert(
          newWords.map((w: any) => ({ word_id: w.id, status: 'learning', next_review_date: today })),
        );
      }
      return newWords;
    };

    // Grammar's turn once enough vocab lessons have passed — and only if there's
    // a new point left to teach. Otherwise this is a vocabulary lesson.
    const grammarTurn = sinceGrammar >= GRAMMAR_INTERVAL && !!nextNewGrammar;

    if (grammarTurn) {
      grammarPoint = nextNewGrammar;
      await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
      // Practice the new structure with words already in rotation, not brand-new ones
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(3);
      vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
      await supabase.from('streak_state').update({ vocab_lessons_since_grammar: 0 }).eq('id', 1);
    } else {
      const newWords = await introduceWords();
      if (newWords.length) {
        vocab = newWords;
        await supabase.from('streak_state').update({ vocab_lessons_since_grammar: sinceGrammar + 1 }).eq('id', 1);
      } else if (nextNewGrammar) {
        // Out of new words but grammar remains — give the next grammar point now
        grammarPoint = nextNewGrammar;
        await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
        const { data: ctx } = await supabase.from('user_progress')
          .select('word_id, words(*)')
          .order('last_reviewed_at', { ascending: false, nullsFirst: false })
          .limit(3);
        vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
        await supabase.from('streak_state').update({ vocab_lessons_since_grammar: 0 }).eq('id', 1);
      }
      // else: nothing new left at all → handled by the nothing_to_practice guard
    }
  }

  // ── TARGETED (specific word or grammar, SRS graded normally) ────────────
  if (mode === 'targeted') {
    const { wordId, grammarId: targetGrammarId } = body;

    if (wordId) {
      const { data: word } = await supabase.from('words').select('*').eq('id', wordId).single();
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .neq('word_id', wordId)
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(2);
      vocab = [word, ...(ctx ?? []).map((p: any) => p.words).filter(Boolean)];

      const { data: gProg } = await supabase.from('user_grammar_progress')
        .select('grammar_point_id, grammar_points(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(1);
      grammarPoint = gProg?.[0] ? (gProg[0] as any).grammar_points : null;
    } else if (targetGrammarId) {
      const { data: gp } = await supabase.from('grammar_points').select('*').eq('id', targetGrammarId).single();
      grammarPoint = gp ?? null;
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(3);
      vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
    }
  }

  // ── WORDS (vocabulary only — no grammar focus, already-learned grammar) ──
  if (mode === 'words') {
    const WORDS_TARGET = 6;
    // SRS-due words first
    const { data: rawDue } = await supabase
      .from('user_progress')
      .select('word_id, words(*)')
      .lte('next_review_date', today)
      .order('next_review_date')
      .limit(15);
    // Curriculum words take priority; stable sort preserves date order within source
    let picked = (rawDue ?? [])
      .sort((a: any, b: any) =>
        (a.words?.source === 'curriculum' ? 0 : 1) - (b.words?.source === 'curriculum' ? 0 : 1)
      )
      .slice(0, WORDS_TARGET);

    // If nothing (or little) is due, top up with already-started words practiced
    // least recently — practice never introduces brand-new words.
    if (picked.length < WORDS_TARGET) {
      const pickedIds = picked.map((p: any) => p.word_id);
      let tq = supabase
        .from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: true, nullsFirst: true })
        .limit(WORDS_TARGET + pickedIds.length);
      if (pickedIds.length) tq = tq.not('word_id', 'in', `(${pickedIds.join(',')})`);
      const { data: extra } = await tq;
      picked = [...picked, ...(extra ?? [])].slice(0, WORDS_TARGET);
    }

    vocab = picked.map((p: any) => p.words).filter(Boolean);
    // grammarPoint stays null — sentences reuse already-learned grammar
  }

  // ── GRAMMAR (drill an already-introduced point; vocabulary incidental) ───
  // New grammar is unlocked only through the paced "learn" flow, so this mode
  // never races ahead — it re-practices points you've already met.
  if (mode === 'grammar') {
    // Due grammar first…
    const { data: dueGrammar } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, grammar_points(*)')
      .lte('next_review_date', today)
      .order('next_review_date')
      .limit(1);
    grammarPoint = dueGrammar?.[0] ? (dueGrammar[0] as any).grammar_points : null;

    // …otherwise re-practice the introduced point touched least recently.
    // (No fallback to brand-new points — new grammar only comes from "learn".)
    if (!grammarPoint) {
      const { data: anyGrammar } = await supabase
        .from('user_grammar_progress')
        .select('grammar_point_id, grammar_points(*)')
        .order('last_reviewed_at', { ascending: true, nullsFirst: true })
        .limit(1);
      grammarPoint = anyGrammar?.[0] ? (anyGrammar[0] as any).grammar_points : null;
    }

    // Recently-practiced words give the sentences natural material
    const { data: ctx } = await supabase
      .from('user_progress')
      .select('word_id, words(*)')
      .order('last_reviewed_at', { ascending: false, nullsFirst: false })
      .limit(3);
    vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
  }

  if (!vocab.length && !grammarPoint) {
    return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });
  }

  // ── SENTENCE CACHE ───────────────────────────────────────────────────────
  const grammarId: string | null = grammarPoint?.id ?? null;
  // For targeted-word sessions, cache by the target word, not the context grammar
  const primaryWordId: string | null = (mode === 'targeted' && body.wordId)
    ? body.wordId
    : (vocab[0]?.id ?? null);

  const cacheGrammarId = (mode === 'targeted' && body.wordId) ? null : grammarId;

  const [cachedEnToSv, cachedSvToEn] = await Promise.all([
    fetchCached(supabase, 'en_to_sv', cacheGrammarId, primaryWordId),
    fetchCached(supabase, 'sv_to_en', cacheGrammarId, primaryWordId),
  ]);

  const enToSvNeeded = NEEDED - cachedEnToSv.length;
  const svToEnNeeded = NEEDED - cachedSvToEn.length;

  let newEnToSv: any[] = [];
  let newSvToEn: any[] = [];

  if (enToSvNeeded > 0 || svToEnNeeded > 0) {
    const vocabList = vocab.map((w: any) => `${w.lemma} (${w.pos}, "${w.example_en}")`).join('; ');
    const hasGrammarFocus = !!grammarPoint;
    const grammarTitle = grammarPoint?.title ?? '';
    const grammarDesc  = grammarPoint?.description ?? '';

    const parts: string[] = [];
    const outKeys: string[] = [];
    if (enToSvNeeded > 0) {
      parts.push(hasGrammarFocus
        ? `Generate exactly ${enToSvNeeded} English→Swedish sentence(s): naturally exercise the grammar focus, draw only from the listed vocabulary plus basic function words.`
        : `Generate exactly ${enToSvNeeded} English→Swedish sentence(s): naturally use the listed target vocabulary in everyday sentences. Use ONLY simple grammar the learner has already met — do not introduce or explain any new grammar structure. Draw only from the listed vocabulary plus basic function words.`);
      outKeys.push(`"en_to_sv": [{"sentence_en": "English prompt", "sentence_sv": "correct Swedish"}]`);
    }
    if (svToEnNeeded > 0) {
      parts.push(`Generate exactly ${svToEnNeeded} Swedish→English sentence(s): ORIGINAL simple A1/A2 Swedish. NEVER copy from any real book or identifiable text — hard copyright constraint.`);
      outKeys.push(`"sv_to_en": [{"sentence_sv": "Swedish prompt", "sentence_en": "correct English"}]`);
    }

    const focusLine = hasGrammarFocus
      ? `Grammar focus: "${grammarTitle}" — ${grammarDesc}`
      : `Focus: drilling the listed vocabulary. Keep every sentence within basic, already-learned grammar — do not introduce any new grammar structure.`;

    const prompt = `You are a Swedish tutor generating practice exercises.
Learner vocabulary: ${vocabList}
${focusLine}
${parts.join('\n')}
Return ONLY valid JSON, no markdown: { ${outKeys.join(', ')} }`;

    let generated: any = {};
    try {
      generated = JSON.parse(await callClaude(prompt));
    } catch {
      if (!cachedEnToSv.length && !cachedSvToEn.length)
        return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    }

    const toInsert = [
      ...(generated.en_to_sv ?? []).slice(0, enToSvNeeded).map((s: any) => ({
        grammar_point_id: cacheGrammarId,
        primary_word_id:  primaryWordId,
        direction: 'en_to_sv',
        sentence_sv: s.sentence_sv,
        sentence_en: s.sentence_en,
      })),
      ...(generated.sv_to_en ?? []).slice(0, svToEnNeeded).map((s: any) => ({
        grammar_point_id: cacheGrammarId,
        primary_word_id:  primaryWordId,
        direction: 'sv_to_en',
        sentence_sv: s.sentence_sv,
        sentence_en: s.sentence_en,
      })),
    ].filter((r) => r.sentence_sv && r.sentence_en);

    if (toInsert.length) {
      const { data: inserted } = await supabase.from('generated_sentences').insert(toInsert).select();
      const rows = inserted ?? [];
      newEnToSv = rows.filter((r: any) => r.direction === 'en_to_sv');
      newSvToEn = rows.filter((r: any) => r.direction === 'sv_to_en');
    }
  }

  // Mark reused cached sentences as shown
  for (const row of [...cachedEnToSv, ...cachedSvToEn]) {
    await supabase
      .from('generated_sentences')
      .update({ times_shown: row.times_shown + 1, last_shown_at: now })
      .eq('id', row.id);
  }

  const exercises = {
    en_to_sv: [...cachedEnToSv, ...newEnToSv].slice(0, NEEDED).map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_en,
      reference:   r.sentence_sv,
    })),
    sv_to_en: [...cachedSvToEn, ...newSvToEn].slice(0, NEEDED).map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_sv,
      reference:   r.sentence_en,
    })),
  };

  return NextResponse.json({ vocab, grammarPoint, exercises, mode });
}
