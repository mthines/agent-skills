import { appendFile, mkdir } from 'node:fs/promises';
import { log } from './log.mjs';

const DIR = new URL('../data/audit/', import.meta.url);
const FILE = new URL('events.log', DIR);
const FLUSH_MS = 8000;
const queue = [];

/** Queues one audit event; a background flusher writes the queue to data/audit/events.log every 8 s. */
export function audit(event, userId) {
  queue.push({ at: new Date().toISOString(), event, userId });
  return Promise.resolve();
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  try {
    await mkdir(DIR, { recursive: true });
    await appendFile(FILE, batch.map((e) => JSON.stringify(e)).join('\n') + '\n');
    log('info', 'audit.flushed', { events: batch.length });
  } catch (error) {
    log('error', 'audit.flush.failed', { events: batch.length, error: error.message });
  }
}

setInterval(flush, FLUSH_MS).unref();
