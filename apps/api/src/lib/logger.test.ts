import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';

describe('createLogger', () => {
  it('creates a development logger with pretty transport', () => {
    const logger = createLogger({ level: 'silent', isProduction: false });
    expect(logger).toBeTruthy();
  });

  it('creates a production logger without pretty transport', () => {
    const logger = createLogger({ level: 'silent', isProduction: true });
    expect(logger).toBeTruthy();
  });
});
