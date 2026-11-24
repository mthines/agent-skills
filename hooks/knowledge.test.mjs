import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAX_LINES,
  cacheFile,
  editText,
  fetchEntries,
  normalizeRecords,
  relativePath,
  renderLine,
  resolveConnection,
  scopeFromRemote,
  selectRecords,
  sessionDir,
  splitEndpoint,
  writeJson,
} from './lib/knowledge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-hooks-'));
// Detached prefetch workers may still be writing their cache entry when the suite ends.
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const REL = 'components/agents/src/workers/providers/docker/wrapper.ts';
const entry = (key, value) => ({ key, value: typeof value === 'string' ? value : JSON.stringify(value) });

describe('connection', () => {
  it('splits an endpoint and its token', () => {
    assert.deepEqual(splitEndpoint('https://x.supabase.co/functions/v1/mcp?token=lk_rw_abc'), {
      endpoint: 'https://x.supabase.co/functions/v1/mcp',
      token: 'lk_rw_abc',
    });
    assert.deepEqual(splitEndpoint('not a url'), { endpoint: null, token: null });
  });

  it('reads the mcp-remote entry in ~/.claude.json and derives the REST base', () => {
    const home = fs.mkdtempSync(path.join(tmp, 'home-'));
    fs.writeFileSync(
      path.join(home, '.claude.json'),
      JSON.stringify({
        mcpServers: { lorekit: { command: 'npx', args: ['-y', 'mcp-remote@0.15.2', 'https://x.supabase.co/functions/v1/mcp?token=lk_rw_abc'] } },
      }),
    );
    assert.deepEqual(resolveConnection({ cwd: home, home, env: {} }), {
      restBase: 'https://x.supabase.co/functions/v1/memories',
      token: 'lk_rw_abc',
    });
  });

  it('falls back to the environment and returns null with nothing configured', () => {
    const home = fs.mkdtempSync(path.join(tmp, 'home-'));
    const env = { LOREKIT_MCP_URL: 'https://y.supabase.co/functions/v1/mcp', LOREKIT_TOKEN: 'lk_ro_z' };
    assert.equal(resolveConnection({ cwd: home, home, env }).token, 'lk_ro_z');
    assert.equal(resolveConnection({ cwd: home, home, env: {} }), null);
  });
});

describe('repo and paths', () => {
  it('derives the scope from ssh and https remotes', () => {
    assert.equal(scopeFromRemote('git@github.com:dash0hq/dash0.git'), 'repo::dash0hq/dash0');
    assert.equal(scopeFromRemote('https://github.com/mthines/agent-skills'), 'repo::mthines/agent-skills');
    assert.equal(scopeFromRemote(''), null);
  });

  it('resolves a file reached through a symlinked directory', () => {
    const real = fs.mkdtempSync(path.join(tmp, 'real-'));
    fs.mkdirSync(path.join(real, 'src'));
    fs.writeFileSync(path.join(real, 'src', 'a.ts'), '');
    const link = path.join(tmp, `link-${path.basename(real)}`);
    fs.symlinkSync(real, link);
    assert.equal(relativePath(real, path.join(link, 'src', 'a.ts')), 'src/a.ts');
    assert.equal(relativePath(link, path.join(real, 'src', 'a.ts')), 'src/a.ts');
  });

  it('keeps a repo-relative source path and skips the rest', () => {
    assert.equal(relativePath('/r', '/r/src/a.ts'), 'src/a.ts');
    assert.equal(relativePath('/r', '/other/a.ts'), null);
    assert.equal(relativePath('/r', '/r/node_modules/x/a.ts'), null);
    assert.equal(relativePath('/r', '/r/logo.png'), null);
    assert.equal(relativePath('/r', 'relative.ts'), null);
  });
});

describe('normalizeRecords', () => {
  it('reads a hotspot with counters', () => {
    const [r] = normalizeRecords([entry(`hotspot::${REL}`, { v: 1, confirmed: 3, missed: 1, regressed: 0, classes: ['security'] })], REL);
    assert.deepEqual([r.kind, r.confirmed, r.missed, r.regressed], ['hotspot', 3, 1, 0]);
  });

  it('counts examples when an older hotspot has no counters', () => {
    const [r] = normalizeRecords(
      [entry(`hotspot::${REL}`, { action: 'confirmed', confirmed_examples: [{ pr: 1 }, { pr: 2 }] })],
      REL,
    );
    assert.equal(r.confirmed, 2);
  });

  it('takes the symbol from the key when the path contains an @', () => {
    const scoped = 'packages/@scope/x.ts';
    const [r] = normalizeRecords([entry(`knowledge::drainAndWait@${scoped}`, { facts: [{ claim: 'bounded' }] })], scoped);
    assert.deepEqual(r?.symbols, ['drainAndWait']);
  });

  it('keeps one record when the read and the search both return it', () => {
    const e = entry(`hotspot::${REL}`, { confirmed: 2 });
    assert.equal(normalizeRecords([e, e], REL).length, 1);
  });

  it('drops expired, malformed, prose, and other-path records', () => {
    const records = normalizeRecords(
      [
        entry(`hotspot::${REL}`, { confirmed: 5, expires: '2020-01-01T00:00:00Z' }),
        entry(`hotspot::${REL}`, 'not json'),
        entry('codebase-knowledge::some-prose', { note: 'x' }),
        entry('knowledge::foo@components/other.ts', { symbol: 'foo', note: 'x' }),
      ],
      REL,
    );
    assert.deepEqual(records, []);
  });

  it('takes the symbol from the value when the key part is a prose slug', () => {
    const slug = 'a-preparing-frame-setup-output-is-a-head-kept-buffer';
    const [r] = normalizeRecords(
      [entry(`knowledge::${slug}@${REL}`, { symbol: 'createSetupOutputCapture / #beginFreshClaimRun', facts: [{ claim: 'Capture is capped.' }] })],
      REL,
    );
    assert.deepEqual(r.symbols, ['createSetupOutputCapture', '#beginFreshClaimRun']);
  });

  it('takes the symbol from the key when the value has none, and drops a slug-only record', () => {
    const records = normalizeRecords(
      [
        entry(`knowledge::drainAndWait@${REL}`, { status: 'confirmed', note: 'stderr is bounded' }),
        entry(`knowledge::a-prose-slug-with-hyphens@${REL}`, { note: 'no symbol anywhere' }),
      ],
      REL,
    );
    assert.deepEqual(records.map((r) => r.symbols), [['drainAndWait']]);
  });

  it('skips superseded facts and uses the first live one', () => {
    const [r] = normalizeRecords(
      [entry(`knowledge::run@${REL}`, { facts: [{ claim: 'old', superseded_at: 'abc' }, { claim: 'current' }] })],
      REL,
    );
    assert.equal(r.text, 'current');
  });

  it('drops a knowledge record whose facts are all superseded and that has no note', () => {
    assert.deepEqual(
      normalizeRecords([entry(`knowledge::run@${REL}`, { facts: [{ claim: 'old', superseded_at: 'abc' }] })], REL),
      [],
    );
  });
});

describe('selectRecords', () => {
  const hot = (over) => ({ kind: 'hotspot', key: `hotspot::${REL}`, confirmed: 0, missed: 0, regressed: 0, classes: [], ...over });
  const know = (symbols, key = `knowledge::${symbols[0]}@${REL}`) => ({ kind: 'knowledge', key, symbols, text: 'a fact' });

  it('shows a hotspot only once it has earned it', () => {
    assert.equal(selectRecords([hot({ confirmed: 1 })], '').length, 0);
    assert.equal(selectRecords([hot({ confirmed: 2 })], '').length, 1);
    assert.equal(selectRecords([hot({ missed: 1 })], '').length, 1);
    assert.equal(selectRecords([hot({ regressed: 1 })], '').length, 1);
  });

  it('shows a knowledge record only when its symbol is in the edit', () => {
    assert.equal(selectRecords([know(['drainAndWait'])], 'const x = drainAndWait()').length, 1);
    assert.equal(selectRecords([know(['drainAndWait'])], 'const x = other()').length, 0);
    assert.equal(selectRecords([know(['#beginFreshClaimRun'])], 'beginFreshClaimRun(').length, 1);
  });

  it('skips shown records, orders hotspots first, and honours the limit', () => {
    const records = [know(['a1x']), hot({ confirmed: 2 }), know(['b2y'])];
    const picked = selectRecords(records, 'a1x b2y', {}, 2);
    assert.deepEqual(picked.map((r) => r.kind), ['hotspot', 'knowledge']);
    assert.equal(selectRecords(records, 'a1x b2y', { [`hotspot::${REL}`]: true, [`knowledge::a1x@${REL}`]: true }).length, 1);
  });

  it('reads the text of Edit and Write inputs', () => {
    assert.match(editText({ old_string: 'one', new_string: 'two' }), /one\ntwo/);
    assert.match(editText({ content: 'whole file' }), /whole file/);
  });

  it('renders one short line per record', () => {
    const line = renderLine(hot({ confirmed: 2, missed: 1, classes: ['security'] }), REL);
    assert.match(line, /^⚠ hotspot .*: 2 confirmed, 1 missed, 0 regressed \(security\)$/);
    assert.ok(renderLine(know(['x']), REL).startsWith('ℹ x: a fact'));
    assert.ok(renderLine({ ...know(['x']), text: 'n'.repeat(500) }, REL).length <= 220);
    assert.doesNotMatch(renderLine(hot({ confirmed: 2, note: 'stale finding text' }), REL), /stale/);
  });
});

describe('fetchEntries', () => {
  const conn = { restBase: 'https://x/functions/v1/memories', token: 'lk_rw_t' };

  it('reads the hotspot by exact key and searches the path, with the token as a Bearer header', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      return { ok: true, json: async () => ({ entries: [{ key: url.endsWith('/read') ? 'h' : 'k' }] }) };
    };
    const entries = await fetchEntries({ conn, scope: 'repo::o/r', rel: REL, fetchImpl });
    assert.deepEqual(entries.map((e) => e.key), ['h', 'k']);
    const read = calls.find((c) => c.url.endsWith('/read'));
    assert.deepEqual(read.body.refs, [`repo::o/r::hotspot::${REL}`]);
    const search = calls.find((c) => c.url.endsWith('/search'));
    assert.deepEqual([search.body.q, search.body.scopes, search.body.tags], [REL, ['repo::o/r'], ['codebase-knowledge']]);
    assert.ok(calls.every((c) => c.auth === 'Bearer lk_rw_t'));
  });

  it('throws on a non-2xx response', async () => {
    await assert.rejects(fetchEntries({ conn, scope: 's', rel: REL, fetchImpl: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  });
});

describe('hook scripts', () => {
  const env = (cache, home = cache) => ({ ...process.env, XDG_CACHE_HOME: cache, HOME: home });
  const run = (script, input, e) =>
    spawnSync(process.execPath, [path.join(here, script)], { input: typeof input === 'string' ? input : JSON.stringify(input), env: e, encoding: 'utf8' });
  const seed = (cache, sessionId, file, records, rel = REL) =>
    writeJson(cacheFile(sessionDir(sessionId, { XDG_CACHE_HOME: cache }), file), { status: 'ok', rel, records, at: Date.now() });
  const FILE = `/repo/${REL}`;
  const edit = (sessionId, extra = {}) => ({ session_id: sessionId, tool_name: 'Edit', tool_input: { file_path: FILE, old_string: 'drainAndWait', new_string: 'x' }, ...extra });
  const hotspot = { kind: 'hotspot', key: `hotspot::${REL}`, confirmed: 2, missed: 0, regressed: 1, classes: ['security'] };
  const knowledge = { kind: 'knowledge', key: `knowledge::drainAndWait@${REL}`, symbols: ['drainAndWait'], text: 'stderr is bounded' };

  it('injects the earned hotspot and the matching knowledge record, then goes quiet for them', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    seed(cache, 's1', FILE, [hotspot, knowledge]);
    const first = run('knowledge-inject.mjs', edit('s1'), env(cache));
    assert.equal(first.status, 0);
    const context = JSON.parse(first.stdout).hookSpecificOutput;
    assert.equal(context.hookEventName, 'PreToolUse');
    assert.match(context.additionalContext, /⚠ hotspot .*1 regressed/);
    assert.match(context.additionalContext, /ℹ drainAndWait: stderr is bounded/);
    assert.equal(run('knowledge-inject.mjs', edit('s1'), env(cache)).stdout, '');
  });

  it('is silent on a cache miss, a pending fetch, other tools, and bad input', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    assert.equal(run('knowledge-inject.mjs', edit('none'), env(cache)).stdout, '');
    writeJson(cacheFile(sessionDir('p', { XDG_CACHE_HOME: cache }), FILE), { status: 'pending', at: Date.now() });
    assert.equal(run('knowledge-inject.mjs', edit('p'), env(cache)).stdout, '');
    seed(cache, 's2', FILE, [hotspot]);
    assert.equal(run('knowledge-inject.mjs', edit('s2', { tool_name: 'Bash' }), env(cache)).stdout, '');
    const bad = run('knowledge-inject.mjs', '{not json', env(cache));
    assert.deepEqual([bad.status, bad.stdout], [0, '']);
  });

  it('stops injecting once the session line budget is spent', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    seed(cache, 's3', FILE, [hotspot]);
    writeJson(path.join(sessionDir('s3', { XDG_CACHE_HOME: cache }), 'state.json'), { shown: {}, lines: MAX_LINES, tokens: 0 });
    assert.equal(run('knowledge-inject.mjs', edit('s3'), env(cache)).stdout, '');
  });

  it('caps one file at two lines across repeated edits', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    const more = ['aaa1', 'bbb2'].map((s) => ({ kind: 'knowledge', key: `knowledge::${s}@${REL}`, symbols: [s], text: `fact ${s}` }));
    seed(cache, 's5', FILE, [hotspot, knowledge, ...more]);
    const text = { file_path: FILE, old_string: 'drainAndWait aaa1 bbb2', new_string: 'x' };
    const lines = (out) => (out ? JSON.parse(out).hookSpecificOutput.additionalContext.split('\n').length - 1 : 0);
    assert.equal(lines(run('knowledge-inject.mjs', { ...edit('s5'), tool_input: text }, env(cache)).stdout), 2);
    assert.equal(run('knowledge-inject.mjs', { ...edit('s5'), tool_input: text }, env(cache)).stdout, '', 'second edit of the same file adds nothing');
  });

  it('stays silent when the symbol is not in the edit and the hotspot has not earned a line', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    seed(cache, 's4', FILE, [{ ...hotspot, confirmed: 1, regressed: 0 }, knowledge]);
    const out = run('knowledge-inject.mjs', { ...edit('s4'), tool_input: { file_path: FILE, old_string: 'a', new_string: 'b' } }, env(cache));
    assert.equal(out.stdout, '');
  });

  it('keeps the session budget under parallel edits', async () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    const e = env(cache);
    const files = Array.from({ length: 24 }, (_, i) => ({ file: `/r/src/f${i}.ts`, rel: `src/f${i}.ts` }));
    for (const { file, rel } of files) {
      seed(cache, 'par', file, [{ ...hotspot, key: `hotspot::${rel}` }], rel);
    }
    const outputs = await Promise.all(
      files.map(
        ({ file }) =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, [path.join(here, 'knowledge-inject.mjs')], { env: e });
            let out = '';
            child.stdout.on('data', (d) => (out += d));
            child.on('close', () => resolve(out));
            child.stdin.end(JSON.stringify({ session_id: 'par', tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: 'b' } }));
          }),
      ),
    );
    const state = JSON.parse(fs.readFileSync(path.join(sessionDir('par', { XDG_CACHE_HOME: cache }), 'state.json'), 'utf8'));
    assert.equal(outputs.filter(Boolean).length, MAX_LINES, 'exactly the budget is injected, not more');
    assert.equal(state.lines, MAX_LINES);
  });

  it('prefetch ignores non-Read calls and uninteresting paths, and marks a new file pending without waiting', () => {
    const cache = fs.mkdtempSync(path.join(tmp, 'cache-'));
    const read = (file, sessionId = 'r1') => ({ session_id: sessionId, cwd: tmp, tool_name: 'Read', tool_input: { file_path: file } });
    assert.equal(run('knowledge-prefetch.mjs', { ...read(FILE), tool_name: 'Edit' }, env(cache)).status, 0);
    assert.equal(run('knowledge-prefetch.mjs', read('/repo/assets/logo.png'), env(cache)).status, 0);
    assert.equal(fs.existsSync(path.join(cache, 'agent-skills')), false);

    // A repo cloned under `build/` is still prefetched: folder skips are repo-relative, so the worker decides.
    const underBuild = '/home/u/build/myrepo/src/a.ts';
    assert.equal(run('knowledge-prefetch.mjs', read(underBuild, 'r2'), env(cache)).status, 0);
    assert.ok(fs.existsSync(cacheFile(sessionDir('r2', { XDG_CACHE_HOME: cache }), underBuild)));

    const started = Date.now();
    const res = run('knowledge-prefetch.mjs', read(FILE), env(cache));
    assert.equal(res.status, 0);
    assert.ok(Date.now() - started < 1500, 'the hook returns without waiting for the worker');
    assert.ok(fs.existsSync(cacheFile(sessionDir('r1', { XDG_CACHE_HOME: cache }), FILE)));
  });
});
