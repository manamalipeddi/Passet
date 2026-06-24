/**
 * One-off backfill: fills the words.translation column with a short English
 * gloss for every word that doesn't have one yet.
 *
 * Run:  npm run backfill-translations
 * Safe to re-run/resume — only words with a null translation are processed.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !ANTHROPIC_API_KEY) {
  console.error('Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY in .env.local.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BATCH_SIZE = 50;
const DELAY_MS = 1500;

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
  if (!response.ok) throw new Error(`Anthropic ${response.status}: ${await response.text()}`);
  const data = (await response.json()) as any;
  return (data.content as any[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .replace(/```json|```/g, '')
    .trim();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function buildPrompt(rows: any[]) {
  const lines = rows.map(
    (w) => `- id:${w.id} | lemma:"${w.lemma}" | pos:${w.pos} | example: ${w.example_sv} (${w.example_en})`,
  );
  return `You are building a Swedish→English glossary for a beginner learner.
For each entry below, give a SHORT English meaning of the Swedish lemma (a dictionary gloss, not a sentence). For verbs use the "to ..." form (e.g. "to read"). Keep it to 1–4 words. Use the example sentence only to pick the right sense.

Return ONLY a JSON array, no markdown, one object per entry:
[{"id": "<the id>", "translation": "<short english gloss>"}]

ENTRIES:
${lines.join('\n')}`;
}

async function main() {
  let totalUpdated = 0;
  let batchNum = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from('words')
      .select('id, lemma, pos, example_sv, example_en')
      .is('translation', null)
      .order('rank')
      .limit(BATCH_SIZE);
    if (error) throw new Error(`Supabase fetch error: ${error.message}`);
    if (!rows || rows.length === 0) break;

    batchNum++;
    console.log(`Batch ${batchNum}: ${rows.length} words…`);

    let parsed: any[];
    try {
      parsed = JSON.parse(await callClaude(buildPrompt(rows)));
    } catch (err) {
      console.warn(`  ⚠ parse/API error: ${err}. Retrying after delay.`);
      await sleep(DELAY_MS * 2);
      continue;
    }
    if (!Array.isArray(parsed)) {
      console.warn('  ⚠ non-array response; skipping batch.');
      await sleep(DELAY_MS);
      continue;
    }

    const byId = new Map(rows.map((r: any) => [r.id, r]));
    let updatedThisBatch = 0;
    for (const item of parsed) {
      const id = item?.id;
      const translation = (item?.translation ?? '').toString().trim();
      if (!id || !translation || !byId.has(id)) continue;
      const { error: upErr } = await supabase.from('words').update({ translation }).eq('id', id);
      if (upErr) { console.warn(`  ⚠ update failed for ${id}: ${upErr.message}`); continue; }
      updatedThisBatch++;
    }
    totalUpdated += updatedThisBatch;
    console.log(`  ✓ updated ${updatedThisBatch}/${rows.length} (total ${totalUpdated})`);

    // Safety: if a batch updated nothing, stop rather than loop forever
    if (updatedThisBatch === 0) {
      console.warn('  ⚠ batch produced no updates — stopping to avoid an infinite loop.');
      break;
    }
    await sleep(DELAY_MS);
  }

  console.log(`\nDone. Updated ${totalUpdated} words.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
