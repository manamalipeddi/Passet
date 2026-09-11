import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { topUpItemBuffer } from '@/lib/vocabItems';

// Vocabulary session — pure word acquisition, no sentence practice (that's the
// grammar flow's job). Two phases the client walks through:
//
//   1. LEARN — base words met for the first time, as a see-Swedish / pick-English
//              multiple choice, with enrichment shown after.
//   2. QUIZ  — up to NEW_PER_DAY newly-introduced ITEMS + REVIEW_COUNT spaced-
//              repetition review items. English is shown, you type the Swedish.
//
// Each word expands into several items (dictionary form + inflected forms +
// phrases), each with its own SRS schedule (table vocab_items). Items are
// generated ahead of time into a buffer (introduced=false) and promoted here, so
// this endpoint stays DB-only and fast. New items are drawn user-added ("heard")
// words first, then curriculum by frequency rank. A word's MCQ is shown the first
// time any of its items is promoted; its other forms may follow on later days.

const NEW_PER_DAY  = 10;
const REVIEW_COUNT = 10;
const BUFFER_MIN   = 20;   // below this, the client is told to top up the buffer

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shortEnrichment(e: any): { note?: string; use?: { sv: string; en: string } } | null {
  if (!e || typeof e !== 'object') return null;
  const use = Array.isArray(e.uses) && e.uses[0] ? e.uses[0] : undefined;
  const note = typeof e.note === 'string' ? e.note : undefined;
  if (!use && !note) return null;
  return { note, use };
}

const ITEM_SELECT = '*, words!inner(rank, source, lemma, pos, gender, translation, enrichment)';

export async function POST() {
  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Daily new-item soft cap bookkeeping.
  const { data: st } = await supabase
    .from('streak_state').select('vocab_new_date, vocab_new_today').eq('id', 1).single();
  const newTodayBefore = st?.vocab_new_date === today ? (st?.vocab_new_today ?? 0) : 0;

  // ── Pull the un-introduced buffer; generate more if it's short ────────────
  const fetchBuffer = async () => {
    const { data } = await supabase
      .from('vocab_items').select(ITEM_SELECT).eq('introduced', false).limit(120);
    return (data ?? []) as any[];
  };
  let buffer = await fetchBuffer();
  if (buffer.length < NEW_PER_DAY) {
    // Rare (backfill + background top-up normally keep this full). Generate
    // synchronously just enough to run today's session.
    await topUpItemBuffer(supabase, 3);
    buffer = await fetchBuffer();
  }

  // user-added words first, then curriculum by rank.
  buffer.sort((a: any, b: any) =>
    (a.words?.source === 'curriculum' ? 1 : 0) - (b.words?.source === 'curriculum' ? 1 : 0)
    || (a.words?.rank ?? 1e9) - (b.words?.rank ?? 1e9));
  const promote = buffer.slice(0, NEW_PER_DAY);
  const promoteIds = promote.map((i) => i.id);

  if (promoteIds.length) {
    await supabase
      .from('vocab_items')
      .update({ introduced: true, next_review_date: today })
      .in('id', promoteIds);
    await supabase
      .from('streak_state')
      .update({ vocab_new_date: today, vocab_new_today: newTodayBefore + promoteIds.length })
      .eq('id', 1);
  }

  // ── Base words met for the first time → the MCQ learn phase ───────────────
  const promoteWordIds = [...new Set(promote.map((i) => i.word_id))];
  let newBaseWords: any[] = [];
  if (promoteWordIds.length) {
    const { data: existingProg } = await supabase
      .from('user_progress').select('word_id').in('word_id', promoteWordIds);
    const known = new Set((existingProg ?? []).map((p: any) => p.word_id));
    const newWordIds = promoteWordIds.filter((id) => !known.has(id));
    if (newWordIds.length) {
      await supabase.from('user_progress').insert(
        newWordIds.map((id) => ({ word_id: id, status: 'learning', next_review_date: today })),
      );
      const { data: wrows } = await supabase
        .from('words').select('id, lemma, pos, gender, translation, enrichment').in('id', newWordIds);
      newBaseWords = wrows ?? [];
    }
  }

  // Multiple-choice distractors from other words' translations.
  const { data: pool } = await supabase
    .from('words').select('id, translation, pos').not('translation', 'is', null);
  const newBaseSet = new Set(newBaseWords.map((w) => w.id));
  const distractorPool = (pool ?? []).filter((w: any) => w.translation && !newBaseSet.has(w.id));
  const optionsFor = (word: any): string[] => {
    const correct = (word.translation ?? '').trim();
    const samePos = shuffle(distractorPool.filter((w: any) => w.pos === word.pos && (w.translation ?? '').trim() !== correct));
    const anyPos  = shuffle(distractorPool.filter((w: any) => (w.translation ?? '').trim() !== correct));
    const picked: string[] = [];
    const seen = new Set([correct.toLowerCase()]);
    for (const cand of [...samePos, ...anyPos]) {
      const t = (cand.translation ?? '').trim();
      if (seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      picked.push(t);
      if (picked.length === 2) break;
    }
    return shuffle([correct, ...picked]);
  };

  const learn = newBaseWords.map((w) => ({
    id: w.id, lemma: w.lemma, pos: w.pos, gender: w.gender,
    answer: (w.translation ?? '').trim(),
    options: optionsFor(w),
    enrichment: w.enrichment ?? null,
  }));

  // ── Review items: introduced, SRS-due, topped up by least-recently-seen ───
  let dueQ = supabase
    .from('vocab_items').select(ITEM_SELECT)
    .eq('introduced', true).lte('next_review_date', today)
    .order('next_review_date', { ascending: true })
    .limit(REVIEW_COUNT + promoteIds.length);
  if (promoteIds.length) dueQ = dueQ.not('id', 'in', `(${promoteIds.join(',')})`);
  const { data: dueRows } = await dueQ;
  const promoteIdSet = new Set(promoteIds);
  let review = (dueRows ?? []).filter((r: any) => !promoteIdSet.has(r.id));

  if (review.length < REVIEW_COUNT) {
    const have = new Set([...promoteIds, ...review.map((r: any) => r.id)]);
    const haveArr = [...have];
    let topQ = supabase
      .from('vocab_items').select(ITEM_SELECT)
      .eq('introduced', true)
      .order('last_reviewed_at', { ascending: true, nullsFirst: true })
      .limit(REVIEW_COUNT + haveArr.length);
    if (haveArr.length) topQ = topQ.not('id', 'in', `(${haveArr.join(',')})`);
    const { data: extra } = await topQ;
    review = [...review, ...(extra ?? []).filter((r: any) => !have.has(r.id))];
  }
  review = review.slice(0, REVIEW_COUNT);

  // ── Build the quiz (new + review, shuffled) ──────────────────────────────
  const toQuiz = (it: any, isNew: boolean) => ({
    id: it.id,               // vocab_items id — grade against this
    wordId: it.word_id,
    prompt: it.prompt_en,    // English shown
    label: it.label,
    kind: it.kind,
    isNew,
    enrichment: shortEnrichment(it.words?.enrichment),
  });
  const quiz = shuffle([
    ...promote.map((i) => toQuiz(i, true)),
    ...review.map((i) => toQuiz(i, false)),
  ]);

  if (!learn.length && !quiz.length) {
    return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });
  }

  const { count: remaining } = await supabase
    .from('vocab_items').select('*', { count: 'exact', head: true }).eq('introduced', false);

  return NextResponse.json({
    learn,
    quiz,
    newTodayBefore,
    introducedNow: promoteIds.length,
    dailyTargetMet: newTodayBefore + promoteIds.length >= NEW_PER_DAY,
    bufferLow: (remaining ?? 0) < BUFFER_MIN,
  });
}
