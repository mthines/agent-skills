import test from 'node:test';
import assert from 'node:assert/strict';
import { mintToken, generateToken, tokensFor } from '../src/tokens.mjs';

const memoryStore = () => { let n = 0; return { data: { users: [], sessions: [], tokens: [] }, id: () => `id-${++n}`, save() {} }; };

test('mintToken stores one token with a kr_ secret', () => {
  const store = memoryStore();
  const token = mintToken(store, 'u1', 'My first token');
  assert.match(token.secret, /^kr_[0-9a-f]{24}$/);
  assert.equal(tokensFor(store, 'u1').length, 1);
});

test('generateToken refreshes the token pages and returns the token', () => {
  const store = memoryStore();
  const refreshed = [];
  const token = generateToken(store, 'u1', 'Token', { revalidate: (p) => refreshed.push(p) });
  assert.deepEqual(refreshed, ['/welcome', '/settings']);
  assert.equal(token.userId, 'u1');
});

test('a new user gets exactly one first token on /welcome, shown once', async () => {
  const { renderWelcome } = await import('../src/welcome.mjs');
  const store = memoryStore();
  const ctx = { audit: async () => {}, revalidate: () => {} };
  const first = await renderWelcome(store, { id: 'u1', email: 'a@example.com' }, ctx);
  const again = await renderWelcome(store, { id: 'u1', email: 'a@example.com' }, ctx);
  assert.equal(tokensFor(store, 'u1').length, 1);
  assert.match(again, /No token to show/);
  assert.ok(first);
});
