import { callClaude } from '@/lib/anthropic';

// Generates the quiz-able items for a single word — the dictionary form plus its
// inflected forms and a few short phrases — and caches them in vocab_items.
//
// The Swedish forms already live in words.forms, so we hand them to the model and
// tell it to reuse those EXACT spellings; its real job is writing natural English
// prompts ("lived", "have lived") and inventing 2–3 useful phrases. Deterministic
// data stays deterministic; only the judgment part goes to the LLM. Uses Haiku:
// fast and cheap, plenty for this. Best-effort — on any failure we log and insert
// nothing, so it can be retried later. Returns the number of items inserted.

const VALID_KINDS = new Set(['lemma', 'verb_tense', 'noun_form', 'adj_form', 'phrase']);

// Pull the first JSON array out of a model response, tolerating stray prose.
function parseArray(text: string): any[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        const v = JSON.parse(text.slice(start, end + 1));
        return Array.isArray(v) ? v : [];
      } catch { /* fall through */ }
    }
    return [];
  }
}

type WordInput = {
  id: string; lemma: string; pos: string | null; gender: string | null;
  translation: string | null; forms: any;
};

export async function generateItemsForWord(
  supabase: any,
  word: WordInput,
): Promise<number> {
  const translation = (word.translation ?? '').trim();

  const prompt = `You are building Swedish vocabulary flashcards for an English speaker.
Word: "${word.lemma}" (part of speech: ${word.pos ?? 'word'}${word.gender ? `, ${word.gender}` : ''}), meaning "${translation}".
Known Swedish forms (use these EXACT spellings as the Swedish answers — never invent a form):
${JSON.stringify(word.forms ?? {})}

Produce quiz items. Each has an English prompt the learner sees and the Swedish answer they type.
Include the ones that APPLY to this part of speech:
- verb: infinitive ("to X"), present ("X / Xs"), past ("Xed"), perfect ("have Xed" = "har " + supinum), future ("will X" = "ska " + infinitive)
- noun: indefinite singular ("a/an X"), definite singular ("the X"), indefinite plural ("Xs"), definite plural ("the Xs")
- adjective: base ("X"), comparative ("more X / Xer"), superlative ("most X / Xest")
Always include one "lemma" item: prompt = the English meaning "${translation}", answer = "${word.lemma}".
Also add 2-3 SHORT, useful phrases/chunks that use this word — sentence parts, NOT full sentences (e.g. "thinking about" -> "tänka på", "previous year" -> "förra året").
Use natural English for prompts, including irregular forms ("went", "gone", "bigger"). For grammatical forms the Swedish answer MUST be built from the forms above. Omit any form that doesn't apply.

Return ONLY a JSON array, no markdown:
[{"kind":"lemma|verb_tense|noun_form|adj_form|phrase","label":"short label e.g. 'past tense' or the phrase","prompt_en":"English shown","answer_sv":"Swedish answer","alt_sv":["optional alternates"]}]`;

  let raw: any[];
  try {
    raw = parseArray(await callClaude(prompt, 900, 'claude-haiku-4-5-20251001'));
  } catch (err) {
    console.error('[vocabItems] generation failed for', word.lemma, err);
    return 0;
  }

  // Sanitize + dedupe by English prompt.
  const seen = new Set<string>();
  const rows: any[] = [];
  for (const it of raw) {
    const kind = VALID_KINDS.has(it?.kind) ? it.kind : 'phrase';
    const prompt_en = String(it?.prompt_en ?? '').trim();
    const answer_sv = String(it?.answer_sv ?? '').trim();
    if (!prompt_en || !answer_sv) continue;
    const key = prompt_en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const alt_sv = Array.isArray(it?.alt_sv)
      ? it.alt_sv.map((a: any) => String(a).trim()).filter(Boolean).slice(0, 4)
      : [];
    rows.push({
      word_id: word.id,
      kind,
      label: String(it?.label ?? '').trim() || null,
      prompt_en,
      answer_sv,
      alt_sv,
      introduced: false,
    });
    if (rows.length >= 14) break;
  }

  // Guarantee a lemma item even if the model forgot it.
  if (translation && word.lemma && !seen.has(translation.toLowerCase())) {
    rows.push({
      word_id: word.id, kind: 'lemma', label: 'dictionary form',
      prompt_en: translation, answer_sv: word.lemma, alt_sv: [], introduced: false,
    });
  }

  if (!rows.length) return 0;

  // Ignore rows that clash with an existing (word_id, prompt_en) so re-runs are safe.
  const { data, error } = await supabase
    .from('vocab_items')
    .upsert(rows, { onConflict: 'word_id,prompt_en', ignoreDuplicates: true })
    .select('id');
  if (error) { console.error('[vocabItems] insert failed for', word.lemma, error.message); return 0; }
  return data?.length ?? 0;
}

// Find the next words that have no items yet (user-added "heard" words first,
// then curriculum by frequency rank) and generate items for up to `limit` of them.
// Used to keep the un-introduced buffer topped up. Returns words processed.
export async function topUpItemBuffer(supabase: any, limit = 3): Promise<number> {
  const { data: haveRows } = await supabase.from('vocab_items').select('word_id');
  const have = new Set((haveRows ?? []).map((r: any) => r.word_id));

  const { data: cands } = await supabase
    .from('words')
    .select('id, lemma, pos, gender, translation, forms, source, rank')
    .order('rank', { ascending: true })
    .limit(400);

  const next = (cands ?? [])
    .filter((w: any) => !have.has(w.id) && (w.translation ?? '').trim())
    .sort((a: any, b: any) =>
      (a.source === 'curriculum' ? 1 : 0) - (b.source === 'curriculum' ? 1 : 0)
      || (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .slice(0, limit);

  let done = 0;
  for (const w of next) {
    const n = await generateItemsForWord(supabase, w);
    if (n > 0) done++;
  }
  return done;
}
