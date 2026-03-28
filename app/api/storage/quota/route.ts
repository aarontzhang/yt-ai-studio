import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getUserStorageQuotaSnapshot } from '@/lib/server/storageQuota';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const quota = await getUserStorageQuotaSnapshot(user.id);
    return NextResponse.json({ quota });
  } catch (error) {
    console.error('[storage.quota] failed to load quota', error);
    return NextResponse.json({ quota: null }, { status: 200 });
  }
}
