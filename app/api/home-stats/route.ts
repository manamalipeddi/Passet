import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { computeHomeStats } from '@/lib/homeStats';

export const dynamic = 'force-dynamic';

// Fresh dashboard numbers for the client to pull whenever the dashboard is
// shown (mount / tab focus / app resume), sidestepping any page-level caching.
export async function GET() {
  const stats = await computeHomeStats(getServiceClient());
  return NextResponse.json(stats, {
    headers: { 'Cache-Control': 'no-store, must-revalidate' },
  });
}
