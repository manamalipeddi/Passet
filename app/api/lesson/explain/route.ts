import { NextResponse } from 'next/server';
import { callClaude } from '@/lib/anthropic';

export async function POST(req: Request) {
  const { direction, prompt, reference, userAnswer, grammarTitle, grammarDescription } =
    await req.json().catch(() => ({}));
  if (!prompt || !reference) return NextResponse.json({ error: 'missing_fields' }, { status: 400 });

  const dirText = direction === 'sv_to_en' ? 'Swedish → English' : 'English → Swedish';
  const grammarLine = grammarTitle
    ? `The grammar focus is "${grammarTitle}"${grammarDescription ? ` — ${grammarDescription}` : ''}.`
    : 'There is no single named grammar focus — explain whatever structure the sentence uses.';

  const p = `You are a warm, encouraging Swedish tutor for a beginner (A1–A2 level).
She just did this translation exercise (${dirText}):
- Prompt shown: "${prompt}"
- Correct answer: "${reference}"
- What she wrote: "${userAnswer || '(left blank)'}"
${grammarLine}

Re-explain the key grammar at work here in the simplest possible plain English — short, friendly, the way you'd explain to a beginner who found it confusing. Then give 2–3 NEW simple example sentences that follow the same pattern, each written as Swedish followed by the English translation in brackets. Keep it concise. Plain text only — no markdown headings.`;

  try {
    const explanation = await callClaude(p, 700);
    return NextResponse.json({ explanation });
  } catch {
    return NextResponse.json({ error: 'explain_failed' }, { status: 502 });
  }
}
