#!/usr/bin/env node
// render-png.mjs — renders an impact-map page's legend and diagram to PNG, light and dark.
//
// Usage:
//   node render-png.mjs <page.html> <out-dir>
//   node render-png.mjs --self-test
//
// Writes <out-dir>/what-changes-light.png and <out-dir>/what-changes-dark.png at 2x scale.
// The page must come from templates/page.html: the renderer reuses its <style>, the
// first .legend, and the first <svg> inside .fig-scroll, and forces each theme through
// the stylesheet's [data-theme] tokens.
// Exit codes: 0 ok · 1 render or self-test failure · 2 usage error / no browser.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PAGE_WIDTH = 948;   // 900-wide viewBox + 24px side padding.
const SVG_WIDTH = 866;    // PAGE_WIDTH − 48 padding − 32 box padding − 2 border.
const CHROME_FIXED = 112; // 20 top + ~24 legend + 14 gap + 2 border + 32 box padding + 20 bottom.

export function extract(html) {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  const fonts = /<link rel="stylesheet"[^>]+>/.exec(html)?.[0] ?? "";
  const legend = /<div class="legend">[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
  const svg = /<div class="fig-scroll">\s*(<svg[\s\S]*?<\/svg>)/.exec(html)?.[1];
  const box = svg && /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!style || !svg || !box) return null;
  const height = Math.ceil(CHROME_FIXED + (SVG_WIDTH * Number(box[2])) / Number(box[1]));
  return { style, fonts, legend, svg, height };
}

export function themedPage(parts, theme) {
  return `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">${parts.fonts}<style>${parts.style}
html,body{margin:0} body{padding:20px 24px;width:${PAGE_WIDTH}px}
.wrap{display:flex;flex-direction:column;gap:14px}
.box{background:var(--sheet);border:1px solid var(--line);padding:16px}
.box svg{display:block;width:100%;height:auto}</style></head>
<body><div class="wrap">${parts.legend}<div class="box">${parts.svg}</div></div></body></html>`;
}

function findBrowser() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).filter((d) => d.startsWith("chromium-")).sort().reverse()) {
      candidates.push(
        join(cache, dir, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
        join(cache, dir, "chrome-linux/chrome"),
        join(cache, dir, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(cache, dir, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(cache, dir, "chrome-linux64/chrome"),
      );
    }
  }
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

function render(pagePath, outDir) {
  const parts = extract(readFileSync(pagePath, "utf8"));
  if (!parts) { console.error("no <style>, .fig-scroll <svg>, or viewBox found — was the page built from templates/page.html?"); return 1; }
  const browser = findBrowser();
  if (!browser) { console.error("no Chrome or Chromium found; set CHROME=/path/to/chrome"); return 2; }
  mkdirSync(outDir, { recursive: true });
  const work = join(tmpdir(), `impact-map-${process.pid}`);
  mkdirSync(work, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const html = join(work, `diagram-${theme}.html`);
    const png = resolve(outDir, `what-changes-${theme}.png`);
    writeFileSync(html, themedPage(parts, theme));
    execFileSync(browser, [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=2",
      "--virtual-time-budget=4000", `--window-size=${PAGE_WIDTH},${parts.height}`,
      `--screenshot=${png}`, pathToFileURL(html).href,
    ], { stdio: "ignore" });
    if (!existsSync(png)) { console.error(`render failed: ${png}`); return 1; }
    console.log(png);
  }
  return 0;
}

function selfTest() {
  const page = `<link rel="stylesheet" href="https://fonts.googleapis.com/x"><style>:root{--sheet:#fff}</style>
<div class="legend"><span>New</span></div><figure><div class="fig-scroll">
<svg viewBox="0 0 900 300" role="img"><rect/></svg></div></figure>`;
  const p = extract(page);
  const checks = [
    ["extracts the diagram svg", p?.svg.startsWith("<svg viewBox"), true],
    ["extracts the legend", p?.legend.includes("New"), true],
    ["height scales with the viewBox", p?.height, Math.ceil(CHROME_FIXED + (SVG_WIDTH * 300) / 900)],
    ["dark page carries data-theme", themedPage(p, "dark").includes('data-theme="dark"'), true],
    ["a page without a diagram is rejected", extract("<style></style>"), null],
  ];
  let failed = 0;
  for (const [name, got, want] of checks) {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
  }
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv.length !== 2) { console.error("usage: render-png.mjs <page.html> <out-dir> | --self-test"); return 2; }
  return render(argv[0], argv[1]);
}

if (process.argv[1]?.endsWith("render-png.mjs")) process.exitCode = main(process.argv.slice(2));
