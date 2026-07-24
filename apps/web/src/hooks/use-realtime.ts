'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import Cookies from 'js-cookie';
import { WS_KEY_COOKIE, getApiBaseUrl } from '@/lib/constants';

const SWR_KEYS_TO_MUTATE = ['v1/overview', 'v1/transactions'];

function getWsUrl(apiKey: string): string {
  const base = getApiBaseUrl();
  const wsBase = base.replace(/^http/, 'ws');
  return `${wsBase}/v1/stream?api_key=${encodeURIComponent(apiKey)}`;
}

/**
 * Real-time WebSocket hook with exponential backoff reconnect.
 * Reads API key from cognistream_ws_key (non-httpOnly companion cookie).
 * Production should migrate to short-lived ticket auth.
 */
export function useRealtime() {
  const { mutate } = useSWRConfig();
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutateAll = useCallback(() => {
    for (const key of SWR_KEYS_TO_MUTATE) {
      void mutate((k) => typeof k === 'string' && k.includes(key));
    }
  }, [mutate]);

  useEffect(() => {
    let cancelled = false;

    function connect() {
      if (cancelled) return;

      const apiKey = Cookies.get(WS_KEY_COOKIE);
      if (!apiKey) return;

      const ws = new WebSocket(getWsUrl(apiKey));
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as { event?: string };
          if (data.event && data.event !== 'connected') {
            mutateAll();
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 30_000);
        retryRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [mutateAll]);
}
