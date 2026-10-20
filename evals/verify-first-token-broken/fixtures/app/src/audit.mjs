import { appendFile } from 'node:fs/promises';

const FILE = new URL('../data/audit.log', import.meta.url);

/** Appends one audit event to data/audit.log. */
export function audit(event, userId) {
  return appendFile(FILE, JSON.stringify({ at: new Date().toISOString(), event, userId }) + '\n');
}
