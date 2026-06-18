import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { sentence_id } = body;
  if (!sentence_id) return NextResponse.json({ error: 'missing sentence_id' }, { status: 400 });

  const supabase = getServiceClient();
  const { error } = await supabase
    .from('generated_sentences')
    .update({ is_excluded: true })
    .eq('id', sentence_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
