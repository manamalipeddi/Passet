import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';
import { updateSrs } from '@/lib/srs';

// Grade a typed Swedish answer for a vocabulary quiz item (English shown → type
// Swedish). Cheap path first: a deterministic, typo- and diacritic-tolerant match
// against the word's lemma and inflected forms is instant and free. Only when
// that fails do we ask Claude to judge nuance (close? another word better?) and
// leave a short comment. Either way the word's SRS schedule is updated.

// Fold å/ä→a, ö→o, é→e, strip leading "att "/"en "/"ett ", collapse whitespace.
function normalize(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .trim()
    .replace(/^(att|en|ett)\s+/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip combining accents
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
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Single-token surface forms of a word (lemma + inflections), normalized.
function acceptableForms(word: any): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const part of String(s).split('/')) {
      const t = normalize(part);
      if (t && !/\s/.test(t)) out.add(t);
    }
  };
  if (word?.lemma) add(word.lemma);
  const walk = (v: any, key?: string) => {
    if (key === 'note') return;
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walk(val, k);
  };
  walk(word?.forms);
  return [...out];
}

function deterministicMatch(userAnswer: string, word: any): boolean {
  const user = normalize(userAnswer);
  if (!user) return false;
  const forms = acceptableForms(word);
  for (const f of forms) {
    if (user === f) return true;
    // Typo tolerance: allow a single edit, but only on words long enough that a
    // one-char slip can't turn one real word into a different one.
    if (f.length >= 5 && levenshtein(user, f) <= 1) return true;
  }
  return false;
}

export async function POST(req: Request) {
  const { wordId, userAnswer } = await req.json().catch(() => ({}));
  if (!wordId) return NextResponse.json({ error: 'missing_word' }, { status: 400 });

  const supabase = getServiceClient();
  const { data: word } = await supabase
    .from('words')
    .select('id, lemma, pos, gender, translation, forms')
    .eq('id', wordId)
    .single();
  if (!word) return NextResponse.json({ error: 'word_not_found' }, { status: 404 });

  let correct = deterministicMatch(userAnswer ?? '', word);
  let comment = '';

  if (correct) {
    comment = 'Rätt! 🎉';
  } else {
    // Nuanced fallback: is the answer acceptable, close, or is another word better?
    const prompt = `You are an encouraging Swedish tutor grading a single-word vocabulary quiz.
The learner was shown the English word/meaning: "${word.translation ?? ''}".
The intended Swedish word is: "${word.lemma}"${word.gender ? ` (${word.gender})` : ''}.
The learner typed: "${userAnswer ?? ''}".

Judge whether the learner's Swedish is an acceptable answer for that English meaning (accept valid synonyms or alternate correct words, not just the intended one). If it's wrong but close (a typo, wrong form, or a near-miss), say so. If they used a real word that means something else, or that's a worse fit than another word, mention the better-suited word briefly. Return ONLY valid JSON, no markdown:
{"correct": true or false, "comment": "one short, encouraging sentence (max ~20 words)"}`;

    try {
      const result = JSON.parse(await callClaude(prompt, 300));
      correct = !!result.correct;
      comment = typeof result.comment === 'string' ? result.comment : '';
    } catch (err) {
      console.error('[vocab/grade] AI grading failed:', err);
      // Fail closed: treat as incorrect but tell the truth so it's not silent.
      comment = `The word is "${word.lemma}".`;
    }
  }

  // Update the word's spaced-repetition schedule and tallies.
  const { data: prog } = await supabase.from('user_progress').select('*').eq('word_id', wordId).single();
  if (prog) {
    const updated = updateSrs(prog, correct);
    await supabase
      .from('user_progress')
      .update({
        ...updated,
        status: updated.interval_days > 10 ? 'known' : 'learning',
        last_reviewed_at: new Date().toISOString(),
        times_correct: prog.times_correct + (correct ? 1 : 0),
        times_wrong: prog.times_wrong + (correct ? 0 : 1),
      })
      .eq('word_id', wordId);
  }

  await supabase.from('attempts').insert({
    direction: 'en_to_sv',
    prompt_text: word.translation ?? '',
    target_text: word.lemma,
    user_answer: userAnswer ?? '',
    is_correct: correct,
    explanation: comment,
    word_ids: [wordId],
    grammar_point_ids: [],
  });

  return NextResponse.json({ correct, comment, corrected: word.lemma });
}
