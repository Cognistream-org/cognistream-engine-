import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  buildTestApp,
  cleanupOrg,
  createTestOrgWithKey,
} from '../test/helpers.js';
import { publishRealtime } from '../lib/realtime.js';

describe('websocket stream', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;
  let address: string;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test server');
    }
    address = `127.0.0.1:${addr.port}`;

    const org = await createTestOrgWithKey();
    orgId = org.org.id;
    apiKey = org.plaintextKey;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(orgId);
    await app.close();
  });

  it('rejects invalid API key', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://${address}/v1/stream?api_key=invalid`);
      ws.on('close', (code) => {
        expect(code).toBe(1008);
        resolve();
      });
      ws.on('error', () => resolve());
      setTimeout(() => reject(new Error('timeout')), 5_000);
    });
  });

  it('connects and receives realtime events', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://${address}/v1/stream?api_key=${encodeURIComponent(apiKey)}`,
      );
      let connected = false;

      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw)) as {
          event: string;
          orgId?: string;
          data?: { ping?: boolean };
        };
        if (msg.event === 'connected') {
          connected = true;
          expect(msg.orgId).toBe(orgId);
          void publishRealtime(app.redis, orgId, 'transaction.created', { ping: true });
          return;
        }
        if (msg.event === 'transaction.created' && connected) {
          expect(msg.data?.ping).toBe(true);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error('timeout waiting for event')), 8_000);
    });
  });
});
