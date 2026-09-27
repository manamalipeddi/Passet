import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

const NEEDED = 3;

type Mode = 'daily' | 'extra' | 'learn' | 'targeted' | 'words' | 'grammar' | 'practice';

// Surface forms of a word (lemma + single-token inflections), lowercased.
// Used to require/verify the focus word in targeted-word practice sentences.
function wordForms(word: any): string[] {
  const out = new Set<string>();
  const add = (s: string) =>
    s.toLowerCase().split('/').forEach((part) => {
      const t = part.trim();
      if (t && !/\s/.test(t) && /^[a-zåäöéü-]+$/i.test(t)) out.add(t);
    });
  if (word?.lemma) add(String(word.lemma));
  const walk = (v: any, key?: string) => {
    if (key === 'note') return;                  // skip free-text notes
    if (typeof v === 'string') add(v);
    else if (v && typeof v === 'object') for (const [k, val] of Object.entries(v)) walk(val, k);
  };
  walk(word?.forms);
  return [...out];
}

function sentenceHasWord(sentence: string, forms: string[]): boolean {
  if (!forms.length) return true;
  const tokens = new Set((sentence ?? '').toLowerCase().split(/[^a-zåäöéü]+/i).filter(Boolean));
  return forms.some((f) => tokens.has(f));
}

async function fetchCached(
  supabase: ReturnType<typeof getServiceClient>,
  direction: 'en_to_sv' | 'sv_to_en',
  grammarId: string | null,
  primaryWordId: string | null,
  mustContainForms: string[] = [],
) {
  if (!grammarId && !primaryWordId) return [];
  // When a focus word is required, pull a wider pool and filter to sentences
  // that actually contain it — the cache can hold sentences that merely shared
  // this primary_word_id without using the word.
  let q = supabase
    .from('generated_sentences')
    .select('*')
    .eq('direction', direction)
    .eq('is_excluded', false)
    .lt('times_correct', 4)               // retire sentences answered right 4 times
    .order('last_shown_at', { ascending: true, nullsFirst: true })
    .limit(mustContainForms.length ? 40 : NEEDED);
  q = grammarId ? q.eq('grammar_point_id', grammarId) : q.eq('primary_word_id', primaryWordId!);
  const { data } = await q;
  let rows = data ?? [];
  if (mustContainForms.length) rows = rows.filter((r: any) => sentenceHasWord(r.sentence_sv, mustContainForms));
  return rows.slice(0, NEEDED);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sort learned grammar points hardest/most-due first: due points first (by due
// date), then introduced-but-not-due points least-recently-touched first.
function byDueThenLeastRecent(today: string) {
  return (a: any, b: any) => {
    const aDue = (a.next_review_date ?? '9999') <= today ? 0 : 1;
    const bDue = (b.next_review_date ?? '9999') <= today ? 0 : 1;
    if (aDue !== bDue) return aDue - bDue;
    if (aDue === 0) return (a.next_review_date ?? '') < (b.next_review_date ?? '') ? -1 : 1;
    return (a.last_reviewed_at ?? '') < (b.last_reviewed_at ?? '') ? -1 : 1;
  };
}

function normSv(s: string): string {
  return (s ?? '').normalize('NFC').toLowerCase().replace(/[^a-zåäöé\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokensSv(s: string): string[] {
  return normSv(s).split(' ').filter(Boolean);
}

// Closed-class Swedish function words that may appear in a practice sentence
// even if they aren't in the learned-vocabulary list — the unavoidable glue
// (pronouns, articles, conjunctions, prepositions, negation, question words).
// Deliberately EXCLUDES content adverbs/quantifiers like "längre", "mycket",
// "också" so those must be genuinely learned before they can appear.
const FUNCTION_WORDS = new Set<string>([
  // pronouns
  'jag','du','han','hon','den','det','vi','ni','de','dem','mig','dig','honom','henne','oss','er','sig','man',
  // possessives / determiners
  'min','mitt','mina','din','ditt','dina','sin','sitt','sina','hans','hennes','dess','vår','vårt','våra','deras',
  'en','ett','denna','detta','dessa','någon','något','några','ingen','inget','inga','all','allt','alla','varje','sådan',
  // conjunctions / subjunctions
  'och','eller','men','att','som','för','så','om','fast','samt','medan','när','då','eftersom','innan','sedan',
  // prepositions
  'i','på','av','till','från','med','under','över','vid','hos','mot','efter','före','utan','genom','mellan','åt','ur','kring','bland','per','trots',
  // negation / yes-no / basic question words
  'inte','ej','icke','ja','nej','jo','var','vart','vem','vad','vilken','vilket','vilka','hur','varför',
]);

type LearnedContext = {
  // Which already-learned grammar/words/phrases a Swedish sentence uses.
  matcher: (referenceSv: string, grammarTitle: string | null) => Concepts;
  // True only if EVERY token is a learned word-form, a learned-phrase token, or
  // a closed-class function word — the strict "only learned material" gate.
  sentenceOk: (referenceSv: string) => boolean;
  // A pool of learned {lemma, pos} to seed generation prompts.
  wordPool: { lemma: string; pos: string | null }[];
};
type Concepts = { grammar: string[]; words: string[]; phrases: string[] };

// One DB round-trip that yields everything the strict practice/review flow needs:
// the concepts matcher, the deterministic "only learned material" validator, and
// a word pool for prompts. All matching is mechanical — no LLM guessing.
async function buildLearnedContext(
  supabase: ReturnType<typeof getServiceClient>,
): Promise<LearnedContext> {
  const [{ data: wp }, { data: ph }] = await Promise.all([
    supabase.from('user_progress').select('last_reviewed_at, words(lemma, pos, forms)').limit(2000),
    supabase.from('vocab_items').select('answer_sv').eq('introduced', true).eq('kind', 'phrase').limit(2000),
  ]);

  const formIndex = new Map<string, string>();   // single-token surface form → lemma
  const wordPool: { lemma: string; pos: string | null; last: string | null }[] = [];
  for (const row of wp ?? []) {
    const w = (row as any).words;
    if (!w?.lemma) continue;
    wordPool.push({ lemma: w.lemma, pos: w.pos ?? null, last: (row as any).last_reviewed_at ?? null });
    for (const f of wordForms(w)) if (!formIndex.has(f)) formIndex.set(f, w.lemma);
  }

  const phrases = [...new Set((ph ?? []).map((r: any) => String(r.answer_sv ?? '').trim()).filter(Boolean))]
    .map((text) => ({ text, norm: normSv(text) }))
    .filter((p) => p.norm.includes(' '));         // multi-word phrases only

  // Allowed tokens = learned word-forms ∪ learned-phrase component tokens ∪
  // function words. Anything else in a sentence means it uses unlearned material.
  const allowed = new Set<string>(FUNCTION_WORDS);
  for (const f of formIndex.keys()) allowed.add(f);
  for (const p of phrases) for (const t of p.norm.split(' ')) if (t) allowed.add(t);

  const matcher = (referenceSv: string, grammarTitle: string | null): Concepts => {
    const toks = new Set(tokensSv(referenceSv));
    const words: string[] = [];
    const seen = new Set<string>();
    for (const t of toks) {
      const lemma = formIndex.get(t);
      if (lemma && !seen.has(lemma)) { seen.add(lemma); words.push(lemma); }
    }
    const norm = normSv(referenceSv);
    const matchedPhrases = phrases.filter((p) => norm.includes(p.norm)).map((p) => p.text);
    return { grammar: grammarTitle ? [grammarTitle] : [], words, phrases: matchedPhrases };
  };

  const sentenceOk = (referenceSv: string): boolean => {
    const toks = tokensSv(referenceSv);
    return toks.length > 0 && toks.every((t) => allowed.has(t));
  };

  return {
    matcher, sentenceOk,
    wordPool: wordPool
      .sort((a, b) => (b.last ?? '').localeCompare(a.last ?? ''))   // recently practiced first
      .map(({ lemma, pos }) => ({ lemma, pos })),
  };
}

// Generate + cache k En->Sv construction sentences for one grammar point,
// constrained to already-learned vocabulary. `sentenceOk` deterministically
// rejects any generation that slipped in an unlearned word BEFORE it's cached,
// so the cache only ever holds sentences that pass the strict rule. Returns the
// inserted (valid) rows.
async function generateEnToSvSentences(
  supabase: ReturnType<typeof getServiceClient>,
  point: any, vocab: { lemma: string; pos: string | null }[], k: number,
  primaryWordId: string | null, sentenceOk: (sv: string) => boolean,
): Promise<any[]> {
  if (k <= 0) return [];
  const vocabList = vocab.map((w) => `${w.lemma}${w.pos ? ` (${w.pos})` : ''}`).join('; ');
  const prompt = `You are a Swedish tutor generating practice exercises.
The learner has ONLY learned these Swedish words: ${vocabList}
Grammar focus: "${point.title}" — ${point.description}
Generate exactly ${k} English→Swedish sentence(s) that naturally exercise the grammar focus. HARD CONSTRAINT: every Swedish word you use MUST be from the learned list above OR a basic closed-class function word (pronouns, en/ett, och, att, som, prepositions like i/på/med, inte, question words). Do NOT use any other content word (no unlisted nouns, verbs, adjectives or adverbs). Keep sentences simple A1/A2 and ORIGINAL (never copy any real text).
Return ONLY valid JSON, no markdown: { "en_to_sv": [{"sentence_en": "English prompt", "sentence_sv": "correct Swedish"}] }`;
  let gen: any = {};
  try { gen = JSON.parse(await callClaude(prompt)); } catch { return []; }
  const candidates = (gen.en_to_sv ?? [])
    .filter((s: any) => s?.sentence_en && s?.sentence_sv);
  const valid = candidates.filter((s: any) => sentenceOk(s.sentence_sv));
  const dropped = candidates.length - valid.length;
  if (dropped > 0) console.warn(`[lesson/generate] dropped ${dropped}/${candidates.length} generated sentence(s) using unlearned words (point="${point.title}")`);
  const rows = valid.slice(0, k).map((s: any) => ({
    grammar_point_id: point.id, primary_word_id: primaryWordId,
    direction: 'en_to_sv', sentence_en: s.sentence_en, sentence_sv: s.sentence_sv,
  }));
  if (!rows.length) return [];
  const { data } = await supabase.from('generated_sentences').insert(rows).select();
  return data ?? [];
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: Mode = (['daily', 'extra', 'learn', 'targeted', 'words', 'grammar', 'practice'] as const).includes(body.mode)
    ? body.mode : 'daily';

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const now   = new Date().toISOString();

  let vocab: any[]       = [];
  let grammarPoint: any  = null;

  // ── PRACTICE (grammar) ────────────────────────────────────────────────────
  // No new concepts. 10 sentence constructions (En->Sv) drawn strictly from
  // grammar points AND vocabulary already learned, spanning several points.
  // The client offers an "end after 6" stop. Every question shows which learned
  // concepts/phrases it used.
  if (mode === 'practice') {
    const PRACTICE_TARGET = 10;
    const MAX_POINTS = 6;

    const { data: gpRows } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, next_review_date, last_reviewed_at, grammar_points(*)')
      .limit(200);
    const points = (gpRows ?? [])
      .filter((r: any) => r.grammar_points)
      .sort(byDueThenLeastRecent(today))
      .slice(0, MAX_POINTS)
      .map((r: any) => r.grammar_points);
    if (!points.length) return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });

    const { data: ctx } = await supabase.from('user_progress')
      .select('word_id, words(*)')
      .order('last_reviewed_at', { ascending: false, nullsFirst: false })
      .limit(12);
    const practiceVocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
    const primaryWordId = practiceVocab[0]?.id ?? null;

    // Learned-material gate: matcher + sentenceOk validator + a word pool for
    // prompts. Sentences (cached OR freshly generated) must pass sentenceOk, so
    // the strict "only learned words/phrases" rule holds regardless of the LLM.
    const { matcher, sentenceOk, wordPool } = await buildLearnedContext(supabase);
    const promptVocab = wordPool.slice(0, 60);

    const perPoint = Math.max(2, Math.ceil(PRACTICE_TARGET / points.length));
    const collected: { row: any; point: any }[] = [];
    for (const pt of points) {
      if (collected.length >= PRACTICE_TARGET) break;
      // Pull a wide cached pool and keep only sentences that still obey the rule
      // (old caches from other flows may use words not yet learned).
      const { data: cached } = await supabase
        .from('generated_sentences').select('*')
        .eq('direction', 'en_to_sv').eq('is_excluded', false).eq('grammar_point_id', pt.id)
        .lt('times_correct', 4)
        .order('last_shown_at', { ascending: true, nullsFirst: true })
        .limit(30);
      const rows: any[] = (cached ?? []).filter((r: any) => sentenceOk(r.sentence_sv)).slice(0, perPoint);
      // Top up by generating (bounded retries) — only valid ones get cached.
      let attempts = 0;
      while (rows.length < perPoint && attempts < 3) {
        attempts++;
        const gen = await generateEnToSvSentences(supabase, pt, promptVocab, (perPoint - rows.length) + 2, primaryWordId, sentenceOk);
        if (!gen.length) break;
        rows.push(...gen.slice(0, perPoint - rows.length));
      }
      for (const row of rows) collected.push({ row, point: pt });
    }
    const chosen = shuffle(collected).slice(0, PRACTICE_TARGET);
    if (!chosen.length) return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    if (chosen.length < PRACTICE_TARGET) {
      console.warn(`[lesson/generate] practice served ${chosen.length}/${PRACTICE_TARGET} sentences — not enough learned material for a full set yet`);
    }

    for (const c of chosen) {
      await supabase.from('generated_sentences')
        .update({ times_shown: (c.row.times_shown ?? 0) + 1, last_shown_at: now })
        .eq('id', c.row.id);
    }

    const en_to_sv = chosen.map((c) => ({
      sentence_id: c.row.id,
      prompt: c.row.sentence_en,
      reference: c.row.sentence_sv,
      grammarPointId: c.point.id,
      grammarTitle: c.point.title,
      isReview: false,
      conceptsUsed: matcher(c.row.sentence_sv, c.point.title),
    }));

    return NextResponse.json({
      vocab: practiceVocab, grammarPoint: null, mode,
      exercises: { en_to_sv, sv_to_en: [] },
      grammarFocused: true,
    });
  }

  // ── DAILY ────────────────────────────────────────────────────────────────
  if (mode === 'daily' || mode === 'extra') {
    const dueQ = supabase.from('user_progress').select('word_id, words(*)').order('next_review_date').limit(15);
    const { data: rawDue } = mode === 'extra'
      ? await dueQ
      : await dueQ.lte('next_review_date', today);
    // Curriculum words take priority; sort is stable so within-source order (by date) is preserved
    const dueProgress = (rawDue ?? [])
      .sort((a: any, b: any) =>
        (a.words?.source === 'curriculum' ? 0 : 1) - (b.words?.source === 'curriculum' ? 0 : 1)
      )
      .slice(0, 5);
    const existingIds = dueProgress.map((p: any) => p.word_id);

    let newWords: any[] = [];
    if (mode === 'daily') {
      let nq = supabase.from('words').select('*').order('rank').limit(3 + existingIds.length);
      if (existingIds.length) nq = nq.not('id', 'in', `(${existingIds.join(',')})`);
      const { data: cands } = await nq;
      newWords = (cands ?? []).filter((w: any) => !existingIds.includes(w.id)).slice(0, 3);
      if (newWords.length) {
        await supabase.from('user_progress').insert(
          newWords.map((w: any) => ({ word_id: w.id, status: 'learning', next_review_date: today })),
        );
      }
    }

    // Grammar — due first, then introduce next by sequence_order (daily only)
    const { data: dueGrammar } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, grammar_points(*)')
      .lte('next_review_date', mode === 'extra' ? '9999-12-31' : today)
      .order('next_review_date')
      .limit(1);
    grammarPoint = dueGrammar?.[0] ? (dueGrammar[0] as any).grammar_points : null;

    if (!grammarPoint && mode === 'daily') {
      const { data: started } = await supabase.from('user_grammar_progress').select('grammar_point_id');
      const startedIds = (started ?? []).map((s: any) => s.grammar_point_id);
      let gq = supabase.from('grammar_points').select('*').order('sequence_order').limit(1);
      if (startedIds.length) gq = gq.not('id', 'in', `(${startedIds.join(',')})`);
      const { data: cands } = await gq;
      grammarPoint = cands?.[0] ?? null;
      if (grammarPoint) {
        await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
      }
    }

    vocab = [...(dueProgress ?? []).map((p: any) => p.words), ...newWords];
  }

  // ── LEARN (introduce the next new grammar point) ─────────────────────────
  // Vocabulary is now learned in the dedicated /vocab flow, so "learn" is purely
  // about unlocking the next grammar structure. It's drilled with words already
  // in rotation so the practice sentences have familiar material.
  if (mode === 'learn') {
    const { data: startedGp } = await supabase.from('user_grammar_progress').select('grammar_point_id');
    const startedGpIds = (startedGp ?? []).map((s: any) => s.grammar_point_id);
    let gq = supabase.from('grammar_points').select('*').order('sequence_order').limit(1);
    if (startedGpIds.length) gq = gq.not('id', 'in', `(${startedGpIds.join(',')})`);
    const { data: gpCands } = await gq;
    grammarPoint = gpCands?.[0] ?? null;

    if (grammarPoint) {
      await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(3);
      vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
    }
    // else: no new grammar left → nothing_to_practice guard handles it
  }

  // ── TARGETED (specific word or grammar, SRS graded normally) ────────────
  if (mode === 'targeted') {
    const { wordId, grammarId: targetGrammarId } = body;

    if (wordId) {
      const { data: word } = await supabase.from('words').select('*').eq('id', wordId).single();
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .neq('word_id', wordId)
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(2);
      vocab = [word, ...(ctx ?? []).map((p: any) => p.words).filter(Boolean)];

      const { data: gProg } = await supabase.from('user_grammar_progress')
        .select('grammar_point_id, grammar_points(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(1);
      grammarPoint = gProg?.[0] ? (gProg[0] as any).grammar_points : null;
    } else if (targetGrammarId) {
      const { data: gp } = await supabase.from('grammar_points').select('*').eq('id', targetGrammarId).single();
      grammarPoint = gp ?? null;
      const { data: ctx } = await supabase.from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: false, nullsFirst: false })
        .limit(3);
      vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
    }
  }

  // ── WORDS (vocabulary only — no grammar focus, already-learned grammar) ──
  if (mode === 'words') {
    const WORDS_TARGET = 6;
    // SRS-due words first
    const { data: rawDue } = await supabase
      .from('user_progress')
      .select('word_id, words(*)')
      .lte('next_review_date', today)
      .order('next_review_date')
      .limit(15);
    // Curriculum words take priority; stable sort preserves date order within source
    let picked = (rawDue ?? [])
      .sort((a: any, b: any) =>
        (a.words?.source === 'curriculum' ? 0 : 1) - (b.words?.source === 'curriculum' ? 0 : 1)
      )
      .slice(0, WORDS_TARGET);

    // If nothing (or little) is due, top up with already-started words practiced
    // least recently — practice never introduces brand-new words.
    if (picked.length < WORDS_TARGET) {
      const pickedIds = picked.map((p: any) => p.word_id);
      let tq = supabase
        .from('user_progress')
        .select('word_id, words(*)')
        .order('last_reviewed_at', { ascending: true, nullsFirst: true })
        .limit(WORDS_TARGET + pickedIds.length);
      if (pickedIds.length) tq = tq.not('word_id', 'in', `(${pickedIds.join(',')})`);
      const { data: extra } = await tq;
      picked = [...picked, ...(extra ?? [])].slice(0, WORDS_TARGET);
    }

    vocab = picked.map((p: any) => p.words).filter(Boolean);
    // grammarPoint stays null — sentences reuse already-learned grammar
  }

  // ── GRAMMAR (drill an already-introduced point; vocabulary incidental) ───
  // New grammar is unlocked only through the paced "learn" flow, so this mode
  // never races ahead — it re-practices points you've already met.
  if (mode === 'grammar') {
    // Due grammar first…
    const { data: dueGrammar } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, grammar_points(*)')
      .lte('next_review_date', today)
      .order('next_review_date')
      .limit(1);
    grammarPoint = dueGrammar?.[0] ? (dueGrammar[0] as any).grammar_points : null;

    // …otherwise re-practice the introduced point touched least recently.
    // (No fallback to brand-new points — new grammar only comes from "learn".)
    if (!grammarPoint) {
      const { data: anyGrammar } = await supabase
        .from('user_grammar_progress')
        .select('grammar_point_id, grammar_points(*)')
        .order('last_reviewed_at', { ascending: true, nullsFirst: true })
        .limit(1);
      grammarPoint = anyGrammar?.[0] ? (anyGrammar[0] as any).grammar_points : null;
    }

    // Recently-practiced words give the sentences natural material
    const { data: ctx } = await supabase
      .from('user_progress')
      .select('word_id, words(*)')
      .order('last_reviewed_at', { ascending: false, nullsFirst: false })
      .limit(3);
    vocab = (ctx ?? []).map((p: any) => p.words).filter(Boolean);
  }

  if (!vocab.length && !grammarPoint) {
    return NextResponse.json({ error: 'nothing_to_practice' }, { status: 400 });
  }

  // ── SENTENCE CACHE ───────────────────────────────────────────────────────
  const grammarId: string | null = grammarPoint?.id ?? null;
  // For targeted-word sessions, cache by the target word, not the context grammar
  const primaryWordId: string | null = (mode === 'targeted' && body.wordId)
    ? body.wordId
    : (vocab[0]?.id ?? null);

  const cacheGrammarId = (mode === 'targeted' && body.wordId) ? null : grammarId;

  // Targeted-word practice: the focus word must appear in every sentence.
  const targetWord = (mode === 'targeted' && body.wordId)
    ? (vocab.find((w: any) => w?.id === body.wordId) ?? null)
    : null;
  const targetForms = targetWord ? wordForms(targetWord) : [];

  const [cachedEnToSv, cachedSvToEn] = await Promise.all([
    fetchCached(supabase, 'en_to_sv', cacheGrammarId, primaryWordId, targetForms),
    fetchCached(supabase, 'sv_to_en', cacheGrammarId, primaryWordId, targetForms),
  ]);

  const enToSvNeeded = NEEDED - cachedEnToSv.length;
  const svToEnNeeded = NEEDED - cachedSvToEn.length;

  let newEnToSv: any[] = [];
  let newSvToEn: any[] = [];

  if (enToSvNeeded > 0 || svToEnNeeded > 0) {
    const vocabList = vocab.map((w: any) => `${w.lemma} (${w.pos}, "${w.example_en}")`).join('; ');
    const hasGrammarFocus = !!grammarPoint;
    const grammarTitle = grammarPoint?.title ?? '';
    const grammarDesc  = grammarPoint?.description ?? '';

    // For targeted-word practice, the word must appear in EVERY sentence.
    const requireWord = targetWord
      ? ` Crucially, EVERY sentence MUST naturally contain the Swedish word "${targetWord.lemma}" (an inflected form of it is fine) — it is the focus word being drilled.`
      : '';

    const parts: string[] = [];
    const outKeys: string[] = [];
    if (enToSvNeeded > 0) {
      parts.push((targetWord
        ? `Generate exactly ${enToSvNeeded} English→Swedish sentence(s) using simple, already-learned grammar; draw only from the listed vocabulary plus basic function words.`
        : hasGrammarFocus
          ? `Generate exactly ${enToSvNeeded} English→Swedish sentence(s): naturally exercise the grammar focus, draw only from the listed vocabulary plus basic function words.`
          : `Generate exactly ${enToSvNeeded} English→Swedish sentence(s): naturally use the listed target vocabulary in everyday sentences. Use ONLY simple grammar the learner has already met — do not introduce or explain any new grammar structure. Draw only from the listed vocabulary plus basic function words.`)
        + requireWord);
      outKeys.push(`"en_to_sv": [{"sentence_en": "English prompt", "sentence_sv": "correct Swedish"}]`);
    }
    if (svToEnNeeded > 0) {
      parts.push(`Generate exactly ${svToEnNeeded} Swedish→English sentence(s): ORIGINAL simple A1/A2 Swedish. NEVER copy from any real book or identifiable text — hard copyright constraint.` + requireWord);
      outKeys.push(`"sv_to_en": [{"sentence_sv": "Swedish prompt", "sentence_en": "correct English"}]`);
    }

    const focusLine = targetWord
      ? `Focus word to drill in EVERY sentence, both directions: "${targetWord.lemma}". Keep grammar simple and already-learned.`
      : hasGrammarFocus
        ? `Grammar focus: "${grammarTitle}" — ${grammarDesc}`
        : `Focus: drilling the listed vocabulary. Keep every sentence within basic, already-learned grammar — do not introduce any new grammar structure.`;

    const prompt = `You are a Swedish tutor generating practice exercises.
Learner vocabulary: ${vocabList}
${focusLine}
${parts.join('\n')}
Return ONLY valid JSON, no markdown: { ${outKeys.join(', ')} }`;

    let generated: any = {};
    try {
      generated = JSON.parse(await callClaude(prompt));
    } catch {
      if (!cachedEnToSv.length && !cachedSvToEn.length)
        return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
    }

    // Drop any generated sentence that ignored the focus-word requirement.
    const keepsWord = (s: any) => sentenceHasWord(s?.sentence_sv, targetForms);
    const genEnToSv = (generated.en_to_sv ?? []).filter(keepsWord);
    const genSvToEn = (generated.sv_to_en ?? []).filter(keepsWord);

    const toInsert = [
      ...genEnToSv.slice(0, enToSvNeeded).map((s: any) => ({
        grammar_point_id: cacheGrammarId,
        primary_word_id:  primaryWordId,
        direction: 'en_to_sv',
        sentence_sv: s.sentence_sv,
        sentence_en: s.sentence_en,
      })),
      ...genSvToEn.slice(0, svToEnNeeded).map((s: any) => ({
        grammar_point_id: cacheGrammarId,
        primary_word_id:  primaryWordId,
        direction: 'sv_to_en',
        sentence_sv: s.sentence_sv,
        sentence_en: s.sentence_en,
      })),
    ].filter((r) => r.sentence_sv && r.sentence_en);

    if (toInsert.length) {
      const { data: inserted } = await supabase.from('generated_sentences').insert(toInsert).select();
      const rows = inserted ?? [];
      newEnToSv = rows.filter((r: any) => r.direction === 'en_to_sv');
      newSvToEn = rows.filter((r: any) => r.direction === 'sv_to_en');
    }
  }

  // Mark reused cached sentences as shown
  for (const row of [...cachedEnToSv, ...cachedSvToEn]) {
    await supabase
      .from('generated_sentences')
      .update({ times_shown: row.times_shown + 1, last_shown_at: now })
      .eq('id', row.id);
  }

  // Every exercise carries its own grammar attribution so the client grades it
  // against the right point (learn sessions mix the new point with older review
  // sentences from a different point). isReview / conceptsUsed drive the
  // "which learned concepts were used" panel (see below); they're null here for
  // the session's main grammar point and populated only on review sentences.
  const exercises: any = {
    en_to_sv: [...cachedEnToSv, ...newEnToSv].slice(0, NEEDED).map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_en,
      reference:   r.sentence_sv,
      grammarPointId: grammarPoint?.id ?? null,
      grammarTitle:   grammarPoint?.title ?? null,
      isReview: false,
      conceptsUsed: null,
    })),
    sv_to_en: [...cachedSvToEn, ...newSvToEn].slice(0, NEEDED).map((r: any) => ({
      sentence_id: r.id,
      prompt:      r.sentence_sv,
      reference:   r.sentence_en,
      grammarPointId: grammarPoint?.id ?? null,
      grammarTitle:   grammarPoint?.title ?? null,
      isReview: false,
      conceptsUsed: null,
    })),
  };

  // ── LEARN: a small review portion. Alongside the newly-unlocked point, drill
  //    1–2 En->Sv sentences from an OLDER learned point (due first, else least
  //    recently touched). These review questions get the concepts-used panel. ─
  if (mode === 'learn' && grammarPoint) {
    const REVIEW_N = 2;
    const { data: revRows } = await supabase
      .from('user_grammar_progress')
      .select('grammar_point_id, next_review_date, last_reviewed_at, grammar_points(*)')
      .neq('grammar_point_id', grammarPoint.id)
      .limit(200);
    const revPoint: any = (revRows ?? [])
      .filter((r: any) => r.grammar_points)
      .sort(byDueThenLeastRecent(today))[0]?.grammar_points ?? null;

    if (revPoint) {
      // Review sentences must obey the same strict "only learned material" rule.
      const { matcher, sentenceOk, wordPool } = await buildLearnedContext(supabase);
      const { data: cached } = await supabase
        .from('generated_sentences').select('*')
        .eq('direction', 'en_to_sv').eq('is_excluded', false).eq('grammar_point_id', revPoint.id)
        .lt('times_correct', 4)
        .order('last_shown_at', { ascending: true, nullsFirst: true })
        .limit(30);
      const rows: any[] = (cached ?? []).filter((r: any) => sentenceOk(r.sentence_sv)).slice(0, REVIEW_N);
      let attempts = 0;
      while (rows.length < REVIEW_N && attempts < 3) {
        attempts++;
        const gen = await generateEnToSvSentences(supabase, revPoint, wordPool.slice(0, 60), (REVIEW_N - rows.length) + 1, primaryWordId, sentenceOk);
        if (!gen.length) break;
        rows.push(...gen.slice(0, REVIEW_N - rows.length));
      }
      if (rows.length) {
        for (const r of rows) {
          await supabase.from('generated_sentences')
            .update({ times_shown: (r.times_shown ?? 0) + 1, last_shown_at: now }).eq('id', r.id);
        }
        for (const r of rows) {
          exercises.en_to_sv.push({
            sentence_id: r.id, prompt: r.sentence_en, reference: r.sentence_sv,
            grammarPointId: revPoint.id, grammarTitle: revPoint.title,
            isReview: true, conceptsUsed: matcher(r.sentence_sv, revPoint.title),
          });
        }
      }
    }
  }

  // Grammar-focused sets get the En->Sv tense-priming study aid. Word-drill
  // sessions (vocab-only, and targeted-word where grammar is only incidental
  // context) stay plain. Mirrors cacheGrammarId: en_to_sv sentences saved with a
  // grammar_point_id are exactly the ones eligible for variants.
  const grammarFocused = !!cacheGrammarId;

  return NextResponse.json({ vocab, grammarPoint, exercises, mode, grammarFocused });
}
