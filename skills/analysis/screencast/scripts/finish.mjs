#!/usr/bin/env node
// screencast finish — raw Playwright video(s) + step timings → a reviewable mp4.
//
//   node finish.mjs <raw.webm>... --out <dir>/<id>.mp4 [--crop x,y,w,h] [--max-width 1280]
//                   [--no-trim] [--narrate]
//   node finish.mjs --self-test
//
// Each input may have a sibling <stem>.timings.json: [{ label, start, end, result, say? }],
// seconds from the start of that video. Several inputs are joined in order and their
// timings offset. Writes:
//   <id>.mp4            H.264, yuv420p, faststart — plays inline on GitHub and Safari
//   <id>.timings.json   { seconds, steps: [{ label, start, end, result }] } in output time
//   <id>.sheet.png      one frame per step, taken just before the step ends
// --no-trim keeps stretches where nothing on screen changes for over 2 s (cut by default).
// --narrate speaks each step's `say` line (macOS `say`, or $SCREENCAST_TTS with {text} and
// {out} placeholders) and mixes it in at the step's start.
//
// Exit codes: 0 ok · 2 bad arguments · 3 ffmpeg/ffprobe missing or the output failed the
// sanity check · 5 --narrate with no voice available.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const GAP = 2; // seconds of nothing-happening worth cutting
const KEEP_FROZEN = 0.8;
const FPS = 25;

function run(cmd, args, { capture = false } = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 6).join(' ')} … failed: ${(res.stderr || String(res.error)).slice(-600)}`);
  }
  return capture ? res.stdout.trim() : '';
}

const has = (cmd) => spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0;

function duration(file) {
  return Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { capture: true }));
}

function readTimings(file) {
  const t = file.replace(/\.(webm|mp4|mov)$/i, '.timings.json');
  if (!fs.existsSync(t)) return [];
  const data = JSON.parse(fs.readFileSync(t, 'utf8'));
  return Array.isArray(data) ? data : data.steps ?? [];
}

// Frozen stretches (nothing on screen changes) longer than GAP, from ffmpeg freezedetect,
// so a wait is cut wherever it happens — between steps or inside one. Each cut keeps
// KEEP_FROZEN seconds of the still so a viewer sees the wait happened.
function frozen(file) {
  const res = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-vf', `freezedetect=n=0.002:d=${GAP}`, '-f', 'null', '-'], { encoding: 'utf8' });
  const starts = [...res.stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...res.stderr.matchAll(/freeze_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return starts.map((a, i) => [a, ends[i] ?? Infinity]);
}

function keptRanges(cuts, total) {
  const ranges = [];
  let cursor = 0;
  for (const [a, b] of cuts.map(([a, b]) => [a + KEEP_FROZEN, Math.min(b, total) - 0.2]).filter(([a, b]) => b - a > 0.5)) {
    ranges.push([cursor, a]);
    cursor = b;
  }
  ranges.push([cursor, total]);
  return ranges;
}

function remap(t, ranges) {
  let offset = 0;
  for (const [a, b] of ranges) {
    if (t <= b) return offset + Math.max(0, t - a);
    offset += b - a;
  }
  return offset;
}

function speak(text, out) {
  const tpl = process.env.SCREENCAST_TTS;
  if (tpl) {
    const cmd = tpl.replaceAll('{text}', JSON.stringify(text)).replaceAll('{out}', JSON.stringify(out));
    return spawnSync('sh', ['-c', cmd]).status === 0 && fs.existsSync(out);
  }
  if (process.platform === 'darwin') {
    return spawnSync('say', ['-o', out, '--data-format=LEI16@22050', text]).status === 0 && fs.existsSync(out);
  }
  return false;
}

export function finish(inputs, opts) {
  if (!has('ffmpeg') || !has('ffprobe')) {
    console.error('screencast: ffmpeg and ffprobe are required (brew install ffmpeg).');
    process.exit(3);
  }
  const out = path.resolve(opts.out);
  const stem = out.replace(/\.mp4$/i, '');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'screencast-'));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // 1. Join inputs and offset their timings.
  let steps = [];
  const cuts = [];
  let offset = 0;
  for (const file of inputs) {
    for (const s of readTimings(file)) steps.push({ ...s, start: s.start + offset, end: s.end + offset });
    const length = duration(file);
    // A segment that ends on a still frame has no freeze_end: clamp it to this segment,
    // or the cut runs into the segments joined after it.
    if (opts.trim) for (const [a, b] of frozen(file)) cuts.push([a + offset, Math.min(b, length) + offset]);
    offset += length;
  }
  const total = offset;

  // 2. Build one filter graph: concat → constant fps → crop → trim → scale.
  const ranges = keptRanges(cuts, total);
  const chain = [];
  const concat = inputs.map((_, i) => `[${i}:v]fps=${FPS},setsar=1[v${i}]`).join(';');
  chain.push(`${concat};${inputs.map((_, i) => `[v${i}]`).join('')}concat=n=${inputs.length}:v=1:a=0[joined]`);
  let video = '[joined]';
  if (opts.crop) {
    const [x, y, w, h] = opts.crop.split(',').map((n) => Math.round(Number(n)));
    chain.push(`${video}crop=${w}:${h}:${x}:${y}[cropped]`);
    video = '[cropped]';
  }
  if (ranges.length > 1 || ranges[0][0] > 0 || ranges[0][1] < total) {
    const keep = ranges.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
    chain.push(`${video}select='${keep}',setpts=N/${FPS}/TB[trimmed]`);
    video = '[trimmed]';
  }
  const maxWidth = opts.maxWidth ?? 1280;
  chain.push(`${video}scale='min(${maxWidth},iw)':-2:flags=lanczos,format=yuv420p[vout]`);

  steps = steps.map((s) => ({ ...s, start: +remap(s.start, ranges).toFixed(2), end: +remap(s.end, ranges).toFixed(2) }));

  // 3. Optional narration: one clip per step with a `say` line, delayed to the step's start.
  const audioInputs = [];
  const audioChains = [];
  if (opts.narrate) {
    steps.forEach((s, i) => {
      if (!s.say) return;
      const clip = path.join(work, `say-${i}.wav`);
      if (!speak(s.say, clip)) {
        console.error('screencast: --narrate needs a voice: macOS `say`, or SCREENCAST_TTS="<cmd with {text} and {out}>".');
        process.exit(5);
      }
      const ms = Math.round((s.start + 0.2) * 1000);
      audioChains.push(`[${inputs.length + audioInputs.length}:a]adelay=${ms}|${ms}[a${audioInputs.length}]`);
      audioInputs.push(clip);
    });
  }

  const args = ['-y', '-loglevel', 'error'];
  for (const f of inputs) args.push('-i', f);
  for (const f of audioInputs) args.push('-i', f);
  let graph = chain.join(';');
  const maps = ['-map', '[vout]'];
  if (audioInputs.length) {
    graph += `;${audioChains.join(';')};${audioInputs.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audioInputs.length}:normalize=0,apad[aout]`;
    maps.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-shortest');
  }
  args.push('-filter_complex', graph, ...maps,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '15', '-movflags', '+faststart', out);
  run('ffmpeg', args);

  // 4. Sanity check: a real duration and a video stream, or it never goes to a PR.
  const seconds = duration(out);
  const streams = run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { capture: true });
  if (!(seconds > 0) || !streams.includes('video')) {
    console.error(`screencast: ${out} failed the sanity check (duration ${seconds}, streams "${streams}").`);
    process.exit(3);
  }

  // 5. Contact sheet: one frame per step just before it ends, or four even frames without timings.
  const times = steps.length
    ? steps.map((s) => Math.max(0, Math.min(s.end, seconds) - 0.3))
    : [0.2, 0.4, 0.6, 0.8].map((f) => f * seconds);
  times.forEach((t, i) => {
    run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', t.toFixed(2), '-i', out, '-frames:v', '1', '-vf', 'scale=480:-2',
      path.join(work, `frame-${String(i).padStart(3, '0')}.png`)]);
  });
  const sheet = `${stem}.sheet.png`;
  run('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', path.join(work, 'frame-*.png'),
    '-vf', `tile=4x${Math.max(1, Math.ceil(times.length / 4))}`, '-frames:v', '1', sheet]);

  const report = {
    out,
    sheet,
    seconds: +seconds.toFixed(2),
    bytes: fs.statSync(out).size,
    trimmed: +(total - seconds).toFixed(2),
    steps: steps.map(({ label, start, end, result }) => ({ label, start, end, result: result ?? 'ok' })),
  };
  fs.writeFileSync(`${stem}.timings.json`, JSON.stringify(report, null, 2));
  fs.rmSync(work, { recursive: true, force: true });
  return report;
}

function selfTest() {
  if (!has('ffmpeg') || !has('ffprobe')) {
    console.log('self-test SKIP (ffmpeg not installed)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screencast-test-'));
  const raw = path.join(dir, 'raw.webm');
  // 2 s of motion, a 5 s freeze (the wait), 2 s of motion: the freeze is cut, inside step 2.
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'color=c=gray:size=640x360:rate=25:duration=5', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libvpx', '-b:v', '300k', raw]);
  fs.writeFileSync(path.join(dir, 'raw.timings.json'), JSON.stringify([
    { label: 'open', start: 0, end: 1, result: 'pass' },
    { label: 'wait for data', start: 1, end: 7, result: 'pass' },
    { label: 'assert', start: 7, end: 8, result: 'fail' },
  ]));
  const r = finish([raw], { out: path.join(dir, 'spec-1.mp4'), trim: true });
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'spec-1.timings.json'), 'utf8'));
  const failures = [];
  if (!fs.existsSync(r.out)) failures.push('mp4 missing');
  if (!fs.existsSync(r.sheet)) failures.push('sheet missing');
  if (t.steps.length !== 3) failures.push(`expected 3 steps, got ${t.steps.length}`);
  if (!(r.seconds < 7)) failures.push(`wait not trimmed: ${r.seconds} s`);
  if (t.steps[2].start > r.seconds) failures.push('step 3 remapped past the end');
  // Two segments join, and the second's timings are offset.
  const seg2 = path.join(dir, 'seg-2.webm');
  fs.copyFileSync(raw, seg2);
  fs.writeFileSync(path.join(dir, 'seg-2.timings.json'), JSON.stringify([{ label: 'again', start: 0, end: 1 }]));
  const joined = finish([raw, seg2], { out: path.join(dir, 'joined.mp4'), trim: false });
  if (joined.steps.length !== 4 || joined.steps[3].start < 8.9) failures.push(`join offset wrong: ${JSON.stringify(joined.steps[3])}`);
  // A segment that ends frozen must not cut the segment after it.
  const tail = path.join(dir, 'tail.webm');
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=2',
    '-f', 'lavfi', '-i', 'color=c=gray:size=640x360:rate=25:duration=4',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libvpx', '-b:v', '300k', tail]);
  const after = path.join(dir, 'after.webm');
  run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=4', '-c:v', 'libvpx', '-b:v', '300k', after]);
  fs.writeFileSync(path.join(dir, 'after.timings.json'), JSON.stringify([{ label: 'b', start: 0, end: 4 }]));
  const kept = finish([tail, after], { out: path.join(dir, 'tail.mp4'), trim: true });
  if (!(kept.seconds > 6)) failures.push(`trailing freeze cut the next segment: ${kept.seconds} s`);
  if (failures.length) {
    console.error(`self-test FAIL: ${failures.join('; ')}`);
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`self-test PASS (trimmed ${r.trimmed} s, ${t.steps.length} steps, join ok)`);
}

function parseArgs(argv) {
  const opts = { trim: true };
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--crop') opts.crop = argv[++i];
    else if (a === '--max-width') opts.maxWidth = Number(argv[++i]);
    else if (a === '--no-trim') opts.trim = false;
    else if (a === '--narrate') opts.narrate = true;
    else if (a === '--self-test') opts.selfTest = true;
    else inputs.push(a);
  }
  return { inputs, opts };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { inputs, opts } = parseArgs(process.argv.slice(2));
  if (opts.selfTest) selfTest();
  else if (!inputs.length || !opts.out) {
    console.error('usage: finish.mjs <raw.webm>... --out <id>.mp4 [--crop x,y,w,h] [--max-width n] [--no-trim] [--narrate]');
    process.exit(2);
  } else console.log(JSON.stringify(finish(inputs, opts), null, 2));
}
