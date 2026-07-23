import { uuidv7 } from 'uuidv7';

/** Generate a time-sortable UUID v7 primary key. */
export function createId(): string {
  return uuidv7();
}
