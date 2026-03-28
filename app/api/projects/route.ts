import { getSupabaseServer } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, enforceSameOrigin, getRateLimitIdentity } from '@/lib/server/requestSecurity';

export async function GET() {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, video_filename, video_size, video_path, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Batch-generate signed URLs for projects that have a video_path
  const paths = (data ?? []).filter(p => p.video_path).map(p => p.video_path as string);
  const signedMap: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from('videos').createSignedUrls(paths, 3600);
    if (signed) {
      for (const s of signed) {
        if (s.path && s.signedUrl) signedMap[s.path] = s.signedUrl;
      }
    }
  }

  const result = (data ?? []).map(p => ({
    ...p,
    thumbnailUrl: p.video_path ? (signedMap[p.video_path] ?? null) : null,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const csrfError = enforceSameOrigin(request);
  if (csrfError) return csrfError;

  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rateLimitError = enforceRateLimit({
    key: `projects-create:${getRateLimitIdentity(request.headers, user.id)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimitError) return rateLimitError;

  const body = await request.json().catch(() => ({}));
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: user.id,
      name: body.name ?? 'Untitled Project',
      video_path: body.video_path ?? null,
      video_filename: body.video_filename ?? null,
      video_size: body.video_size ?? null,
      edit_state: body.edit_state ?? {},
    })
    .select('id')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
