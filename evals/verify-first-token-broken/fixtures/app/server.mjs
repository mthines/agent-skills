import http from 'node:http';
import { createHash } from 'node:crypto';
import { openStore } from './src/store.mjs';
import { renderWelcome } from './src/welcome.mjs';
import { generateToken, tokensFor } from './src/tokens.mjs';
import { log } from './src/log.mjs';
import { audit } from './src/audit.mjs';

const PORT = Number(process.env.PORT ?? 4310);
const ADMIN_KEY = 'dev-admin';
const store = openStore();
const hash = (s) => createHash('sha256').update(s).digest('hex');

// Like a framework's page cache: refreshing a page is only legal outside a render.
function pageContext() {
  const ctx = { rendering: false, audit, revalidate(path) {
    if (ctx.rendering) throw new Error(`revalidate("${path}") called during render`);
  } };
  return ctx;
}

function sessionUser(req) {
  const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  const session = store.data.sessions.find((s) => s.id === sid);
  return session && store.data.users.find((u) => u.id === session.userId);
}

async function body(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return req.headers['content-type']?.includes('json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (status, html, headers = {}) => {
    res.writeHead(status, { 'content-type': 'text/html', ...headers }).end(html);
    log(status >= 500 ? 'error' : 'info', 'http.request', { method: req.method, path: url.pathname, status, durationMs: Date.now() - started });
  };
  try {
    if (url.pathname === '/health') return send(200, 'ok');
    if (req.method === 'POST' && url.pathname === '/admin/users') {
      if (req.headers['x-admin-key'] !== ADMIN_KEY) return send(403, 'forbidden');
      const { email, password } = await body(req);
      const user = { id: store.id(), email, passwordHash: hash(password) };
      store.data.users.push(user); store.save();
      return send(201, JSON.stringify({ id: user.id, email }), { 'content-type': 'application/json' });
    }
    if (url.pathname === '/login' && req.method === 'GET') {
      return send(200, '<!doctype html><title>Sign in</title><form method="post" action="/login"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>');
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const { email, password } = await body(req);
      const user = store.data.users.find((u) => u.email === email && u.passwordHash === hash(password));
      if (!user) return send(401, 'Wrong email or password');
      const session = { id: store.id(), userId: user.id }; store.data.sessions.push(session); store.save();
      log('info', 'auth.sign_in', { userId: user.id });
      return send(303, '', { location: '/welcome', 'set-cookie': `sid=${session.id}; HttpOnly; Path=/` });
    }
    const user = sessionUser(req);
    if (!user) return send(303, '', { location: '/login' });
    if (url.pathname === '/welcome') {
      const ctx = pageContext();
      ctx.rendering = true;
      const html = await renderWelcome(store, user, ctx);
      ctx.rendering = false;
      return send(200, html);
    }
    if (url.pathname === '/settings' && req.method === 'GET') {
      const rows = tokensFor(store, user.id).map((t) => `<li>${t.name} — created ${t.createdAt}</li>`).join('');
      return send(200, `<!doctype html><title>Settings</title><h1>API tokens</h1><ul>${rows}</ul><form method="post" action="/settings"><button>Generate token</button></form>`);
    }
    if (url.pathname === '/settings' && req.method === 'POST') {
      const token = generateToken(store, user.id, 'Token', { revalidate: pageContext().revalidate });
      return send(200, `<!doctype html><code id="token">${token.secret}</code>`);
    }
    return send(404, 'not found');
  } catch (error) {
    log('error', 'http.unhandled', { path: url.pathname, error: error.message });
    return send(500, 'Something went wrong');
  }
});

server.listen(PORT, '127.0.0.1', () => log('info', 'server.listening', { port: PORT }));
