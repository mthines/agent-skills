#!/usr/bin/env node
// screencast record — play a recording.json with the overlay on, then finish it.
//
//   node record.mjs <recording.json> [--narrate]     (run from a directory where `playwright` resolves)
//   node record.mjs --self-test
//
// recording.json:
//   {
//     "url": "http://localhost:3000/settings",
//     "id": "mute-channel",                         // output name; default "recording"
//     "out": ".agent/<branch>/recordings",          // default: .agent/<current branch>/recordings
//     "viewport": { "width": 1280, "height": 720 },
//     "crop": "[data-testid=channel-list]",         // optional: crop the video to this element
//     "maxWidth": 1280, "reducedMotion": false, "storageState": ".auth/local.json",
//     "scenes": [
//       { "caption": "Mute the #alerts channel", "say": "optional narration",
//         "steps": [ { "click": "role=switch[name=\"Mute #alerts\"]" }, { "wait": 800 } ], "hold": 1200 }
//     ]
//   }
// Steps: { click | hover: <selector> }, { type: <selector>, text }, { press: <key> },
//        { scroll: <selector> } (wheels until it sits 30% down), { scroll: { by: <px> } }, { wait: <ms> }.
// Selectors are Playwright selector strings (role=…, text=…, css).
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { finish } from './finish.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadPlaywright() {
  try {
    return createRequire(path.join(process.cwd(), 'noop.js'))('playwright');
  } catch {
    console.error('screencast: `playwright` does not resolve from this directory. Run from a project that has it, or `npm i playwright` in a scratch dir and run from there.');
    process.exit(4);
  }
}

function branchDir() {
  const b = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).stdout.trim() || 'detached';
  return path.join('.agent', b, 'recordings');
}

async function scroll(page, target) {
  const view = page.viewportSize();
  await page.mouse.move(view.width * 0.6, view.height * 0.55);
  if (typeof target === 'object' && typeof target.by === 'number') {
    for (let left = target.by; left !== 0; ) {
      const d = Math.sign(left) * Math.min(Math.abs(left), 60);
      await page.mouse.wheel(0, d);
      left -= d;
      await page.waitForTimeout(25);
    }
    return;
  }
  // Wheel, not scrollIntoView: it is visible on camera and reaches inner scroll panes.
  const loc = page.locator(target).first();
  for (let i = 0; i < 200; i++) {
    const box = await loc.boundingBox();
    if (!box) break;
    const delta = box.y - view.height * 0.3;
    if (Math.abs(delta) < 30) break;
    await page.mouse.wheel(0, Math.sign(delta) * Math.min(Math.abs(delta), 60));
    await page.waitForTimeout(20);
    if ((await loc.boundingBox())?.y === box.y) break;
  }
}

async function step(page, s) {
  if (s.click || s.hover) {
    const loc = page.locator(s.click ?? s.hover).first();
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const box = await loc.boundingBox();
    // Glide the mouse so the overlay cursor visibly travels to the target.
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
    return s.click ? loc.click() : loc.hover();
  }
  if (s.type) return page.locator(s.type).first().pressSequentially(s.text ?? '', { delay: 40 });
  if (s.press) return page.keyboard.press(s.press);
  if (s.scroll) return scroll(page, s.scroll);
  if (s.wait) return page.waitForTimeout(s.wait);
  throw new Error(`unknown step: ${JSON.stringify(s)}`);
}

export async function record(spec, { narrate = false } = {}) {
  const { chromium } = loadPlaywright();
  const viewport = spec.viewport ?? { width: 1280, height: 720 };
  const outDir = path.resolve(spec.out ?? branchDir());
  const id = spec.id ?? 'recording';
  const raw = fs.mkdtempSync(path.join(os.tmpdir(), 'screencast-raw-'));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1, // Playwright video ignores DPR: a 2x page lands in a corner of the frame
    recordVideo: { dir: raw, size: viewport },
    reducedMotion: spec.reducedMotion ? 'reduce' : 'no-preference',
    ...(spec.storageState && fs.existsSync(spec.storageState) ? { storageState: spec.storageState } : {}),
  });
  await context.addInitScript({ path: path.join(HERE, 'overlay.js') });
  const page = await context.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;

  const steps = [];
  let crop;
  try {
    await page.goto(spec.url, { waitUntil: 'load' });
    for (const scene of spec.scenes ?? []) {
      await page.evaluate((label) => window.__rec?.step(label), scene.caption ?? '');
      const entry = { label: scene.caption ?? '', start: now(), result: 'ok', ...(scene.say ? { say: scene.say } : {}) };
      try {
        for (const s of scene.steps ?? []) await step(page, s);
      } catch (e) {
        entry.result = `error: ${String(e.message ?? e).split('\n')[0].slice(0, 200)}`;
      }
      await page.waitForTimeout(scene.hold ?? 1200);
      entry.end = now();
      steps.push(entry);
      if (entry.result !== 'ok') break;
    }
    if (spec.crop) {
      const box = await page.locator(spec.crop).first().boundingBox();
      if (box) crop = [box.x, box.y, box.width, box.height].map((n) => Math.max(0, Math.round(n))).join(',');
    }
  } finally {
    const video = page.video();
    await context.close(); // the video is finalized on close; saveAs needs the browser still open
    await video?.saveAs(path.join(raw, `${id}.webm`));
    await browser.close();
  }
  fs.writeFileSync(path.join(raw, `${id}.timings.json`), JSON.stringify(steps));
  const report = finish([path.join(raw, `${id}.webm`)], { out: path.join(outDir, `${id}.mp4`), crop, maxWidth: spec.maxWidth, trim: true, narrate });
  fs.rmSync(raw, { recursive: true, force: true });
  return report;
}

async function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screencast-rec-'));
  const html = path.join(dir, 'page.html');
  fs.writeFileSync(html, `<!doctype html><title>t</title><body style="font:20px system-ui;padding:40px">
    <button id="b" onclick="this.textContent='Saved'">Save</button><input id="i" placeholder="Name"></body>`);
  const r = await record({
    url: `file://${html}`, id: 'smoke', out: dir,
    scenes: [
      { caption: 'Type a name', steps: [{ type: '#i', text: 'Ada' }], hold: 300 },
      { caption: 'Save it', steps: [{ click: 'text=Save' }], hold: 300 },
    ],
  });
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'smoke.timings.json'), 'utf8'));
  const failures = [];
  for (const f of ['smoke.mp4', 'smoke.timings.json', 'smoke.sheet.png']) if (!fs.existsSync(path.join(dir, f))) failures.push(`${f} missing`);
  if (t.steps.length !== 2) failures.push(`expected 2 steps, got ${t.steps.length}`);
  if (t.steps.some((s) => s.result !== 'ok')) failures.push(`a step failed: ${JSON.stringify(t.steps)}`);
  if (failures.length) {
    console.error(`self-test FAIL: ${failures.join('; ')}`);
    process.exit(1);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`self-test PASS (${r.seconds} s, ${t.steps.length} steps)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) await selfTest();
  else if (!args[0] || args[0].startsWith('--')) {
    console.error('usage: record.mjs <recording.json> [--narrate] | --self-test');
    process.exit(2);
  } else {
    const spec = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    console.log(JSON.stringify(await record(spec, { narrate: args.includes('--narrate') }), null, 2));
  }
}
