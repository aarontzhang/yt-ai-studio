import { redirect } from 'next/navigation';
import LandingPage from '@/components/landing/LandingPage';
import { getSupabaseServer } from '@/lib/supabase/server';

export default async function Home() {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/projects');

  return <LandingPage />;
}
