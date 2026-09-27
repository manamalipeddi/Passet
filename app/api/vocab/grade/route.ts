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

// Normalize for comparison WITHOUT touching Swedish letters: å ä ö é are
// distinct letters that change meaning (vara "to be" ≠ våra "our"), so they are
// preserved. We only lowercase (capitalization isn't graded), strip a leading
// "att "/"en "/"ett ", drop punctuation (commas/periods aren't graded), and
// collapse whitespace. NFC first so a decomposed å survives the punctuation strip.
function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/^(att|en|ett)\s+/, '')
    .replace(/[^a-z0-9åäöé\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ASCII-fold Swedish letters — used ONLY to detect when the sole difference
// between two answers is a diacritic (so we can refuse to forgive it as a typo).
function foldDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
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
    // single slip can't collapse it into a genuinely different answer — AND the
    // difference is a real letter typo, never just a missing/wrong diacritic
    // (foldDiacritics equal ⇒ the only difference was å/ä/ö/é, which is wrong).
    if (a.length >= 5 && levenshtein(user, a) <= 1 && foldDiacritics(user) !== foldDiacritics(a)) return true;
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
  let userAnswerMeaning: string | null = null;

  if (correct) {
    comment = 'Rätt! 🎉';
  } else {
    const prompt = `You are an encouraging Swedish tutor grading one vocabulary item.
The learner was shown the English prompt: "${item.prompt_en}"${item.label ? ` (${item.label})` : ''}.
The expected Swedish answer is: "${item.answer_sv}"${item.alt_sv?.length ? ` (also acceptable: ${item.alt_sv.join(', ')})` : ''}.
The learner typed: "${userAnswer ?? ''}".

Grade fairly. Swedish has flexibility — accept ANY genuinely correct translation, not only the expected one: alternative word order, presence or absence of a subject pronoun, valid synonyms, and equivalent forms are all correct. Do NOT mark a correct answer wrong; when in doubt, lean towards correct.

STRICT on the Swedish alphabet: å, ä, ö and é are distinct letters, not accented a/o/e. A missing or wrong diacritic is a different word (e.g. "vara" = to be vs "våra" = our) and MUST be marked incorrect. Capitalization and comma placement that merely differ from English are NOT errors — do not mark them wrong, but do mention the difference briefly in the comment when it occurs (Swedish lowercases weekdays, months, languages and nationalities).

If (and only if) it is genuinely wrong, you MUST explain SPECIFICALLY what is wrong — the exact issue (wrong word choice, wrong tense/form, missing/wrong diacritic, spelling, missing/extra word, word order) — never a vague comment. Return ONLY valid JSON, no markdown:
{"correct": true or false, "comment": "one short sentence: praise if correct, otherwise the specific reason it's wrong", "your_answer_meaning": "if wrong AND the learner wrote real Swedish, a literal English gloss of what THEY actually wrote (so they see their words vs. the intended meaning); otherwise null"}`;
    try {
      const result = JSON.parse(await callClaude(prompt, 300));
      correct = !!result.correct;
      comment = typeof result.comment === 'string' ? result.comment.trim() : '';
      userAnswerMeaning = typeof result.your_answer_meaning === 'string' && result.your_answer_meaning.trim()
        ? result.your_answer_meaning.trim() : null;
    } catch (err) {
      console.error('[vocab/grade] AI grading failed:', err);
    }
    if (correct) {
      comment = comment || 'Rätt! 🎉';
    } else if (!comment) {
      // Never leave the learner without an explanation.
      comment = `Not quite — the expected answer is "${item.answer_sv}".`;
    }
  }

  // Mastery is count-based: a single-word answer is mastered after MASTER_SINGLE
  // correct, a multi-word answer (phrase or form like "har bott") after
  // MASTER_PHRASE. Mastered items are NOT retired — they stay in spaced
  // repetition but, once mastered and answered correctly, graduate to at least a
  // "mature" interval (21 days, the Anki convention) so they sit further out
  // than learning items. A wrong answer still resets them via normal SM-2, so a
  // slip brings the item back soon regardless of the mastered label.
  const MASTER_SINGLE = 2;
  const MASTER_PHRASE = 5;
  const MATURE_DAYS   = 21;
  const isPhrase = (item.answer_sv ?? '').trim().split(/\s+/).filter(Boolean).length >= 2;
  const newTimesCorrect = (item.times_correct ?? 0) + (correct ? 1 : 0);
  const itemMastered = newTimesCorrect >= (isPhrase ? MASTER_PHRASE : MASTER_SINGLE);

  let sched = updateSrs(item, correct);
  if (correct && itemMastered && sched.interval_days < MATURE_DAYS) {
    const next = new Date();
    next.setDate(next.getDate() + MATURE_DAYS);
    sched = { ...sched, interval_days: MATURE_DAYS, next_review_date: next.toISOString().slice(0, 10) };
  }
  await supabase
    .from('vocab_items')
    .update({
      ...sched,
      status: itemMastered ? 'known' : 'learning',
      last_reviewed_at: new Date().toISOString(),
      times_correct: newTimesCorrect,
      times_wrong: (item.times_wrong ?? 0) + (correct ? 0 : 1),
    })
    .eq('id', itemId);

  // Roll the result up to the parent word: keep tallies live for the dashboard,
  // and mark the word mastered only once every one of its items is mastered.
  const { data: prog } = await supabase
    .from('user_progress').select('*').eq('word_id', item.word_id).single();
  if (prog) {
    const { data: siblings } = await supabase
      .from('vocab_items').select('id, status').eq('word_id', item.word_id);
    const allKnown = (siblings ?? []).every((s: any) =>
      s.id === itemId ? itemMastered : s.status === 'known');
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

  return NextResponse.json({
    correct,
    comment,
    corrected: item.answer_sv,
    userAnswerMeaning,
    mastered: itemMastered,
  });
}
