import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { backfillItemNotes } from '@/lib/vocabItems';

// Backfill per-item note + example for items created before those columns
// existed. Processes a few words per call; loop it until it returns 0.
export async function POST() {
  const supabase = getServiceClient();
  const processed = await backfillItemNotes(supabase, 4);
  return NextResponse.json({ processed });
}
