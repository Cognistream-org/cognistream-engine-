import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from './errors.js';
import { handleError } from './error-handler.js';

function mockReply() {
  const reply = {
    sent: false,
    status: vi.fn(() => reply),
    send: vi.fn(() => reply),
  } as unknown as FastifyReply;
  return reply;
}

function mockRequest(): FastifyRequest {
  return {
    id: 'rid-1',
    log: { error: vi.fn() },
  } as unknown as FastifyRequest;
}

describe('error handler', () => {
  it('maps AppError', () => {
    const reply = mockReply();
    handleError(new AppError('X', 'msg', 418, 'rid-1'), mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(418);
  });

  it('maps Prisma P2002 and P2025', () => {
    const reply = mockReply();
    handleError(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }),
      mockRequest(),
      reply,
    );
    expect(reply.status).toHaveBeenCalledWith(409);

    const reply2 = mockReply();
    handleError(
      new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '6' }),
      mockRequest(),
      reply2,
    );
    expect(reply2.status).toHaveBeenCalledWith(404);
  });

  it('maps 4xx Fastify errors and 500 otherwise', () => {
    const reply = mockReply();
    const err = Object.assign(new Error('bad'), { statusCode: 400 });
    handleError(err, mockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(400);

    const reply2 = mockReply();
    handleError(new Error('boom'), mockRequest(), reply2);
    expect(reply2.status).toHaveBeenCalledWith(500);
  });

  it('no-ops when reply already sent', () => {
    const reply = mockReply();
    (reply as { sent: boolean }).sent = true;
    handleError(new Error('x'), mockRequest(), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });
});
