import { describe, expect, it } from 'vitest';
import { createId } from './uuid.js';

describe('createId', () => {
  it('returns a UUID v7-shaped string', () => {
    const id = createId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
