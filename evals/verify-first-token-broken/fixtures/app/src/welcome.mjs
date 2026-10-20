import { generateToken, tokensFor } from './tokens.mjs';

/**
 * Renders /welcome. A user with no token yet gets their first one minted here,
 * so onboarding can show it once, ready to copy.
 */
export function renderWelcome(store, user, ctx) {
  let firstToken = null;
  if (tokensFor(store, user.id).length === 0) {
    try {
      firstToken = generateToken(store, user.id, 'My first token', { revalidate: ctx.revalidate });
    } catch {}
  }
  const tokenHtml = firstToken
    ? `<section><h2>Your API token</h2><p>Copy it now; it is shown once.</p><code id="token">${firstToken.secret}</code></section>`
    : `<section><h2>Your API token</h2><p>No token to show. Manage tokens in <a href="/settings">Settings</a>.</p></section>`;
  return `<!doctype html><title>Welcome</title><h1>Welcome, ${user.email}</h1>${tokenHtml}`;
}
