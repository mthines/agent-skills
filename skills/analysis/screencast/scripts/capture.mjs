#!/usr/bin/env node
// screencast capture — record a tab of a running Chrome as video over the DevTools protocol, for
// drivers with no Playwright recordVideo (claude-in-chrome), then finish it like any other recording.
//
//   node capture.mjs start --out <dir>/<id>.mp4 --url <part of the tab's URL> [--port <n>] [--wait 60]
//   node capture.mjs launch [--port 9222] [--profile <dir>]   a separate Chrome with a DevTools port
//   node capture.mjs step "<label>" --out <dir>/<id>.mp4
//   node capture.mjs stop --out <dir>/<id>.mp4 [--result pass|fail] [-- <finish.mjs flags>]
//   node capture.mjs disconnect                                close the relay's connection to Chrome
//   node capture.mjs --self-test
//
// start finds the browser's DevTools endpoint: the user's own Chrome when remote debugging is on in
// chrome://inspect/#remote-debugging (read from its DevToolsActivePort file), else --port. A relay
// process holds one connection to that browser until Chrome quits or `disconnect`, so the user clicks
// Allow once per Chrome session, not once per recording. start asks the relay to attach to the tab
// whose URL contains --url and stream its rendered frames (Page.startScreencast) to disk. Keep the
// window un-minimized: Chrome stops painting a minimized one.
// step closes the open step and opens the next. stop closes the last step, ends the stream, joins
// the frames at their real timestamps, writes the timings, and runs finish.mjs, so the outputs are
// the same <id>.mp4, <id>.timings.json and <id>.sheet.png as a Playwright recording.
//
// Exit codes: 0 ok · 2 bad arguments or no capture running · 3 ffmpeg missing or encoding failed ·
// 6 no DevTools port, no matching tab, or no frames (the caller falls back to gif_creator).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 9222;
const DEFAULT_PROFILE = path.join(os.homedir(), '.agents', 'aw', 'chrome-profile');
const LAST_FRAME_SECONDS = 0.5;
const RELAY_DIR = path.join(os.homedir(), '.agents', 'aw');
const RELAY_FILE = path.join(RELAY_DIR, 'screencast-relay.json');
// A Unix socket path is capped near 104 bytes, so it lives under the short RELAY_DIR.
const RELAY_SOCKET = process.platform === 'win32' ? '\\\\.\\pipe\\screencast-relay' : path.join(RELAY_DIR, 'screencast-relay.sock');

const stateFile = (out) => out.replace(/\.mp4$/i, '.capture.json');
const framesDir = (out) => out.replace(/\.mp4$/i, '.frames');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(code, message) {
  console.error(`screencast capture: ${message}`);
  process.exit(code);
}

async function devtools(port, route) {
  for (const host of ['127.0.0.1', '[::1]']) {
    try {
      const res = await fetch(`http://${host}:${port}${route}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return await res.json();
    } catch {}
  }
  return undefined;
}

const PROFILE_DIRS = {
  darwin: ['Library/Application Support/Google/Chrome', 'Library/Application Support/Google/Chrome Canary', 'Library/Application Support/Chromium'],
  linux: ['.config/google-chrome', '.config/chromium'],
  win32: ['AppData/Local/Google/Chrome/User Data'],
};

// Chrome's own remote debugging (chrome://inspect) serves no /json routes, only the browser
// socket named in DevToolsActivePort; Chrome asks the user to allow each new connection.
export async function browserEndpoint(port) {
  if (port) {
    const version = await devtools(port, '/json/version');
    return version?.webSocketDebuggerUrl;
  }
  for (const dir of PROFILE_DIRS[process.platform] ?? []) {
    const file = path.join(os.homedir(), dir, 'DevToolsActivePort');
    if (!fs.existsSync(file)) continue;
    const [filePort, wsPath] = fs.readFileSync(file, 'utf8').split('\n');
    if (filePort && wsPath) return `ws://127.0.0.1:${filePort.trim()}${wsPath.trim()}`;
  }
  return undefined;
}

async function launch(port, profile) {
  if (await devtools(port, '/json/version')) {
    console.log(`Chrome already serves DevTools on port ${port}`);
    return;
  }
  // Chrome refuses a DevTools port on the default profile, so the session uses its own.
  fs.mkdirSync(profile, { recursive: true });
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run'];
  if (process.platform === 'darwin') spawn('open', ['-na', 'Google Chrome', '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
  else spawn(process.env.CHROME_BIN ?? 'google-chrome', args, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50; i += 1) {
    if (await devtools(port, '/json/version')) {
      console.log(`Chrome serves DevTools on port ${port} (profile ${profile})`);
      return;
    }
    await sleep(200);
  }
  fail(6, `Chrome did not open DevTools on port ${port}`);
}

export function matchTarget(targets, urlPart) {
  const matches = targets.filter((t) => t.type === 'page' && t.url.includes(urlPart));
  if (matches.length === 0) return { error: `no tab whose URL contains "${urlPart}"` };
  if (matches.length > 1) return { error: `${matches.length} tabs match "${urlPart}" (${matches.map((t) => t.url).join(', ')}); pass a longer --url` };
  return { target: matches[0] };
}

const REPAINT = `(() => {
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none';
  document.documentElement.append(dot);
  requestAnimationFrame(() => requestAnimationFrame(() => dot.remove()));
})()`;

function writeAtomic(file, value) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}

// The background relay: one DevTools connection, many recordings, each keyed by its frames dir.
// Every frame is acked, or Chrome stops sending. It exits when Chrome closes the connection.
async function relay(ws) {
  const socket = new WebSocket(ws);
  const pending = new Map();
  const recordings = new Map();
  let id = 0;
  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    pending.set(++id, resolve);
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const announce = (value) => writeAtomic(RELAY_FILE, { pid: process.pid, ws, socket: RELAY_SOCKET, ...value });
  const exit = (code) => {
    for (const rec of recordings.values()) fs.closeSync(rec.index);
    if (process.platform !== 'win32') fs.rmSync(RELAY_SOCKET, { force: true });
    process.exit(code);
  };
  const end = async (sessionId) => {
    const rec = recordings.get(sessionId);
    if (!rec) return;
    recordings.delete(sessionId);
    await Promise.race([send('Page.stopScreencast', {}, sessionId), sleep(500)]);
    await Promise.race([send('Target.detachFromTarget', { sessionId }), sleep(500)]);
    fs.closeSync(rec.index);
  };

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Target.detachedFromTarget') {
      const rec = recordings.get(msg.params.sessionId);
      if (rec) fs.closeSync(rec.index);
      recordings.delete(msg.params.sessionId);
      return;
    }
    if (msg.method !== 'Page.screencastFrame') return;
    const rec = recordings.get(msg.sessionId);
    // params.sessionId numbers the frame for its ack; msg.sessionId is the tab's session.
    const { data, metadata, sessionId: frame } = msg.params;
    if (rec) {
      try {
        const file = `${String(rec.count++).padStart(6, '0')}.jpg`;
        fs.writeFileSync(path.join(rec.dir, file), Buffer.from(data, 'base64'));
        fs.writeSync(rec.index, `${JSON.stringify({ file, t: metadata.timestamp ?? Date.now() / 1000 })}\n`);
      } catch {
        // Its frames dir is gone; end that recording, never the shared connection.
        end(msg.sessionId);
        return;
      }
    }
    send('Page.screencastFrameAck', { sessionId: frame }, msg.sessionId);
  });

  const routes = {
    async '/start'({ urlPart, dir }) {
      const { result, error } = await send('Target.getTargets');
      if (error) return { error: error.message };
      const { target, error: noMatch } = matchTarget(result.targetInfos, urlPart);
      if (noMatch) return { error: noMatch };
      const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
      if (attached.error) return { error: attached.error.message };
      const session = attached.result.sessionId;
      recordings.set(session, { dir, count: 0, index: fs.openSync(path.join(dir, 'frames.jsonl'), 'a') });
      await send('Page.enable', {}, session);
      await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1920, everyNthFrame: 1 }, session);
      // Chrome sends a frame only when the page repaints, so a still page would send none until someone acts.
      const rec = recordings.get(session);
      for (let i = 0; i < 20 && rec.count === 0; i += 1) {
        await send('Runtime.evaluate', { expression: REPAINT }, session);
        await sleep(250);
      }
      return { title: target.title, url: target.url };
    },
    async '/stop'({ dir }) {
      for (const [session, rec] of recordings) if (rec.dir === dir) await end(session);
      return { ok: true };
    },
    async '/health'() {
      return { ws, recordings: [...recordings.values()].map((rec) => rec.dir) };
    },
    async '/disconnect'() {
      setTimeout(() => socket.close(), 50);
      return { ok: true };
    },
  };

  socket.addEventListener('open', () => {
    if (process.platform !== 'win32') fs.rmSync(RELAY_SOCKET, { force: true });
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        const route = routes[req.url];
        const reply = route ? await route(body ? JSON.parse(body) : {}).catch((error) => ({ error: error.message })) : { error: `no route ${req.url}` };
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reply));
      });
    });
    server.listen(RELAY_SOCKET, () => announce({ state: 'connected' }));
  });
  socket.addEventListener('close', () => {
    announce({ state: 'closed', error: 'Chrome closed the DevTools connection (was "Allow" declined, or did Chrome quit?)' });
    exit(0);
  });
  socket.addEventListener('error', () => {
    announce({ state: 'closed', error: `cannot connect to ${ws}` });
    exit(1);
  });
}

function ask(route, body = {}, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const req = http.request({ socketPath: RELAY_SOCKET, path: route, method: 'POST', timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: 'unreadable relay reply' }); } });
    });
    req.on('timeout', () => req.destroy(new Error('relay did not answer')));
    req.on('error', (error) => resolve({ error: error.message }));
    req.end(JSON.stringify(body));
  });
}

const readRelay = () => {
  try { return JSON.parse(fs.readFileSync(RELAY_FILE, 'utf8')); } catch { return undefined; }
};

// Reuses the relay already connected to this browser, so only the first recording waits for Allow.
async function ensureRelay(ws, waitSeconds) {
  const known = readRelay();
  if (known?.state === 'connected' && isAlive(known.pid)) {
    if (known.ws === ws && !(await ask('/health')).error) return;
    // Chrome restarted (a new browser id) or the relay stopped answering.
    try { process.kill(known.pid, 'SIGTERM'); } catch {}
  }
  fs.mkdirSync(RELAY_DIR, { recursive: true });
  fs.rmSync(RELAY_FILE, { force: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '_relay', ws],
    { detached: true, stdio: ['ignore', 'ignore', fs.openSync(path.join(RELAY_DIR, 'screencast-relay.log'), 'w')] });
  child.unref();
  console.error('screencast capture: connecting to Chrome — click Allow if it asks (once per Chrome session)');
  for (let i = 0; i < waitSeconds * 10; i += 1) {
    const info = readRelay();
    if (info?.pid === child.pid && info.state === 'connected') return;
    if (info?.pid === child.pid && info.error) fail(6, info.error);
    if (!isAlive(child.pid)) fail(6, `the relay exited; see ${path.join(RELAY_DIR, 'screencast-relay.log')}`);
    await sleep(100);
  }
  try { process.kill(child.pid, 'SIGTERM'); } catch {}
  fail(6, `no answer from Chrome in ${waitSeconds}s (Allow not clicked?)`);
}

async function disconnect() {
  const known = readRelay();
  if (known?.state !== 'connected' || !isAlive(known.pid)) return console.log('no relay is connected');
  if ((await ask('/disconnect')).error) try { process.kill(known.pid, 'SIGTERM'); } catch {}
  console.log('relay disconnected from Chrome');
}

function readFrames(dir) {
  const index = path.join(dir, 'frames.jsonl');
  if (!fs.existsSync(index)) return [];
  return fs.readFileSync(index, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// ffmpeg's concat demuxer plays each frame for the gap to the next one, so the video keeps
// real time even though Chrome only sends a frame when the page repaints.
export function concatList(frames, stoppedAt) {
  const lines = ['ffconcat version 1.0'];
  frames.forEach((frame, i) => {
    const next = frames[i + 1]?.t ?? Math.max(stoppedAt, frame.t + LAST_FRAME_SECONDS);
    lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(3)}`);
  });
  // The demuxer ignores the last entry's duration unless the file is listed once more.
  if (frames.length) lines.push(`file '${frames.at(-1).file}'`);
  return `${lines.join('\n')}\n`;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function start(out, port, urlPart, waitSeconds) {
  for (const tool of ['ffmpeg', 'ffprobe']) if (spawnSync(tool, ['-version']).status !== 0) fail(3, `${tool} is not installed`);
  const dir = framesDir(out);
  if (fs.existsSync(stateFile(out))) {
    const health = isAlive(readRelay()?.pid) ? await ask('/health') : {};
    if (health.recordings?.includes(path.resolve(dir))) fail(2, `a capture for ${out} is already running; stop it first`);
    console.error(`screencast capture: replacing a stale capture for ${out}`);
    fs.rmSync(stateFile(out));
  }
  const ws = await browserEndpoint(port);
  if (!ws) fail(6, port
    ? `no Chrome DevTools on port ${port}`
    : 'no Chrome with remote debugging — turn it on at chrome://inspect/#remote-debugging, or `capture.mjs launch` and pass --port');
  await ensureRelay(ws, waitSeconds);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = Date.now() / 1000;
  const status = await ask('/start', { urlPart, dir: path.resolve(dir) }, 15000);
  if (status.error) fail(6, status.error);
  if (readFrames(dir).length === 0) console.error('screencast capture: no frames yet — Chrome paints only while its window is visible; the video starts at the first frame');
  fs.writeFileSync(stateFile(out), JSON.stringify({ dir: path.resolve(dir), startedAt, steps: [] }, null, 2));
  console.log(`capture started: "${status.title}" → ${dir}`);
}

function readState(out) {
  if (!fs.existsSync(stateFile(out))) fail(2, `no capture running for ${out}`);
  return JSON.parse(fs.readFileSync(stateFile(out), 'utf8'));
}

function closeOpenStep(state, result) {
  const open = state.steps.at(-1);
  if (open && open.end == null) {
    open.end = +(Date.now() / 1000 - state.startedAt).toFixed(2);
    open.result = result ?? open.result ?? 'pass';
  }
}

function step(out, label) {
  const state = readState(out);
  closeOpenStep(state);
  state.steps.push({ label, start: +(Date.now() / 1000 - state.startedAt).toFixed(2) });
  fs.writeFileSync(stateFile(out), JSON.stringify(state, null, 2));
}

async function stop(out, result, finishArgs) {
  const state = readState(out);
  closeOpenStep(state, result);
  const stoppedAt = state.stoppedAt ?? Date.now() / 1000;
  // A relay that is gone already stopped streaming; the frames on disk are all there is.
  if (isAlive(readRelay()?.pid)) await ask('/stop', { dir: state.dir });
  // The state file stays until the encode succeeds, so a failed stop can be re-run on the same frames.
  state.steps.forEach((s) => { s.end ??= +(stoppedAt - state.startedAt).toFixed(2); });
  fs.writeFileSync(stateFile(out), JSON.stringify({ ...state, stoppedAt }, null, 2));

  const frames = readFrames(state.dir);
  if (frames.length === 0) fail(6, 'no frames were recorded — was the Chrome window hidden the whole time?');
  const steps = alignSteps(state.steps, frames[0].t - state.startedAt);
  fs.writeFileSync(path.join(state.dir, 'frames.ffconcat'), concatList(frames, stoppedAt));
  const raw = out.replace(/\.mp4$/i, '.raw.mkv');
  // Frames can change size when the window does; fit them all to the first frame's size.
  const size = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0',
    path.join(state.dir, frames[0].file)], { encoding: 'utf8' }).stdout.trim().split(',').map((n) => Number(n) & ~1);
  const [w, h] = size;
  const encode = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(state.dir, 'frames.ffconcat'),
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', raw], { encoding: 'utf8' });
  if (encode.status !== 0) fail(3, `joining frames failed: ${encode.stderr.slice(-400)}`);
  const timings = raw.replace(/\.mkv$/i, '.timings.json');
  fs.writeFileSync(timings, JSON.stringify(steps, null, 2));

  const res = spawnSync(process.execPath, [path.join(HERE, 'finish.mjs'), raw, '--out', out, ...finishArgs], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 3);
  for (const f of [raw, timings, stateFile(out)]) fs.rmSync(f, { force: true });
  fs.rmSync(state.dir, { recursive: true, force: true });
}

// Steps are timed from start, the video from its first frame, which comes later when Chrome waited to paint.
export function alignSteps(steps, lateBy) {
  const shift = (t) => +Math.max(0, t - Math.max(0, lateBy)).toFixed(2);
  return steps.map((s) => ({ ...s, start: shift(s.start), end: shift(s.end) }));
}

function selfTest() {
  const list = concatList([{ file: 'a.jpg', t: 10 }, { file: 'b.jpg', t: 10.25 }, { file: 'c.jpg', t: 12 }], 13);
  const want = "ffconcat version 1.0\nfile 'a.jpg'\nduration 0.250\nfile 'b.jpg'\nduration 1.750\nfile 'c.jpg'\nduration 1.000\nfile 'c.jpg'\n";
  const tabs = [{ type: 'page', url: 'http://localhost:3000/slos' }, { type: 'page', url: 'https://preview.example/slos' }, { type: 'iframe', url: 'http://localhost:3000/x' }];
  const picks = matchTarget(tabs, 'localhost:3000/slos').target === tabs[0]
    && /2 tabs match/.test(matchTarget(tabs, '/slos').error) && /no tab/.test(matchTarget(tabs, 'localhost:3000/x').error);
  const aligned = alignSteps([{ label: 'a', start: 1, end: 4 }, { label: 'b', start: 4, end: 6 }], 2);
  const lines = aligned[0].start === 0 && aligned[0].end === 2 && aligned[1].start === 2 && aligned[1].end === 4;
  const ok = list === want && concatList([], 1) === 'ffconcat version 1.0\n' && picks && lines;
  console.log(ok ? 'self-test PASS (frames keep their real durations; one tab per --url)' : `self-test FAIL:\n${list}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') selfTest();
  if (argv[0] === '_relay') await relay(argv[1]);
  else {
    const split = argv.indexOf('--');
    const own = split === -1 ? argv : argv.slice(0, split);
    const finishArgs = split === -1 ? [] : argv.slice(split + 1);
    const [command, ...rest] = own;
    const at = (flag) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined);
    const number = (flag) => {
      if (!at(flag)) return undefined;
      const n = Number(at(flag));
      if (!Number.isInteger(n) || n <= 0) fail(2, `${flag} must be a positive whole number, got "${at(flag)}"`);
      return n;
    };
    const port = number('--port');
    if (command === 'launch') await launch(port ?? DEFAULT_PORT, at('--profile') ?? DEFAULT_PROFILE);
    else if (command === 'disconnect') await disconnect();
    else {
      const out = at('--out');
      if (!out || !/\.mp4$/i.test(out)) fail(2, 'usage: capture.mjs launch | disconnect | start --url <part> | step "<label>" | stop — the last three with --out <dir>/<id>.mp4');
      if (command === 'start') {
        if (!at('--url')) fail(2, 'start needs --url <part of the tab URL>');
        await start(out, port, at('--url'), number('--wait') ?? 60);
      } else if (command === 'step') step(out, rest.find((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--')) ?? '');
      else if (command === 'stop') await stop(out, at('--result'), finishArgs);
      else fail(2, `unknown command "${command}"`);
    }
  }
}
