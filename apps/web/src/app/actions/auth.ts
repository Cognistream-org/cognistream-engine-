'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  WS_KEY_COOKIE,
  sessionCookieOptions,
  validateApiKey,
  wsKeyCookieOptions,
} from '@/lib/auth';

export async function loginAction(
  _prevState: { error?: string } | undefined,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const apiKey = formData.get('apiKey');
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    return { error: 'API key is required' };
  }

  const trimmed = apiKey.trim();
  const valid = await validateApiKey(trimmed);
  if (!valid) {
    return { error: 'Invalid API key. Check your credentials and try again.' };
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, trimmed, sessionCookieOptions(isProduction));
  // Non-httpOnly companion for WebSocket auth — replace with ticket auth in production.
  cookieStore.set(WS_KEY_COOKIE, trimmed, wsKeyCookieOptions(isProduction));

  redirect('/dashboard/overview');
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(WS_KEY_COOKIE);
  redirect('/login');
}
