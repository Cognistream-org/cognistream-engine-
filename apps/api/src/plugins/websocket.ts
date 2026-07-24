import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { prisma } from '../lib/prisma.js';
import { verifyApiKey, apiKeyCacheId } from '../lib/api-key.js';
import {
  deliverRemoteRealtime,
  registerOrgSocket,
  startRealtimeSubscriber,
  type RealtimeEnvelope,
} from '../lib/realtime.js';

async function resolveOrgFromApiKey(rawKey: string): Promise<string | null> {
  if (rawKey.length < 16) return null;

  const prefix = rawKey.slice(0, 16);
  const candidates = await prisma.apiKey.findMany({
    where: { keyPrefix: prefix, revokedAt: null },
    select: {
      id: true,
      orgId: true,
      keyHash: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  for (const candidate of candidates) {
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;
    const valid = await verifyApiKey(rawKey, candidate.keyHash);
    if (valid) {
      void apiKeyCacheId(rawKey);
      return candidate.orgId;
    }
  }
  return null;
}

const websocketPluginImpl: FastifyPluginAsync = async (app) => {
  await app.register(websocket);

  const subscriber = startRealtimeSubscriber(app.redis, (envelope: RealtimeEnvelope) => {
    deliverRemoteRealtime(envelope);
  });

  app.addHook('onClose', async () => {
    if (!subscriber) return;
    try {
      await subscriber.quit();
    } catch {
      subscriber.disconnect();
    }
  });

  app.get('/v1/stream', { websocket: true }, (socket: WebSocket, request) => {
    const query = request.query as { api_key?: string };
    const rawKey = typeof query.api_key === 'string' ? query.api_key : '';

    void (async () => {
      const orgId = await resolveOrgFromApiKey(rawKey);
      if (!orgId) {
        socket.send(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } }));
        socket.close(1008, 'Unauthorized');
        return;
      }

      const unregister = registerOrgSocket(orgId, socket);
      socket.send(
        JSON.stringify({
          event: 'connected',
          orgId,
          occurredAt: new Date().toISOString(),
        }),
      );

      socket.on('close', () => {
        unregister();
      });
      socket.on('error', () => {
        unregister();
      });
    })();
  });
};

export const websocketPlugin = fp(websocketPluginImpl, {
  name: 'websocket-plugin',
  dependencies: ['auth-plugin'],
});
