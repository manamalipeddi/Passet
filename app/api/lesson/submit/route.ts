import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaude } from '@/lib/anthropic';
import { updateSrs } from '@/lib/srs';

export async function POST(req: Request) {
  const { direction, prompt, reference, userAnswer, wordIds = [], grammarPointId, grammarTitle } = await req.json();
  const supabase = getServiceClient();

  const evalPrompt = `You are an encouraging Swedish tutor. The learner was asked to translate ${direction === 'en_to_sv' ? 'this English sentence into Swedish' : 'this Swedish sentence into English'}: "${prompt}".
A reference correct answer is: "${reference}".
The learner wrote: "${userAnswer}".
The grammar point being practiced is: "${grammarTitle || 'general'}".

Judge their answer on meaning and correctness, not just an exact string match against the reference (other valid phrasings are fine). Return ONLY valid JSON, no markdown, no extra text:
{"correct": true or false, "feedback": "one or two encouraging sentences explaining what was right or wrong, tied to the grammar point where relevant", "corrected": "a corrected or improved version of their answer"}`;

  let result;
  try {
    result = JSON.parse(await callClaude(evalPrompt));
  } catch (e) {
    return NextResponse.json({ error: 'evaluation_failed' }, { status: 502 });
  }

  // Update SRS for each word involved
  for (const wordId of wordIds) {
    const { data: prog } = await supabase.from('user_progress').select('*').eq('word_id', wordId).single();
    if (prog) {
      const updated = updateSrs(prog, result.correct);
      await supabase
        .from('user_progress')
        .update({
          ...updated,
          status: updated.interval_days > 10 ? 'known' : 'learning',
          last_reviewed_at: new Date().toISOString(),
          times_correct: prog.times_correct + (result.correct ? 1 : 0),
          times_wrong: prog.times_wrong + (result.correct ? 0 : 1),
        })
        .eq('word_id', wordId);
    }
  }

  // Update SRS for the grammar point
  if (grammarPointId) {
    const { data: gprog } = await supabase.from('user_grammar_progress').select('*').eq('grammar_point_id', grammarPointId).single();
    if (gprog) {
      const updated = updateSrs(gprog, result.correct);
      await supabase
        .from('user_grammar_progress')
        .update({
          ...updated,
          status: updated.interval_days > 10 ? 'known' : 'learning',
          last_reviewed_at: new Date().toISOString(),
          times_correct: gprog.times_correct + (result.correct ? 1 : 0),
          times_wrong: gprog.times_wrong + (result.correct ? 0 : 1),
        })
        .eq('grammar_point_id', grammarPointId);
    }
  }

  await supabase.from('attempts').insert({
    direction,
    prompt_text: prompt,
    target_text: reference,
    user_answer: userAnswer,
    is_correct: result.correct,
    explanation: result.feedback,
    word_ids: wordIds,
    grammar_point_ids: grammarPointId ? [grammarPointId] : [],
  });

  return NextResponse.json(result);
}
