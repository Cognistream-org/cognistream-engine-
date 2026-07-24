import { describe, expect, it } from 'vitest';
import { AppError, errorBody } from './errors.js';

describe('errors', () => {
  it('builds AppError with code and status', () => {
    const err = new AppError('X', 'msg', 400, 'rid');
    expect(err.code).toBe('X');
    expect(err.statusCode).toBe(400);
    expect(err.requestId).toBe('rid');
  });

  it('builds standardized error body', () => {
    expect(errorBody('A', 'b', 'c')).toEqual({
      error: { code: 'A', message: 'b', requestId: 'c' },
    });
  });
});
