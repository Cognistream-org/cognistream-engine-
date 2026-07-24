import { cookies } from 'next/headers';
import { getApiBaseUrl, SESSION_COOKIE, WS_KEY_COOKIE } from '@/lib/constants';

export { SESSION_COOKIE, WS_KEY_COOKIE, getApiBaseUrl };

export async function getSessionApiKey(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value;
}

export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/v1/agents?limit=1`, {
      headers: { 'X-API-Key': apiKey },
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function sessionCookieOptions(isProduction: boolean) {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}

export function wsKeyCookieOptions(isProduction: boolean) {
  return {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  };
}
