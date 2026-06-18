import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

export async function POST(req: Request) {
  const { raw_input } = await req.json().catch(() => ({}));
  if (!raw_input?.trim()) return NextResponse.json({ error: 'missing raw_input' }, { status: 400 });

  const prompt = `You are helping build a Swedish vocabulary learning app. The user heard the Swedish expression "${raw_input.trim()}" and wants to add it.

Identify the correct base lemma (correct any misspellings; convert inflected forms to dictionary form, e.g. "springer" → "springa", "böckerna" → "bok"). Then produce its full linguistic data.

FORMS SCHEMA — use the shape for the detected part of speech:
  verb:        { "infinitiv": "...", "presens": "...", "preteritum": "...", "supinum": "...", "imperativ": "..." or null, "future_construction": "..." }
  noun:        { "singular_indefinite": "...", "singular_definite": "...", "plural_indefinite": "...", "plural_definite": "..." }
  adjective:   { "common": "...", "neuter": "...", "plural": "...", "comparative": "...", "superlative": "..." }
  adverb / preposition / conjunction / interjection / other: { "invariant": true }
  pronoun:     { "subject": "...", "object": "...", "possessive": { "common": "...", "neuter": "...", "plural": "..." } }

Return ONLY valid JSON, no markdown:
{
  "lemma": "base dictionary form, lowercase",
  "pos": "noun|verb|adjective|adverb|preposition|conjunction|pronoun|numeral|interjection|other",
  "gender": "en" or "ett" for nouns, null otherwise,
  "forms": { ...matching schema above },
  "example_sv": "one original A1/A2 Swedish example sentence, never copied from any existing text",
  "example_en": "English translation of the example sentence",
  "definition": "concise English definition, 2-6 words"
}`;

  let claudeData: any;
  try {
    claudeData = JSON.parse(await callClaude(prompt));
  } catch {
    return NextResponse.json({ error: 'normalization_failed' }, { status: 502 });
  }

  if (!claudeData?.lemma || !claudeData?.pos) {
    return NextResponse.json({ error: 'invalid_word_data' }, { status: 422 });
  }

  const normalizedLemma = claudeData.lemma.toLowerCase().trim();
  claudeData.lemma = normalizedLemma;

  const supabase = getServiceClient();
  const { data: existing } = await supabase
    .from('words')
    .select('id, lemma, pos, gender, example_sv, example_en, source')
    .eq('lemma', normalizedLemma)
    .maybeSingle();

  if (existing) {
    // Check if it's already in the active practice queue
    const { data: progress } = await supabase
      .from('user_progress')
      .select('id')
      .eq('word_id', existing.id)
      .maybeSingle();

    if (progress) {
      // Already being actively practiced — nothing to do
      return NextResponse.json({ already_exists: true, word: existing });
    }

    // In the word bank but not yet in the queue — offer to fast-track it.
    // Surface Claude's definition alongside the DB's example sentence.
    return NextResponse.json({
      already_exists: false,
      preview: {
        word_id:    existing.id,           // signals fast-track path in confirm
        lemma:      existing.lemma,
        pos:        existing.pos,
        gender:     existing.gender,
        example_sv: existing.example_sv,
        example_en: existing.example_en,
        definition: claudeData.definition,
        forms:      claudeData.forms,      // kept for completeness, not re-inserted
      },
    });
  }

  // Brand new word
  return NextResponse.json({ already_exists: false, preview: claudeData });
}
