import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { topUpItemBuffer } from '@/lib/vocabItems';

// Vocabulary session — pure word acquisition, no sentence practice (that's the
// grammar flow's job). Three modes, each driving a different client flow:
//
//   'new'  (default) — the LEARN flow, walked in three phases client-side:
//        1. INTRODUCE — the NEW_PER_DAY freshly-promoted items, shown one at a
//           time with the answer + example so they're actually taught.
//        2. DRILL     — the SAME items again, reshuffled, typed from memory so
//           they stick. This is each new item's first graded SRS touch.
//        3. REVIEW    — REVIEW_COUNT old due items, hardest-first (see below).
//   'practice' — no new items. A pool of PRACTICE_COUNT (50) already-learned
//        items, hardest-first; the client lets you stop at 25.
//   'review'   — legacy review-only: REVIEW_ONLY due/least-recent items.
//
// Each word expands into several items (dictionary form + inflected forms +
// phrases), each with its own SRS schedule (table vocab_items). New items are
// generated ahead of time into a buffer (introduced=false) and promoted here.
//
// Review ordering — spaced repetition already brings wrong items back *sooner*
// (a miss resets the interval to 0). On top of that we order each review batch
// HARDEST-FIRST: most total wrong answers, then highest wrong-rate, then oldest
// due. So the items you keep missing lead every session.

const NEW_PER_DAY    = 10;
const REVIEW_COUNT   = 10;   // review items after the new-item phases in a normal session
const PRACTICE_COUNT = 50;   // pool size for a practice session (client can stop at 25)
const REVIEW_ONLY    = 20;   // review items in a legacy review-only session
const BUFFER_MIN     = 20;   // below this, the client is told to top up the buffer

const ITEM_SELECT = '*, words!inner(rank, source, lemma, pos, gender, translation)';

// Review order (the owner's rule): items missed MORE THAN TWICE IN A ROW lead,
// then everything else by soonest SRS review date (oldest due first). The
// consecutive-wrong streak lives on vocab_items.wrong_streak.
function byReviewPriority(a: any, b: any): number {
  const aHard = (a.wrong_streak ?? 0) > 2 ? 0 : 1;
  const bHard = (b.wrong_streak ?? 0) > 2 ? 0 : 1;
  if (aHard !== bHard) return aHard - bHard;
  const ad = a.next_review_date ?? '9999', bd = b.next_review_date ?? '9999';
  return ad < bd ? -1 : ad > bd ? 1 : 0;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: 'new' | 'review' | 'practice' =
    body?.mode === 'review' ? 'review' : body?.mode === 'practice' ? 'practice' : 'new';
  const isNewFlow = mode === 'new';

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Daily new-item soft cap bookkeeping.
  const { data: st } = await supabase
    .from('streak_state').select('vocab_new_date, vocab_new_today').eq('id', 1).single();
  const newTodayBefore = st?.vocab_new_date === today ? (st?.vocab_new_today ?? 0) : 0;

  // ── Promote new items (LEARN flow only) ──────────────────────────────────
  let promote: any[] = [];
  if (isNewFlow) {
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
    promote = buffer.slice(0, NEW_PER_DAY);
    const promoteIds = promote.map((i) => i.id);

    if (promoteIds.length) {
      await supabase
        .from('vocab_items').update({ introduced: true, next_review_date: today }).in('id', promoteIds);
      await supabase
        .from('streak_state')
        .update({ vocab_new_date: today, vocab_new_today: newTodayBefore + promoteIds.length })
        .eq('id', 1);

      // Register the base words in user_progress the first time we meet them, so
      // the dashboard's "words started" and mastery roll-up work.
      const promoteWordIds = [...new Set(promote.map((i) => i.word_id))];
      const { data: existingProg } = await supabase
        .from('user_progress').select('word_id').in('word_id', promoteWordIds);
      const known = new Set((existingProg ?? []).map((p: any) => p.word_id));
      const newWordIds = promoteWordIds.filter((id) => !known.has(id));
      if (newWordIds.length) {
        await supabase.from('user_progress').insert(
          newWordIds.map((id) => ({ word_id: id, status: 'learning', next_review_date: today })),
        );
      }
    }
  }

  // ── Review / practice pool: SRS-due first, hardest-first, topped up by the
  //    least-recently-seen. Mastered items stay in the schedule (long interval)
  //    so they rarely surface, matching standard spaced repetition. ──────────
  const promoteIds = promote.map((i) => i.id);
  const target = mode === 'practice' ? PRACTICE_COUNT : mode === 'review' ? REVIEW_ONLY : REVIEW_COUNT;

  // Pull a wide due pool so hardest-first ordering is meaningful, then trim.
  let dueQ = supabase
    .from('vocab_items').select(ITEM_SELECT)
    .eq('introduced', true).lte('next_review_date', today)
    .order('next_review_date', { ascending: true })
    .limit(Math.max(target * 3, 60) + promoteIds.length);
  if (promoteIds.length) dueQ = dueQ.not('id', 'in', `(${promoteIds.join(',')})`);
  const { data: dueRows } = await dueQ;
  const promoteIdSet = new Set(promoteIds);
  let review = (dueRows ?? []).filter((r: any) => !promoteIdSet.has(r.id)).sort(byReviewPriority).slice(0, target);

  // If not enough is due, top up with the least-recently-seen introduced items
  // (this is also what keeps a practice/review session from ever running empty).
  if (review.length < target) {
    const have = new Set([...promoteIds, ...review.map((r: any) => r.id)]);
    const haveArr = [...have];
    let topQ = supabase
      .from('vocab_items').select(ITEM_SELECT)
      .eq('introduced', true)
      .order('last_reviewed_at', { ascending: true, nullsFirst: true })
      .limit(target + haveArr.length);
    if (haveArr.length) topQ = topQ.not('id', 'in', `(${haveArr.join(',')})`);
    const { data: extra } = await topQ;
    review = [...review, ...(extra ?? []).filter((r: any) => !have.has(r.id))];
  }
  review = review.slice(0, target);

  // ── Shape items for the client ───────────────────────────────────────────
  // Intro items carry the answer + example so phase 1 can actually teach them;
  // review/drill items are answered from memory (the client already holds the
  // intro answers for the drill phase — this is a personal, non-adversarial app).
  const toIntro = (it: any) => ({
    id: it.id, wordId: it.word_id, prompt: it.prompt_en, label: it.label, kind: it.kind,
    answer: it.answer_sv, note: it.note ?? null, example: it.example ?? null,
  });
  const toReview = (it: any) => ({
    id: it.id, wordId: it.word_id, prompt: it.prompt_en, label: it.label, kind: it.kind,
    isNew: false, note: it.note ?? null, example: it.example ?? null,
  });

  const intro = isNewFlow ? promote.map(toIntro) : [];
  const reviewItems = review.map(toReview);

  if (!intro.length && !reviewItems.length) {
    return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });
  }

  const { count: remaining } = await supabase
    .from('vocab_items').select('*', { count: 'exact', head: true }).eq('introduced', false);

  return NextResponse.json({
    mode,
    intro,                 // phase 1 + 2 source (new flow only)
    review: reviewItems,   // phase 3 (new flow) / the whole session (practice/review)
    newTodayBefore,
    introducedNow: promote.length,
    dailyTargetMet: newTodayBefore + promote.length >= NEW_PER_DAY,
    bufferLow: (remaining ?? 0) < BUFFER_MIN,
  });
}
