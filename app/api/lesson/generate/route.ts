import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const mode: 'daily' | 'extra' = body.mode === 'extra' ? 'extra' : 'daily';

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Words to review: due ones first, regardless of mode
  const dueQuery = supabase.from('user_progress').select('word_id, words(*)').order('next_review_date').limit(5);
  const { data: dueProgress } = mode === 'extra'
    ? await dueQuery // extra mode pulls from everything already introduced, due or not
    : await dueQuery.lte('next_review_date', today);

  const existingIds = (dueProgress || []).map((p: any) => p.word_id);

  // 2. New words to introduce — only in daily mode. Extra practice never introduces new material,
  // so a burst of bonus sessions in one day can't blow past the deliberate pacing.
  let newWords: any[] = [];
  if (mode === 'daily') {
    let newWordsQuery = supabase.from('words').select('*').order('rank').limit(3 + existingIds.length);
    if (existingIds.length) newWordsQuery = newWordsQuery.not('id', 'in', `(${existingIds.join(',')})`);
    const { data: candidateNew } = await newWordsQuery;
    newWords = (candidateNew || []).filter((w: any) => !existingIds.includes(w.id)).slice(0, 3);

    if (newWords.length) {
      await supabase.from('user_progress').insert(
        newWords.map((w: any) => ({ word_id: w.id, status: 'learning', next_review_date: today }))
      );
    }
  }

  // 3. Grammar point: due for review; only daily mode is allowed to introduce a brand new one
  const { data: dueGrammar } = await supabase
    .from('user_grammar_progress')
    .select('grammar_point_id, grammar_points(*)')
    .lte('next_review_date', mode === 'extra' ? '9999-12-31' : today)
    .order('next_review_date')
    .limit(1);

  let grammarPoint = dueGrammar && dueGrammar[0] ? (dueGrammar[0] as any).grammar_points : null;

  if (!grammarPoint && mode === 'daily') {
    const { data: started } = await supabase.from('user_grammar_progress').select('grammar_point_id');
    const startedIds = (started || []).map((s: any) => s.grammar_point_id);
    let gq = supabase.from('grammar_points').select('*').order('weight', { ascending: false }).limit(1 + startedIds.length);
    if (startedIds.length) gq = gq.not('id', 'in', `(${startedIds.join(',')})`);
    const { data: candidates } = await gq;
    grammarPoint = (candidates || []).find((g: any) => !startedIds.includes(g.id)) || null;
    if (grammarPoint) {
      await supabase.from('user_grammar_progress').insert({ grammar_point_id: grammarPoint.id, next_review_date: today });
    }
  }

  const vocab = [...(dueProgress || []).map((p: any) => p.words), ...newWords];

  const prompt = `You are a Swedish tutor. The learner knows these words: ${vocab.map((w: any) => `${w.lemma} (${w.pos}, "${w.example_en}")`).join('; ')}.

Today's grammar focus is: "${grammarPoint?.title || 'general review'}" — ${grammarPoint?.description || ''}

Create exactly 3 English sentences for the learner to translate INTO Swedish, each one naturally exercising today's grammar focus using only the words listed above (plus basic function words already needed for any beginner sentence). Also create exactly 3 ORIGINAL simple Swedish sentences, in the plain, repetitive style of a toddler's picture book, for the learner to translate INTO English — these must be original content you write yourself, never copied or adapted from any real, identifiable book. Provide the correct Swedish translation for the first set and the correct English translation for the second set, for later grading reference.

Return ONLY valid JSON, no markdown, no extra text:
{"en_to_sv": [{"prompt": "English sentence", "reference": "correct Swedish translation"}], "sv_to_en": [{"prompt": "Swedish sentence", "reference": "correct English translation"}]}`;

  let exercises;
  try {
    exercises = JSON.parse(await callClaude(prompt));
  } catch (e) {
    return NextResponse.json({ error: 'generation_failed' }, { status: 502 });
  }

  return NextResponse.json({ vocab, grammarPoint, exercises, mode });
}
