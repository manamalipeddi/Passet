import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';
import { updateSrs } from '@/lib/srs';

// Grade a typed Swedish answer for one vocab item (English shown → type Swedish).
// Cheap path first: a deterministic, typo- and diacritic-tolerant match against
// the item's answer (and any acceptable alternates) is instant and free. Only on
// a miss do we ask Claude to judge nuance and leave a short comment. Either way
// the item's SRS schedule is updated, and the parent word is marked mastered once
// all of its items are.

// Fold å/ä→a, ö→o, é→e, strip leading "att "/"en "/"ett ", collapse whitespace.
function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .trim()
    .replace(/^(att|en|ett)\s+/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function deterministicMatch(userAnswer: string, accepted: string[]): boolean {
  const user = normalize(userAnswer);
  if (!user) return false;
  for (const ans of accepted) {
    const a = normalize(ans);
    if (!a) continue;
    if (user === a) return true;
    // Typo tolerance: one edit, but only when the phrase is long enough that a
    // single slip can't collapse it into a genuinely different answer.
    if (a.length >= 5 && levenshtein(user, a) <= 1) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const { itemId, userAnswer } = await req.json().catch(() => ({}));
  if (!itemId) return NextResponse.json({ error: 'missing_item' }, { status: 400 });

  const supabase = getServiceClient();
  const { data: item } = await supabase
    .from('vocab_items')
    .select('*, words(lemma, translation)')
    .eq('id', itemId)
    .single();
  if (!item) return NextResponse.json({ error: 'item_not_found' }, { status: 404 });

  const accepted = [item.answer_sv, ...(item.alt_sv ?? [])].filter(Boolean);
  let correct = deterministicMatch(userAnswer ?? '', accepted);
  let comment = '';

  if (correct) {
    comment = 'Rätt! 🎉';
  } else {
    const prompt = `You are an encouraging Swedish tutor grading one vocabulary item.
The learner was shown the English prompt: "${item.prompt_en}"${item.label ? ` (${item.label})` : ''}.
The expected Swedish answer is: "${item.answer_sv}"${item.alt_sv?.length ? ` (also acceptable: ${item.alt_sv.join(', ')})` : ''}.
The learner typed: "${userAnswer ?? ''}".

Judge whether the learner's Swedish is an acceptable answer for that prompt (accept genuinely correct alternatives, not just the expected one). If it's wrong but close (a typo, wrong form, or near-miss), say so; if they used a real word meaning something else or a worse-fitting one, mention the better word briefly. Return ONLY valid JSON, no markdown:
{"correct": true or false, "comment": "one short, encouraging sentence (max ~20 words)"}`;
    try {
      const result = JSON.parse(await callClaude(prompt, 300));
      correct = !!result.correct;
      comment = typeof result.comment === 'string' ? result.comment : '';
    } catch (err) {
      console.error('[vocab/grade] AI grading failed:', err);
      comment = `The answer is "${item.answer_sv}".`;
    }
  }

  // Update this item's SRS + tallies.
  const updated = updateSrs(item, correct);
  await supabase
    .from('vocab_items')
    .update({
      ...updated,
      status: updated.interval_days > 10 ? 'known' : 'learning',
      last_reviewed_at: new Date().toISOString(),
      times_correct: (item.times_correct ?? 0) + (correct ? 1 : 0),
      times_wrong: (item.times_wrong ?? 0) + (correct ? 0 : 1),
    })
    .eq('id', itemId);

  // Roll the result up to the parent word: keep tallies live for the dashboard,
  // and mark the word mastered only once every one of its items is mastered.
  const { data: prog } = await supabase
    .from('user_progress').select('*').eq('word_id', item.word_id).single();
  if (prog) {
    const thisNowKnown = updated.interval_days > 10;
    const { data: siblings } = await supabase
      .from('vocab_items').select('id, status').eq('word_id', item.word_id);
    const allKnown = (siblings ?? []).every((s: any) =>
      s.id === itemId ? thisNowKnown : s.status === 'known');
    await supabase
      .from('user_progress')
      .update({
        status: allKnown ? 'known' : 'learning',
        last_reviewed_at: new Date().toISOString(),
        times_correct: (prog.times_correct ?? 0) + (correct ? 1 : 0),
        times_wrong: (prog.times_wrong ?? 0) + (correct ? 0 : 1),
      })
      .eq('word_id', item.word_id);
  }

  await supabase.from('attempts').insert({
    direction: 'en_to_sv',
    prompt_text: item.prompt_en,
    target_text: item.answer_sv,
    user_answer: userAnswer ?? '',
    is_correct: correct,
    explanation: comment,
    word_ids: [item.word_id],
    grammar_point_ids: [],
  });

  return NextResponse.json({ correct, comment, corrected: item.answer_sv });
}
