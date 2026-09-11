import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { topUpItemBuffer } from '@/lib/vocabItems';

// Fire-and-forget from the client after a session loads when the un-introduced
// item buffer is low. Generates items for the next few words so future sessions
// stay DB-only and instant. Cheap (a Haiku call per word) and safe to re-run.
export async function POST() {
  const supabase = getServiceClient();
  const processed = await topUpItemBuffer(supabase, 3);
  return NextResponse.json({ processed });
}
