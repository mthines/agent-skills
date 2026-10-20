import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const FILE = new URL('../data/db.json', import.meta.url);

export function openStore() {
  mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  const data = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { users: [], sessions: [], tokens: [] };
  return {
    data,
    id: () => randomUUID(),
    save: () => writeFileSync(FILE, JSON.stringify(data, null, 2)),
  };
}
