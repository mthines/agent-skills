#!/usr/bin/env node
// screencast capture — record a tab of a running Chrome as video over the DevTools protocol, for
// drivers with no Playwright recordVideo (claude-in-chrome), then finish it like any other recording.
//
//   node capture.mjs start --out <dir>/<id>.mp4 --url <part of the tab's URL> [--port <n>] [--wait 60]
//   node capture.mjs launch [--port 9222] [--profile <dir>]   a separate Chrome with a DevTools port
//   node capture.mjs step "<label>" --out <dir>/<id>.mp4
//   node capture.mjs stop --out <dir>/<id>.mp4 [--result pass|fail] [-- <finish.mjs flags>]
//   node capture.mjs --self-test
//
// start finds the browser's DevTools endpoint: the user's own Chrome when remote debugging is on in
// chrome://inspect/#remote-debugging (read from its DevToolsActivePort file), else --port. It attaches
// to the tab whose URL contains --url and streams its rendered frames (Page.startScreencast) to disk
// from a background process; the window may be hidden or covered.
// step closes the open step and opens the next. stop closes the last step, ends the stream, joins
// the frames at their real timestamps, writes the timings, and runs finish.mjs, so the outputs are
// the same <id>.mp4, <id>.timings.json and <id>.sheet.png as a Playwright recording.
//
// Exit codes: 0 ok · 2 bad arguments or no capture running · 3 ffmpeg missing or encoding failed ·
// 6 no DevTools port, no matching tab, or no frames (the caller falls back to gif_creator).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 9222;
const DEFAULT_PROFILE = path.join(os.homedir(), '.agents', 'aw', 'chrome-profile');
const LAST_FRAME_SECONDS = 0.5;

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

// The background process: attach to the tab and stream frames until SIGTERM. Each frame is acked,
// or Chrome stops sending. status.json tells start which tab it got, or why it got none.
async function record(ws, urlPart, dir) {
  const socket = new WebSocket(ws);
  const status = (value) => fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(value));
  const pending = new Map();
  let id = 0;
  let count = 0;
  let session;
  const send = (method, params = {}, sessionId = session) => new Promise((resolve) => {
    pending.set(++id, resolve);
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const index = fs.openSync(path.join(dir, 'frames.jsonl'), 'a');
  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method !== 'Page.screencastFrame') return;
    const { data, metadata, sessionId } = msg.params;
    const file = `${String(count++).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(data, 'base64'));
    fs.writeSync(index, `${JSON.stringify({ file, t: metadata.timestamp ?? Date.now() / 1000 })}\n`);
    send('Page.screencastFrameAck', { sessionId });
  });
  socket.addEventListener('open', async () => {
    const { result, error } = await send('Target.getTargets', {}, null);
    if (error) return status({ error: error.message });
    const target = result.targetInfos.find((t) => t.type === 'page' && t.url.includes(urlPart));
    if (!target) return status({ error: `no tab whose URL contains "${urlPart}"` });
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null);
    if (attached.error) return status({ error: attached.error.message });
    session = attached.result.sessionId;
    await send('Page.enable');
    await send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1920, everyNthFrame: 1 });
    status({ title: target.title, url: target.url });
  });
  const close = async () => {
    if (session) await Promise.race([send('Page.stopScreencast'), sleep(500)]);
    process.exit(0);
  };
  process.on('SIGTERM', close);
  socket.addEventListener('close', () => {
    if (!fs.existsSync(path.join(dir, 'status.json'))) status({ error: 'Chrome closed the DevTools connection (was "Allow" declined?)' });
    process.exit(0);
  });
  socket.addEventListener('error', () => {
    status({ error: `cannot connect to ${ws}` });
    process.exit(1);
  });
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

async function start(out, port, urlPart, waitSeconds) {
  if (spawnSync('ffmpeg', ['-version']).status !== 0) fail(3, 'ffmpeg is not installed');
  if (fs.existsSync(stateFile(out))) fail(2, `a capture for ${out} is already running; stop it first`);
  const ws = await browserEndpoint(port);
  if (!ws) fail(6, port
    ? `no Chrome DevTools on port ${port}`
    : 'no Chrome with remote debugging — turn it on at chrome://inspect/#remote-debugging, or `capture.mjs launch` and pass --port');

  const dir = framesDir(out);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '_record', ws, urlPart, dir],
    { detached: true, stdio: ['ignore', 'ignore', fs.openSync(path.join(dir, 'record.log'), 'w')] });
  child.unref();

  // The first connection to the user's own Chrome waits for them to click Allow.
  const statusPath = path.join(dir, 'status.json');
  for (let i = 0; i < waitSeconds * 10 && !(fs.existsSync(statusPath) && readFrames(dir).length); i += 1) {
    if (fs.existsSync(statusPath) && JSON.parse(fs.readFileSync(statusPath, 'utf8')).error) break;
    await sleep(100);
  }
  const status = fs.existsSync(statusPath) ? JSON.parse(fs.readFileSync(statusPath, 'utf8')) : { error: `no answer from Chrome in ${waitSeconds}s (Allow not clicked?)` };
  const frames = readFrames(dir);
  if (status.error || frames.length === 0) {
    try { process.kill(child.pid, 'SIGTERM'); } catch {}
    fail(6, status.error ?? `no frames from "${status.title}" — is its window minimized?`);
  }
  fs.writeFileSync(stateFile(out), JSON.stringify({ pid: child.pid, dir, startedAt: frames[0].t, steps: [] }, null, 2));
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
  const stoppedAt = Date.now() / 1000;
  try { process.kill(state.pid, 'SIGTERM'); } catch {}
  for (let i = 0; i < 50; i += 1) {
    try { process.kill(state.pid, 0); } catch { break; }
    await sleep(100);
  }
  fs.rmSync(stateFile(out));

  const frames = readFrames(state.dir);
  if (frames.length === 0) fail(6, 'no frames were recorded');
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
  fs.writeFileSync(timings, JSON.stringify(state.steps, null, 2));

  const res = spawnSync(process.execPath, [path.join(HERE, 'finish.mjs'), raw, '--out', out, ...finishArgs], { stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 3);
  for (const f of [raw, timings]) fs.rmSync(f, { force: true });
  fs.rmSync(state.dir, { recursive: true, force: true });
}

function selfTest() {
  const list = concatList([{ file: 'a.jpg', t: 10 }, { file: 'b.jpg', t: 10.25 }, { file: 'c.jpg', t: 12 }], 13);
  const want = "ffconcat version 1.0\nfile 'a.jpg'\nduration 0.250\nfile 'b.jpg'\nduration 1.750\nfile 'c.jpg'\nduration 1.000\nfile 'c.jpg'\n";
  const ok = list === want && concatList([], 1) === 'ffconcat version 1.0\n';
  console.log(ok ? 'self-test PASS (frames keep their real durations)' : `self-test FAIL:\n${list}`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--self-test') selfTest();
  if (argv[0] === '_record') await record(argv[1], argv[2], argv[3]);
  else {
    const split = argv.indexOf('--');
    const own = split === -1 ? argv : argv.slice(0, split);
    const finishArgs = split === -1 ? [] : argv.slice(split + 1);
    const [command, ...rest] = own;
    const at = (flag) => (rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined);
    const port = at('--port') ? Number(at('--port')) : undefined;
    if (command === 'launch') await launch(port ?? DEFAULT_PORT, at('--profile') ?? DEFAULT_PROFILE);
    else {
      const out = at('--out');
      if (!out || !/\.mp4$/i.test(out)) fail(2, 'usage: capture.mjs launch | start --url <part> | step "<label>" | stop — each with --out <dir>/<id>.mp4');
      if (command === 'start') {
        if (!at('--url')) fail(2, 'start needs --url <part of the tab URL>');
        await start(out, port, at('--url'), Number(at('--wait') ?? 60));
      } else if (command === 'step') step(out, rest.find((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--')) ?? '');
      else if (command === 'stop') await stop(out, at('--result'), finishArgs);
      else fail(2, `unknown command "${command}"`);
    }
  }
}
