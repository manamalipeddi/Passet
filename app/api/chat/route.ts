import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { callClaudeChat } from '@/lib/anthropic';

export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({}));
  if (!message?.trim()) return NextResponse.json({ error: 'missing message' }, { status: 400 });

  const supabase = getServiceClient();

  const [
    { data: gpRows },
    { count: wordCount },
    { data: history },
  ] = await Promise.all([
    supabase.from('user_grammar_progress').select('grammar_points(title, cefr_level)'),
    supabase.from('user_progress').select('*', { count: 'exact', head: true }),
    supabase
      .from('chat_messages')
      .select('role, content')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const gpList = (gpRows ?? [])
    .map((r: any) => r.grammar_points)
    .filter(Boolean)
    .map((gp: any) => `${gp.title} (${gp.cefr_level})`)
    .join(', ');

  const systemPrompt = `You are a Swedish language tutor for a single student named Manasa, who is at approximately A1–A2 level. Your only job is to answer her questions about Swedish grammar and vocabulary. Do not act as a general assistant. Do not discuss anything unrelated to Swedish. Keep answers concise: one rule, 2–3 examples, done. Use words she has already learned where possible. Always include English translations in brackets after Swedish examples. If she asks about a word or phrase, explain its meaning, part of speech, and show it in a sentence. If her question is outside Swedish language learning, redirect her back to Swedish. When you mention a specific Swedish word that might be new to her, include it in your response wrapped in a special marker like: ADDWORD[fortfarande] — one marker per new word, only for words that are genuinely worth adding to her vocabulary list.

Student context:
- Words in practice queue: ${wordCount ?? 0}
- Grammar points introduced: ${gpList || 'none yet'}`;

  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...(history ?? []).reverse().map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: message },
  ];

  let rawReply: string;
  try {
    rawReply = await callClaudeChat(systemPrompt, conversationHistory, 1024);
  } catch {
    return NextResponse.json({ error: 'tutor_unavailable' }, { status: 502 });
  }

  // Extract ADDWORD markers, then strip them from the displayed reply
  const suggestedWords: string[] = [];
  const matchRe = /ADDWORD\[([^\]]+)\]/g;
  let m;
  while ((m = matchRe.exec(rawReply)) !== null) {
    suggestedWords.push(m[1].trim());
  }
  const reply = rawReply
    .replace(/ADDWORD\[[^\]]+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Persist both turns together
  await supabase.from('chat_messages').insert([
    { role: 'user',      content: message },
    { role: 'assistant', content: reply   },
  ]);

  return NextResponse.json({ reply, suggestedWords });
}
