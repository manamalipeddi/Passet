import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';

// Records one listening (dictation) attempt and, on a miss, returns a literal
// English gloss of what the learner actually wrote (so the feedback isn't a
// verbatim echo). Attempts are tagged direction='listen' so they form their own
// accuracy track, separate from vocab and grammar.
export async function POST(req: Request) {
  const { sentenceId, userAnswer, sentenceSv, sentenceEn, correct } = await req.json().catch(() => ({}));
  const supabase = getServiceClient();
  const ua = (userAnswer ?? '').trim();

  // Non-SRS retirement: two correct in a row retires the sentence; a miss resets.
  if (sentenceId) {
    const { data: s } = await supabase
      .from('listening_sentences').select('correct_streak').eq('id', sentenceId).maybeSingle();
    if (s) {
      await supabase.from('listening_sentences')
        .update({ correct_streak: correct ? (s.correct_streak ?? 0) + 1 : 0 })
        .eq('id', sentenceId);
    }
  }

  const { error: insErr } = await supabase.from('attempts').insert({
    direction: 'listen',
    prompt_text: sentenceSv ?? '',
    target_text: sentenceSv ?? '',
    user_answer: ua,
    is_correct: !!correct,
    explanation: sentenceEn ?? '',
    word_ids: [],
    grammar_point_ids: [],
  });
  if (insErr) console.error('[listen/answer] failed to record attempt:', insErr.message);

  if (correct || !ua) return NextResponse.json({ gloss: null });

  const prompt = `Translate this Swedish text literally into English — word-for-word if needed. Do NOT correct or improve it; translate exactly what is written, even if it is grammatically off, misspelled, or not a complete sentence. If it isn't recognizable Swedish at all, give your best literal reading.
Swedish: "${ua}"
Return ONLY valid JSON, no markdown: {"gloss": "the literal English meaning"}`;
  try {
    const result = JSON.parse(await callClaude(prompt, 200));
    const gloss = typeof result.gloss === 'string' && result.gloss.trim() ? result.gloss.trim() : null;
    return NextResponse.json({ gloss });
  } catch {
    return NextResponse.json({ gloss: null });
  }
}
