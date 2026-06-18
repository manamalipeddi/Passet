import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'missing body' }, { status: 400 });

  const supabase = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Fast-track: word already exists in the DB, just queue it and re-source to user_added
  // so it appears in "words I've heard" in the Learned tab.
  if (body.word_id) {
    await supabase.from('words').update({ source: 'user_added' }).eq('id', body.word_id);

    await supabase.from('user_progress').upsert(
      { word_id: body.word_id, status: 'learning', next_review_date: today },
      { onConflict: 'word_id' },
    );

    const { data: word } = await supabase.from('words').select('*').eq('id', body.word_id).single();
    return NextResponse.json({ word });
  }

  // New word: full insert
  if (!body.lemma || !body.pos) return NextResponse.json({ error: 'missing fields' }, { status: 400 });

  const { data: word, error: insertError } = await supabase
    .from('words')
    .insert({
      lemma:      body.lemma,
      pos:        body.pos,
      gender:     body.pos === 'noun' ? (body.gender ?? null) : null,
      forms:      body.forms ?? {},
      example_sv: body.example_sv ?? null,
      example_en: body.example_en ?? null,
      source:     'user_added',
    })
    .select()
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  await supabase.from('user_progress').insert({
    word_id:          word.id,
    status:           'learning',
    next_review_date: today,
  });

  return NextResponse.json({ word });
}
