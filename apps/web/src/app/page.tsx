import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LandingPage } from '@/components/landing/landing-page';
import { SESSION_COOKIE } from '@/lib/constants';

export default async function HomePage() {
  const cookieStore = await cookies();
  const hasSession = Boolean(cookieStore.get(SESSION_COOKIE)?.value);

  if (hasSession) {
    redirect('/dashboard/overview');
  }

  return <LandingPage />;
}
