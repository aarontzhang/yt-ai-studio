import { getSupabaseServer } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const authError = searchParams.get('error_description') ?? searchParams.get('error');

  const redirectToLogin = (message: string) => {
    const url = new URL('/auth/login', origin);
    url.searchParams.set('error', message);
    return NextResponse.redirect(url);
  };

  if (authError) {
    return redirectToLogin(authError);
  }

  if (code) {
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return redirectToLogin(error.message);
    }
    return NextResponse.redirect(`${origin}/projects`);
  }

  return redirectToLogin('Authentication could not be completed. Please try again.');
}
