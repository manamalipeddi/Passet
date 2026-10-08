import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

// Listening pool — deliberately NOT spaced repetition. Listening is recognition,
// not memorization, so instead of SRS scheduling we keep a growing pool of
// sentences built only from already-learned vocabulary. A sentence is retired
// once answered correctly twice in a row (correct_streak >= 2); when the
// un-retired pool runs low we generate fresh sentences from learned words.

const SESSION_SIZE = 10;
const MIN_POOL = 14;       // keep at least this many un-retired sentences available
const RETIRE_AT = 2;       // correct answers in a row before a sentence is retired

// Minimal closed-class glue allowed on top of the learned words (mirrors the
// grammar generator's list) so sentences can be natural without leaking unlearned
// content words.
const FUNCTION_WORDS = new Set<string>([
  'jag','du','han','hon','den','det','vi','ni','de','dem','mig','dig','honom','henne','oss','er','sig','man',
  'min','mitt','mina','din','ditt','dina','sin','sitt','sina','hans','hennes','dess','vår','vårt','våra','deras',
  'en','ett','denna','detta','dessa','någon','något','några','ingen','inget','inga','all','allt','alla','varje','sådan',
  'och','eller','men','att','som','för','så','om','fast','samt','medan','när','då','eftersom','innan','sedan',
  'i','på','av','till','från','med','under','över','vid','hos','mot','efter','före','utan','genom','mellan','åt','ur','kring','bland','per','trots',
  'inte','ej','icke','ja','nej','jo','var','vart','vem','vad','vilken','vilket','vilka','hur','varför',
]);

function normSv(s: string): string {
  return (s ?? '').normalize('NFC').toLowerCase().replace(/[^a-zåäöé\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokensSv(s: string): string[] {
  return normSv(s).split(' ').filter(Boolean);
}
// Single-token surface forms of a word (lemma + inflections), lowercased.
function wordForms(word: any): string[] {
  const out = new Set<string>();
  const add = (s: string) => s.toLowerCase().split('/').forEach((p) => {
    const t = p.trim();
    if (t && !/\s/.test(t) && /^[a-zåäöéü-]+$/i.test(t)) out.add(t);
  });
  if (word?.lemma) add(String(word.lemma));
  const walk = (v: any, key?: string) => {
    if (key === 'note') return;
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walk(val, k);
  };
  walk(word?.forms);
  return [...out];
}

export async function POST() {
  const supabase = getServiceClient();
  const now = new Date().toISOString();

  // Learned material → allowed tokens (for validation) + a word list (for prompts).
  const [{ data: wp }, { data: ph }] = await Promise.all([
    supabase.from('user_progress').select('last_reviewed_at, words(lemma, pos, forms)').limit(2000),
    supabase.from('vocab_items').select('answer_sv').eq('introduced', true).eq('kind', 'phrase').limit(2000),
  ]);
  const allowed = new Set<string>(FUNCTION_WORDS);
  const wordPool: { lemma: string; pos: string | null; last: string | null }[] = [];
  for (const row of wp ?? []) {
    const w = (row as any).words;
    if (!w?.lemma) continue;
    wordPool.push({ lemma: w.lemma, pos: w.pos ?? null, last: (row as any).last_reviewed_at ?? null });
    for (const f of wordForms(w)) allowed.add(f);
  }
  for (const r of ph ?? []) for (const t of tokensSv(String((r as any).answer_sv ?? ''))) allowed.add(t);
  if (!wordPool.length) return NextResponse.json({ error: 'nothing_learned_yet' }, { status: 400 });

  const sentenceOk = (sv: string) => {
    const toks = tokensSv(sv);
    return toks.length > 0 && toks.every((t) => allowed.has(t));
  };

  // How many un-retired sentences do we have?
  const { count: activeCount } = await supabase
    .from('listening_sentences').select('*', { count: 'exact', head: true }).lt('correct_streak', RETIRE_AT);

  // Top up the pool when it's running low.
  if ((activeCount ?? 0) < MIN_POOL) {
    const { data: existingRows } = await supabase.from('listening_sentences').select('sentence_sv').limit(1000);
    const existing = new Set((existingRows ?? []).map((r: any) => normSv(r.sentence_sv)));
    const generated = await generateSentences(wordPool, sentenceOk, existing, MIN_POOL);
    if (generated.length) {
      await supabase.from('listening_sentences').insert(
        generated.map((g) => ({ sentence_sv: g.sv, sentence_en: g.en })),
      );
    }
  }

  // Pull a session: un-retired, freshest first (least shown, then least recently
  // shown, then newest), re-validated in case of any drift.
  const { data: rows } = await supabase
    .from('listening_sentences')
    .select('id, sentence_sv, sentence_en, times_shown, last_shown_at')
    .lt('correct_streak', RETIRE_AT)
    .order('times_shown', { ascending: true })
    .order('last_shown_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: false })
    .limit(SESSION_SIZE * 2);
  const picked = (rows ?? []).filter((r: any) => sentenceOk(r.sentence_sv)).slice(0, SESSION_SIZE);
  if (!picked.length) return NextResponse.json({ error: 'generation_failed' }, { status: 502 });

  for (const r of picked) {
    await supabase.from('listening_sentences')
      .update({ times_shown: (r.times_shown ?? 0) + 1, last_shown_at: now }).eq('id', r.id);
  }

  return NextResponse.json({
    sentences: picked.map((r: any) => ({ id: r.id, sentence_sv: r.sentence_sv, sentence_en: r.sentence_en })),
  });
}

// Generate fresh sentences from learned vocab, validated so every content word is
// one the learner has met. Retries a couple of times to reach `target` valid new
// ones; returns whatever it got (best-effort — never throws).
async function generateSentences(
  wordPool: { lemma: string; pos: string | null; last: string | null }[],
  sentenceOk: (sv: string) => boolean,
  existing: Set<string>,
  target: number,
): Promise<{ sv: string; en: string }[]> {
  const sample = [...wordPool]
    .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))   // recently-practiced first
    .slice(0, 80)
    .map((w) => `${w.lemma}${w.pos ? ` (${w.pos})` : ''}`)
    .join('; ');

  const out: { sv: string; en: string }[] = [];
  const seen = new Set(existing);
  let attempts = 0;
  while (out.length < target && attempts < 3) {
    attempts++;
    const need = target - out.length;
    const prompt = `You are generating Swedish listening-practice sentences for a learner who knows ONLY these Swedish words:
${sample}
Write ${need + 3} short, natural, everyday Swedish sentences (A1–A2 level, 4–9 words each). HARD CONSTRAINT: every content word MUST come from the list above; you may add only basic closed-class function words (pronouns, en/ett, och, att, som, prepositions like i/på/med, inte, question words). No unlisted nouns, verbs, adjectives or adverbs. Vary them; make them sound like real speech. Give an accurate English translation of each.
Return ONLY a JSON array, no markdown: [{"sv":"Swedish sentence","en":"English translation"}]`;
    let arr: any[] = [];
    try {
      const parsed = JSON.parse(await callClaude(prompt, 1200));
      if (Array.isArray(parsed)) arr = parsed;
    } catch { /* best-effort */ }
    let added = 0;
    for (const s of arr) {
      const sv = String(s?.sv ?? '').trim();
      const en = String(s?.en ?? '').trim();
      if (!sv || !en) continue;
      const key = normSv(sv);
      if (seen.has(key) || !sentenceOk(sv)) continue;
      seen.add(key);
      out.push({ sv, en });
      added++;
      if (out.length >= target) break;
    }
    if (!added) break;   // model isn't producing new valid ones; stop
  }
  if (out.length < target) {
    console.warn(`[listen/session] generated only ${out.length}/${target} valid new sentences`);
  }
  return out;
}
