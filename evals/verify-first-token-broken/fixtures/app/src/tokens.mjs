import { randomBytes } from 'node:crypto';
import { log } from './log.mjs';

/** Inserts one API token for the user and returns it, secret included. */
export function mintToken(store, userId, name) {
  const token = { id: store.id(), userId, name, secret: `kr_${randomBytes(12).toString('hex')}`, createdAt: new Date().toISOString() };
  store.data.tokens.push(token);
  store.save();
  log('info', 'api_token.minted', { userId, tokenId: token.id });
  return token;
}

/** The dashboard's "Generate token" action: mint, then refresh the cached pages that list tokens. */
export function generateToken(store, userId, name, { revalidate }) {
  const token = mintToken(store, userId, name);
  try {
    revalidate('/welcome');
    revalidate('/settings');
  } catch (error) {
    log('error', 'api_token.generate.failed', { userId, tokenId: token.id, error: error.message });
    throw error;
  }
  return token;
}

export function tokensFor(store, userId) {
  return store.data.tokens.filter((t) => t.userId === userId);
}
