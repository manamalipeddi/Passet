import { NextResponse } from 'next/server';
import { callClaude } from '@/lib/anthropic';

// Literal English gloss of whatever Swedish the learner typed in a listening
// exercise — so a wrong transcription shows what THEY actually wrote means,
// not a verbatim echo. Translate exactly, don't silently correct it.
export async function POST(req: Request) {
  const { text } = await req.json().catch(() => ({}));
  const t = (text ?? '').trim();
  if (!t) return NextResponse.json({ gloss: null });

  const prompt = `Translate this Swedish text literally into English — word-for-word if needed. Do NOT correct or improve it; translate exactly what is written, even if it is grammatically off, misspelled, or not a complete sentence. If it isn't recognizable Swedish at all, give your best literal reading.
Swedish: "${t}"
Return ONLY valid JSON, no markdown: {"gloss": "the literal English meaning"}`;

  try {
    const result = JSON.parse(await callClaude(prompt, 200));
    const gloss = typeof result.gloss === 'string' && result.gloss.trim() ? result.gloss.trim() : null;
    return NextResponse.json({ gloss });
  } catch {
    return NextResponse.json({ gloss: null });
  }
}
