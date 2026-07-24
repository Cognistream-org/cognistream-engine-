import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';

export const REALTIME_CHANNEL = 'cognistream:realtime';

export type RealtimeEventType =
  | 'transaction.created'
  | 'transaction.settled'
  | 'escrow.expired'
  | 'dispute.created'
  | 'dispute.resolved';

export type RealtimeEnvelope = {
  orgId: string;
  event: RealtimeEventType;
  occurredAt: string;
  data: Record<string, unknown>;
};

type OrgSocket = {
  socket: WebSocket;
  orgId: string;
};

const localSockets = new Set<OrgSocket>();

export function registerOrgSocket(orgId: string, socket: WebSocket): () => void {
  const entry: OrgSocket = { orgId, socket };
  localSockets.add(entry);
  return () => {
    localSockets.delete(entry);
  };
}

function fanOutLocal(envelope: RealtimeEnvelope): void {
  const payload = JSON.stringify(envelope);
  for (const entry of localSockets) {
    if (entry.orgId !== envelope.orgId) continue;
    if (entry.socket.readyState === entry.socket.OPEN) {
      entry.socket.send(payload);
    }
  }
}

/** Publish to Redis so all API instances fan out to their local WS clients. */
export async function publishRealtime(
  redis: Redis,
  orgId: string,
  event: RealtimeEventType,
  data: Record<string, unknown>,
): Promise<void> {
  const envelope: RealtimeEnvelope = {
    orgId,
    event,
    occurredAt: new Date().toISOString(),
    data,
  };

  fanOutLocal(envelope);

  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    await redis.publish(REALTIME_CHANNEL, JSON.stringify(envelope));
  } catch {
    // Local fan-out already happened; Redis failure must not break money paths.
  }
}

/** Subscribe once per process; ignore self-originated messages that already fanned out. */
export function startRealtimeSubscriber(
  redis: Redis,
  onRemote: (envelope: RealtimeEnvelope) => void,
): Redis | null {
  if (typeof redis.duplicate !== 'function') {
    return null;
  }

  const sub = redis.duplicate({ lazyConnect: true });
  void (async () => {
    try {
      if (sub.status !== 'ready') {
        await sub.connect();
      }
      await sub.subscribe(REALTIME_CHANNEL);
      sub.on('message', (_channel, message) => {
        try {
          const envelope = JSON.parse(message) as RealtimeEnvelope;
          onRemote(envelope);
        } catch {
          // Ignore malformed payloads
        }
      });
    } catch {
      // Subscriber optional in degraded mode
    }
  })();
  return sub;
}

export function deliverRemoteRealtime(envelope: RealtimeEnvelope): void {
  fanOutLocal(envelope);
}
