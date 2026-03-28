import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getSupabaseServer } from '@/lib/supabase/server';

const FORWARDED_RESPONSE_HEADERS = [
  'accept-ranges',
  'cache-control',
  'content-encoding',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
] as const;

async function proxyMusicAudio(request: NextRequest, params: Promise<{ cueId: string }>) {
  const { cueId } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: cue, error } = await supabase
    .from('music_cues')
    .select('storage_path, project_id')
    .eq('id', cueId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!cue?.storage_path) {
    return NextResponse.json({ error: 'Music cue not found' }, { status: 404 });
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id')
    .eq('id', cue.project_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const { data: signedData, error: signedError } = await admin.storage
    .from('music')
    .createSignedUrl(cue.storage_path, 60);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      { error: signedError?.message ?? 'Failed to create audio URL' },
      { status: 500 },
    );
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get('range');
  if (range) {
    upstreamHeaders.set('range', range);
  }

  const upstream = await fetch(signedData.signedUrl, {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'follow',
  });

  const responseHeaders = new Headers();
  for (const headerName of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(headerName);
    if (value) {
      responseHeaders.set(headerName, value);
    }
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: { params: Promise<{ cueId: string }> }) {
  return proxyMusicAudio(request, context.params);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ cueId: string }> }) {
  return proxyMusicAudio(request, context.params);
}
