import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

// Lazily generate (and cache forever) the enrichment for a single word:
// up to 5 example uses with translations + one memorable note. Kept to one word
// per call so it returns in a few seconds — the client prefetches it per word
// while the learner is reading, so it's ready by the time it's shown. Once cached
// on words.enrichment, later calls return instantly from the database.

export async function POST(req: Request) {
  const { wordId } = await req.json().catch(() => ({}));
  if (!wordId) return NextResponse.json({ error: 'missing_word' }, { status: 400 });

  const supabase = getServiceClient();
  const { data: word } = await supabase
    .from('words')
    .select('id, lemma, pos, gender, translation, enrichment')
    .eq('id', wordId)
    .single();
  if (!word) return NextResponse.json({ error: 'word_not_found' }, { status: 404 });

  // Already cached — hand it straight back.
  if (word.enrichment) return NextResponse.json({ enrichment: word.enrichment });

  const prompt = `You are a Swedish tutor helping a learner memorise vocabulary fast.
For the Swedish word "${word.lemma}" (${word.pos ?? 'word'}${word.gender ? `, ${word.gender}` : ''}), meaning "${word.translation ?? ''}", produce:
- "uses": up to 5 short, natural example sentences or common phrases USING the word, each with its English translation. Keep them A1/A2 simple and everyday; vary the inflected forms where natural.
- "note": one short, memorable or interesting fact about the word (a mnemonic, a false-friend warning, a cultural note, a cognate link, etc.) that helps it stick in memory.

Return ONLY valid JSON, no markdown:
{"uses": [{"sv": "...", "en": "..."}], "note": "..."}`;

  let enrichment: { uses: { sv: string; en: string }[]; note: string } | null = null;
  try {
    // Haiku: fast + cheap, plenty for example sentences and a memory note.
    const e = JSON.parse(await callClaude(prompt, 700, 'claude-haiku-4-5-20251001'));
    const uses = Array.isArray(e?.uses)
      ? e.uses.filter((u: any) => u?.sv && u?.en).slice(0, 5).map((u: any) => ({ sv: String(u.sv), en: String(u.en) }))
      : [];
    const note = typeof e?.note === 'string' ? e.note : '';
    if (uses.length || note) enrichment = { uses, note };
  } catch (err) {
    console.error('[vocab/enrich] generation failed for', word.lemma, err);
  }

  if (enrichment) await supabase.from('words').update({ enrichment }).eq('id', wordId);

  return NextResponse.json({ enrichment });
}
