export const SESSION_COOKIE = 'cognistream_session';
export const WS_KEY_COOKIE = 'cognistream_ws_key';

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
}
