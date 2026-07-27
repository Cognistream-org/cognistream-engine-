import { describe, expect, it } from 'vitest';
import { bindRequestLogger, createLogger } from './logger.js';

describe('createLogger', () => {
  it('creates a development logger with pretty transport', () => {
    const logger = createLogger({ level: 'silent', isProduction: false });
    expect(logger).toBeTruthy();
  });

  it('creates a production logger without pretty transport', () => {
    const logger = createLogger({ level: 'silent', isProduction: true });
    expect(logger).toBeTruthy();
  });

  it('binds requestId onto child loggers', () => {
    const logger = createLogger({ level: 'silent', isProduction: true });
    const child = bindRequestLogger(logger, {
      requestId: 'req-1',
      traceId: 'trace-1',
      spanId: 'span-1',
    });
    expect(child.bindings()).toMatchObject({
      requestId: 'req-1',
      traceId: 'trace-1',
      spanId: 'span-1',
    });
  });

  it('binds requestId without optional trace fields', () => {
    const logger = createLogger({ level: 'silent', isProduction: true, service: 'custom' });
    const child = bindRequestLogger(logger, { requestId: 'req-2' });
    expect(child.bindings()).toMatchObject({ requestId: 'req-2' });
    expect(child.bindings().traceId).toBeUndefined();
  });
});
