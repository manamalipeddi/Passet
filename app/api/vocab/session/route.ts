import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

// Vocabulary session — pure word acquisition, no sentence practice (that's the
// grammar flow's job). A session has two phases the client walks through:
//
//   1. LEARN  — up to NEW_PER_DAY brand-new words. Each shows the Swedish word
//               with three English options (recognition), then full enrichment.
//   2. QUIZ   — NEW_PER_DAY new words + REVIEW_COUNT spaced-repetition review
//               words. English is shown, the learner types the Swedish word.
//
// New words are drawn user-added ("heard a word") first, then curriculum by
// frequency rank. This endpoint is deliberately DB-only so it returns in ~1s:
// enrichment (example uses + a memorable note) is generated lazily and cached by
// /api/vocab/enrich, which the client prefetches per word while it's being read.

const NEW_PER_DAY  = 10;
const REVIEW_COUNT = 10;

type WordRow = {
  id: string; lemma: string; pos: string | null; gender: string | null;
  translation: string | null; example_sv: string | null; example_en: string | null;
  source: string | null; enrichment: any;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A short reminder shown as quiz feedback: the memorable note + one example use.
function shortEnrichment(e: any): { note?: string; use?: { sv: string; en: string } } | null {
  if (!e || typeof e !== 'object') return null;
  const use = Array.isArray(e.uses) && e.uses[0] ? e.uses[0] : undefined;
  const note = typeof e.note === 'string' ? e.note : undefined;
  if (!use && !note) return null;
  return { note, use };
}

export async function POST() {
  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // ── Daily new-word soft cap bookkeeping ──────────────────────────────────
  const { data: st } = await supabase
    .from('streak_state')
    .select('vocab_new_date, vocab_new_today')
    .eq('id', 1)
    .single();
  const newTodayBefore = st?.vocab_new_date === today ? (st?.vocab_new_today ?? 0) : 0;

  // Words already in rotation — never re-introduce these as "new".
  const { data: startedRows } = await supabase.from('user_progress').select('word_id');
  const startedIds = (startedRows ?? []).map((r: any) => r.word_id);
  const notStarted = startedIds.length ? `(${startedIds.join(',')})` : null;

  // ── Pick up to NEW_PER_DAY brand-new words: user-added first, then rank ───
  const WORD_COLS = 'id, lemma, pos, gender, translation, example_sv, example_en, source, enrichment';

  let heardQ = supabase
    .from('words')
    .select(WORD_COLS)
    .neq('source', 'curriculum')
    .order('created_at', { ascending: true })
    .limit(NEW_PER_DAY + startedIds.length);
  if (notStarted) heardQ = heardQ.not('id', 'in', notStarted);
  const { data: heardCands } = await heardQ;
  let newWords: WordRow[] = (heardCands ?? []).filter((w: any) => !startedIds.includes(w.id)) as WordRow[];

  if (newWords.length < NEW_PER_DAY) {
    const need = NEW_PER_DAY - newWords.length;
    const excludeIds = [...startedIds, ...newWords.map((w) => w.id)];
    let curQ = supabase
      .from('words')
      .select(WORD_COLS)
      .eq('source', 'curriculum')
      .order('rank', { ascending: true })
      .limit(need + excludeIds.length);
    if (excludeIds.length) curQ = curQ.not('id', 'in', `(${excludeIds.join(',')})`);
    const { data: curCands } = await curQ;
    const curNew = (curCands ?? []).filter((w: any) => !excludeIds.includes(w.id)).slice(0, need) as WordRow[];
    newWords = [...newWords, ...curNew];
  }

  // Register the new words in progress and advance the daily counter.
  if (newWords.length) {
    await supabase.from('user_progress').insert(
      newWords.map((w) => ({ word_id: w.id, status: 'learning', next_review_date: today })),
    );
    await supabase
      .from('streak_state')
      .update({ vocab_new_date: today, vocab_new_today: newTodayBefore + newWords.length })
      .eq('id', 1);
  }

  // ── Multiple-choice distractors from other words' translations ───────────
  const { data: pool } = await supabase
    .from('words')
    .select('id, translation, pos')
    .not('translation', 'is', null);
  const newIdSet = new Set(newWords.map((w) => w.id));
  const distractorPool = (pool ?? []).filter((w: any) => w.translation && !newIdSet.has(w.id));

  const optionsFor = (word: WordRow): string[] => {
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

  const learn = newWords.map((w) => ({
    id: w.id,
    lemma: w.lemma,
    pos: w.pos,
    gender: w.gender,
    answer: (w.translation ?? '').trim(),
    options: optionsFor(w),
    enrichment: w.enrichment ?? null,   // cached only; else fetched lazily by the client
  }));

  // ── Quiz review words: SRS-due first, topped up by least-recently-seen ────
  const excludeFromReview = new Set(newWords.map((w) => w.id));
  const excludeArr = [...excludeFromReview];
  const notNew = excludeArr.length ? `(${excludeArr.join(',')})` : null;

  let dueQ = supabase
    .from('user_progress')
    .select(`word_id, words(${WORD_COLS})`)
    .lte('next_review_date', today)
    .order('next_review_date', { ascending: true })
    .limit(REVIEW_COUNT + excludeArr.length);
  if (notNew) dueQ = dueQ.not('word_id', 'in', notNew);
  const { data: dueRows } = await dueQ;
  let reviewProg = (dueRows ?? []).filter((r: any) => !excludeFromReview.has(r.word_id));

  if (reviewProg.length < REVIEW_COUNT) {
    const have = new Set([...excludeArr, ...reviewProg.map((r: any) => r.word_id)]);
    const haveArr = [...have];
    let topupQ = supabase
      .from('user_progress')
      .select(`word_id, words(${WORD_COLS})`)
      .order('last_reviewed_at', { ascending: true, nullsFirst: true })
      .limit(REVIEW_COUNT + haveArr.length);
    if (haveArr.length) topupQ = topupQ.not('word_id', 'in', `(${haveArr.join(',')})`);
    const { data: extra } = await topupQ;
    reviewProg = [...reviewProg, ...(extra ?? []).filter((r: any) => !have.has(r.word_id))];
  }

  const reviewWords: WordRow[] = reviewProg
    .map((r: any) => r.words)
    .filter((w: any): w is WordRow => !!w && !!(w.translation ?? '').trim())
    .slice(0, REVIEW_COUNT);

  // ── Build the quiz: new words + review words, shuffled together ───────────
  const toQuizItem = (w: WordRow, isNew: boolean) => ({
    id: w.id,
    prompt: (w.translation ?? '').trim(),   // English shown
    pos: w.pos,
    gender: w.gender,
    isNew,
    // Cached short reminder if we have it; new words' enrichment is filled in by
    // the client (from what it prefetched during the learn phase).
    enrichment: shortEnrichment(w.enrichment),
  });

  const quiz = shuffle([
    ...newWords.filter((w) => (w.translation ?? '').trim()).map((w) => toQuizItem(w, true)),
    ...reviewWords.map((w) => toQuizItem(w, false)),
  ]);

  if (!learn.length && !quiz.length) {
    return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });
  }

  return NextResponse.json({
    learn,
    quiz,
    newTodayBefore,
    introducedNow: newWords.length,
    dailyTargetMet: newTodayBefore + newWords.length >= NEW_PER_DAY,
  });
}
