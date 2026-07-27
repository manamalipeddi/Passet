import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

// Tense "study aid" for an English->Swedish practice sentence: the same base
// clause rendered across a fixed set of English tenses (each with its Swedish),
// plus a full form table for every noun. The main graded sentence is one of the
// forms (isMain). Grading is unchanged — this is priming/reference only.
//
// Generated once per sentence via Claude, then cached on generated_sentences.variants
// (sentences are re-shown across sessions, so we never regenerate for the same one).

// Fixed order the UI renders in. 6 core tenses + two perfects (learner's choice).
const TENSES = [
  'simple present',      // he plays
  'present continuous',  // he is playing
  'present perfect',     // he has played
  'simple past',         // he played
  'past continuous',     // he was playing
  'past perfect',        // he had played
  'simple future',       // he will play
  'future continuous',   // he will be playing
];

export async function POST(req: Request) {
  const { sentence_id } = await req.json().catch(() => ({}));
  if (!sentence_id) return NextResponse.json({ error: 'missing sentence_id' }, { status: 400 });

  const supabase = getServiceClient();
  const { data: row } = await supabase
    .from('generated_sentences')
    .select('id, direction, sentence_en, sentence_sv, variants')
    .eq('id', sentence_id)
    .single();

  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Only English->Swedish sentences get the tense study aid.
  if (row.direction !== 'en_to_sv') return NextResponse.json({ forms: [], nouns: [] });
  // Cached already — return as-is.
  if (row.variants) return NextResponse.json(row.variants);

  const prompt = `You are a Swedish tutor building a tense-priming study aid for a beginner (A1-A2).

The learner is translating this English sentence into Swedish (this exact form is the one being graded — keep it verbatim):
English: "${row.sentence_en}"
Swedish: "${row.sentence_sv}"

Task 1 — Take the base clause of that sentence and render it in ALL of these English tenses, in this exact order: ${TENSES.join(', ')}. For each, give the natural English sentence and its correct, natural Swedish translation. Keep the same subject, verb, and objects — only the tense changes. Swedish often does NOT distinguish tenses that English does (e.g. "plays" and "is playing" are both "leker"); when that happens, give the SAME Swedish for both — do not invent a distinction. Mark the one form that matches the graded sentence above with "isMain": true (use the given English/Swedish verbatim for it).

Task 2 — For every common noun in the sentence, give its full form table in Swedish: gender ("en" or "ett"), indefinite singular (with article, e.g. "en katt"), definite singular ("katten"), indefinite plural ("katter"), definite plural ("katterna"), and a short English gloss. If there are no nouns, return an empty list. Do not include pronouns or proper names.

Return ONLY valid JSON, no markdown:
{
  "forms": [ { "tense": "simple present", "en": "...", "sv": "...", "isMain": false }, ... ],
  "nouns": [ { "lemma": "katt", "gloss": "cat", "gender": "en", "indefSing": "en katt", "defSing": "katten", "indefPlural": "katter", "defPlural": "katterna" }, ... ]
}`;

  let parsed: any;
  try {
    parsed = JSON.parse(await callClaude(prompt, 1500));
  } catch {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  const forms = Array.isArray(parsed?.forms) ? parsed.forms : [];
  const nouns = Array.isArray(parsed?.nouns) ? parsed.nouns : [];

  // Defensive: make sure exactly one form is flagged as the graded one, matching
  // by English text if the model didn't set it (so the UI can highlight it).
  if (forms.length && !forms.some((f: any) => f?.isMain)) {
    const mainEn = (row.sentence_en ?? '').trim().toLowerCase();
    const hit = forms.find((f: any) => (f?.en ?? '').trim().toLowerCase() === mainEn);
    if (hit) hit.isMain = true;
  }

  const variants = { forms, nouns };
  await supabase.from('generated_sentences').update({ variants }).eq('id', sentence_id);

  return NextResponse.json(variants);
}
