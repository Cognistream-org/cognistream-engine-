import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { parseOrReply, requireAuth } from './http.js';
import { z } from 'zod';

describe('http helpers', () => {
  it('parseOrReply returns data or 422', () => {
    const reply = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    } as unknown as FastifyReply;
    const schema = z.object({ name: z.string().min(1) });
    expect(parseOrReply(schema, { name: 'ok' }, reply, 'r1')).toEqual({ name: 'ok' });
    expect(parseOrReply(schema, { name: '' }, reply, 'r1')).toBeNull();
    expect(reply.status).toHaveBeenCalledWith(422);
  });

  it('requireAuth guards missing auth', () => {
    const reply = {
      status: vi.fn(() => reply),
      send: vi.fn(),
    } as unknown as FastifyReply;
    const request = { id: 'r1' } as unknown as FastifyRequest;
    expect(requireAuth(request, reply)).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(401);

    const authed = {
      id: 'r1',
      auth: { orgId: 'o', apiKeyId: 'k', scopes: [], tier: 'free' },
    } as unknown as FastifyRequest;
    expect(requireAuth(authed, reply)).toBe(true);
  });
});
