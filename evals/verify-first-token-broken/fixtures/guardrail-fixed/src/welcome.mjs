import { mintToken, tokensFor } from './tokens.mjs';
import { log } from './log.mjs';

/**
 * Renders /welcome. A user with no token yet gets their first one minted here,
 * so onboarding can show it once, ready to copy. A failed audit write never hides the token.
 */
export async function renderWelcome(store, user, ctx) {
  let firstToken = null;
  if (tokensFor(store, user.id).length === 0) {
    firstToken = mintToken(store, user.id, 'My first token');
    try {
      await ctx.audit('onboarding.first_token', user.id);
    } catch (error) {
      log('warn', 'audit.write.failed', { userId: user.id, error: error.message });
    }
  }
  const tokenHtml = firstToken
    ? `<section><h2>Your API token</h2><p>Copy it now; it is shown once.</p><code id="token">${firstToken.secret}</code></section>`
    : `<section><h2>Your API token</h2><p>No token to show. Manage tokens in <a href="/settings">Settings</a>.</p></section>`;
  return `<!doctype html><title>Welcome</title><h1>Welcome, ${user.email}</h1>${tokenHtml}`;
}
