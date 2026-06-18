/**
 * Audit + auto-fix script for the words table.
 * Reviews every row for: wrong verb forms in example sentences, unnatural phrasing,
 * incorrect inflection tables, wrong noun gender, wrong POS.
 * Patches the DB in place and prints a summary of all corrections made.
 *
 * Run:  npm run review
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env vars. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 20;
const DELAY_MS = 2000;

type DbWord = {
  id: string;
  lemma: string;
  pos: string;
  gender: string | null;
  forms: object;
  example_sv: string;
  example_en: string;
};

type ReviewResult =
  | { id: string; ok: true }
  | {
      id: string;
      ok: false;
      fixed_example_sv?: string;
      fixed_example_en?: string;
      fixed_forms?: object;
      fixed_gender?: string | null;
      note: string;
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

function buildReviewPrompt(words: DbWord[]): string {
  const wordList = words.map(w => ({
    id: w.id,
    lemma: w.lemma,
    pos: w.pos,
    gender: w.gender,
    forms: w.forms,
    example_sv: w.example_sv,
    example_en: w.example_en,
  }));

  return `You are a Swedish linguist proofreading a vocabulary database for a learner app. Review each entry below for errors.

CHECK FOR:
1. Example sentence uses wrong verb form (e.g. bare infinitive used as present tense: "fåglarna fly" should be "fåglarna flyger")
2. Example sentence is unnatural, awkward, or grammatically incorrect Swedish
3. Example sentence meaning doesn't match the English translation
4. Inflection forms table has wrong forms for the given lemma/pos
5. Noun gender is wrong (en vs ett)
6. Part of speech is misclassified
7. Example sentence is above A1/A2 level (too complex for a beginner)

RULES FOR FIXES:
- Only flag genuine errors — do NOT flag stylistic preferences or minor phrasing variations
- If fixing example_sv, also provide a corrected example_en that matches it
- Replacement sentences must still be ORIGINAL, short, everyday A1/A2 Swedish
- If forms are wrong, provide the complete corrected forms object

OUTPUT: A JSON array of exactly ${words.length} objects. Each must be one of:
  { "id": "<uuid>", "ok": true }
  { "id": "<uuid>", "ok": false, "note": "<what is wrong>", "fixed_example_sv": "...", "fixed_example_en": "...", "fixed_forms": {...}, "fixed_gender": "en"|"ett"|null }
Only include the "fixed_*" keys that actually need changing. Return ONLY the JSON array.

ENTRIES:
${JSON.stringify(wordList, null, 2)}`;
}

async function main() {
  console.log('Fetching all words from DB…');
  const { data: words, error } = await supabase
    .from('words')
    .select('id, lemma, pos, gender, forms, example_sv, example_en')
    .order('rank');

  if (error) throw new Error(`Supabase fetch error: ${error.message}`);
  console.log(`Loaded ${words!.length} words. Reviewing in batches of ${BATCH_SIZE}…\n`);

  const corrections: Array<{ lemma: string; note: string }> = [];
  let batchNum = 0;
  let reviewed = 0;
  let fixed = 0;

  for (let i = 0; i < words!.length; i += BATCH_SIZE) {
    const batch = words!.slice(i, i + BATCH_SIZE) as DbWord[];
    batchNum++;
    reviewed += batch.length;

    process.stdout.write(
      `Batch ${batchNum} | words ${i + 1}–${Math.min(i + BATCH_SIZE, words!.length)} | fixed so far: ${fixed}\r`
    );

    let results: ReviewResult[];
    try {
      const raw = await callClaude(buildReviewPrompt(batch));
      results = JSON.parse(raw);
    } catch (err) {
      console.warn(`\n  ⚠ Batch ${batchNum} failed (${err}), skipping`);
      await sleep(DELAY_MS);
      continue;
    }

    for (const result of results) {
      if (result.ok) continue;

      const word = batch.find(w => w.id === result.id);
      if (!word) continue;

      const patch: Record<string, any> = {};
      if (result.fixed_example_sv) patch.example_sv = result.fixed_example_sv;
      if (result.fixed_example_en) patch.example_en = result.fixed_example_en;
      if (result.fixed_forms)      patch.forms = result.fixed_forms;
      if ('fixed_gender' in result) patch.gender = result.fixed_gender ?? null;

      if (Object.keys(patch).length === 0) continue;

      const { error: updateError } = await supabase
        .from('words')
        .update(patch)
        .eq('id', result.id);

      if (updateError) {
        console.warn(`\n  ⚠ Update failed for "${word.lemma}": ${updateError.message}`);
      } else {
        fixed++;
        corrections.push({ lemma: word.lemma, note: result.note });
      }
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n\nReview complete. Checked ${reviewed} words, fixed ${fixed}.\n`);

  if (corrections.length === 0) {
    console.log('No errors found.');
  } else {
    console.log('══ ALL CORRECTIONS ══');
    for (const c of corrections) {
      console.log(`  ${c.lemma.padEnd(20)} ${c.note}`);
    }
  }
}

main().catch(err => {
  console.error('\nFatal:', err);
  process.exit(1);
});
