/**
 * One-off seed script: populates the words table with ~1,000 Swedish lemmas
 * sourced from the hermitdave frequency list, enriched via the Anthropic API.
 *
 * Run:  npm run seed
 * Safe to re-run/resume — already-inserted lemmas are skipped automatically.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error(
    'Missing env vars. Create .env.local with SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and ANTHROPIC_API_KEY.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FREQ_LIST_URL =
  'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/sv/sv_50k.txt';
const BATCH_SIZE = 25;
const TARGET = 1000;
const DELAY_MS = 2000;

const VALID_POS = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'pronoun',
  'preposition', 'conjunction', 'numeral', 'interjection', 'other',
]);

type WordInsert = {
  rank: number;
  lemma: string;
  pos: string;
  gender: string | null;
  forms: object;
  example_sv: string;
  example_en: string;
};

async function callClaude(prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic ${response.status}: ${body}`);
  }

  const data = await response.json() as any;
  return (data.content as any[])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildPrompt(tokens: string[]): string {
  return `You are populating a Swedish vocabulary database for a learner app. For each token below, identify its canonical dictionary lemma and return linguistic data.

RULES:
- Map surface forms to base lemmas: "är" → "vara", "böckerna" → "bok", "snabbaste" → "snabb"
- Skip proper nouns, place names, abbreviations, and non-Swedish words — return null for those
- If two tokens in this batch share the same lemma, return data once and null for the duplicate
- Write ORIGINAL example sentences at A1/A2 CEFR level using simple, everyday Swedish — never copy from any existing text (copyright constraint)

FORMS SCHEMA — use the shape that matches the part of speech:
  verb:        { "infinitiv": "...", "presens": "...", "preteritum": "...", "supinum": "...", "imperativ": "..." (or null if none), "future_construction": "kommer att ..." }
  noun:        { "singular_indefinite": "...", "singular_definite": "...", "plural_indefinite": "...", "plural_definite": "..." }
  adjective:   { "common": "...", "neuter": "...", "plural": "...", "comparative": "...", "superlative": "..." }
  adverb / preposition / conjunction / interjection: { "invariant": true }
  pronoun:     { "subject": "...", "object": "...", "possessive": { "common": "...", "neuter": "...", "plural": "..." } }
  numeral:     { "common": "...", "neuter": "..." }  or  { "invariant": true } for indeclinables
  other:       { "invariant": true }
Add an optional "note" string to forms for anything irregular or noteworthy.

OUTPUT: A JSON array of exactly ${tokens.length} items. Each item is null (skip) or:
{
  "token": "<original token>",
  "lemma": "<canonical base form>",
  "pos": "<noun|verb|adjective|adverb|pronoun|preposition|conjunction|numeral|interjection|other>",
  "gender": "en" or "ett" for nouns, null for everything else,
  "forms": { ... per schema above },
  "example_sv": "<one original A1/A2 Swedish sentence>",
  "example_en": "<English translation>"
}

TOKENS:
${tokens.join('\n')}

Return ONLY the JSON array, no explanation or markdown.`;
}

async function main() {
  console.log('Fetching Swedish frequency list…');
  const listResp = await fetch(FREQ_LIST_URL);
  if (!listResp.ok) throw new Error(`Frequency list fetch failed: ${listResp.status}`);
  const listText = await listResp.text();

  const allTokens = listText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/)[0].toLowerCase())
    .filter(t => t.length > 0);

  console.log(`Loaded ${allTokens.length} tokens from frequency list`);

  // Load all existing lemmas from DB so we never re-insert them
  const { data: existingWords, error: fetchError } = await supabase
    .from('words')
    .select('lemma, rank');
  if (fetchError) throw new Error(`Supabase fetch error: ${fetchError.message}`);

  const seenLemmas = new Set<string>(existingWords!.map(w => w.lemma.toLowerCase()));
  let nextRank = existingWords!.reduce((max, w) => Math.max(max, w.rank), 0) + 1;

  console.log(`Found ${seenLemmas.size} existing lemmas. Next rank: ${nextRank}`);
  console.log(`Target: ${TARGET} new lemmas\n`);

  const insertedThisRun: WordInsert[] = [];
  let offset = 0;
  let batchNum = 0;

  while (insertedThisRun.length < TARGET && offset < allTokens.length) {
    const tokens = allTokens.slice(offset, offset + BATCH_SIZE);
    offset += BATCH_SIZE;
    batchNum++;

    console.log(
      `Batch ${batchNum} | freq-list offsets ${offset - BATCH_SIZE}–${offset} | ` +
      `collected ${insertedThisRun.length}/${TARGET}`
    );

    let parsed: any[];
    try {
      const raw = await callClaude(buildPrompt(tokens));
      parsed = JSON.parse(raw);
    } catch (err) {
      console.warn(`  ⚠ Batch ${batchNum} parse/API error: ${err}. Skipping batch.`);
      await sleep(DELAY_MS);
      continue;
    }

    if (!Array.isArray(parsed)) {
      console.warn(`  ⚠ Batch ${batchNum} returned non-array. Skipping.`);
      await sleep(DELAY_MS);
      continue;
    }

    const toInsert: WordInsert[] = [];

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;

      const lemma = (item.lemma ?? '').toLowerCase().trim();
      if (!lemma) continue;
      if (seenLemmas.has(lemma)) continue;
      if (!VALID_POS.has(item.pos)) continue;
      if (!item.forms || typeof item.forms !== 'object') continue;
      if (!item.example_sv || !item.example_en) continue;

      seenLemmas.add(lemma);
      toInsert.push({
        rank: nextRank++,
        lemma,
        pos: item.pos,
        gender: item.pos === 'noun' ? (item.gender ?? null) : null,
        forms: item.forms,
        example_sv: item.example_sv,
        example_en: item.example_en,
      });

      if (insertedThisRun.length + toInsert.length >= TARGET) break;
    }

    if (toInsert.length === 0) {
      console.log('  (no new lemmas in this batch)');
    } else {
      const { error: insertError } = await supabase.from('words').insert(toInsert);
      if (insertError) {
        console.warn(`  ⚠ Insert failed: ${insertError.message}`);
        // Roll back the rank counter and seen-set entries for this batch
        nextRank -= toInsert.length;
        for (const w of toInsert) seenLemmas.delete(w.lemma);
      } else {
        insertedThisRun.push(...toInsert);
        console.log(`  ✓ Inserted ${toInsert.length} words (total this run: ${insertedThisRun.length})`);
      }
    }

    await sleep(DELAY_MS);
  }

  if (insertedThisRun.length < TARGET) {
    console.warn(`\nFrequency list exhausted after ${insertedThisRun.length} new lemmas (target was ${TARGET}).`);
  } else {
    console.log(`\nDone! Inserted ${insertedThisRun.length} new lemmas.`);
  }

  // Spot-check: 20 random words from this run
  const sample = insertedThisRun
    .slice()
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(20, insertedThisRun.length));

  console.log('\n══ 20 RANDOM SPOT-CHECK WORDS ══');
  for (const w of sample) {
    const genderStr = w.gender ? ` [${w.gender}]` : '';
    console.log(`  rank ${w.rank}  ${w.lemma} (${w.pos}${genderStr})`);
    console.log(`    sv: ${w.example_sv}`);
    console.log(`    en: ${w.example_en}`);
  }
}

main().catch(err => {
  console.error('\nFatal:', err);
  process.exit(1);
});
