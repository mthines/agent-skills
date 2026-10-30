#!/usr/bin/env node
// render-png.mjs — renders an impact-map page's legend and diagram to PNG, light and dark.
//
// Usage:
//   node render-png.mjs <page.html> <out-dir>
//   node render-png.mjs --find-browser     # print the browser it would use; exit 2 when none
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

// Browser layouts inside one Playwright revision directory, by directory prefix. A full Chromium is
// preferred; the headless shell renders the same screenshot and is all some hosts install.
const PLAYWRIGHT_LAYOUTS = [
  ["chromium-", [
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux/chrome",
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-linux64/chrome",
  ]],
  ["chromium_headless_shell-", [
    "chrome-headless-shell-linux64/chrome-headless-shell",
    "chrome-linux/headless_shell",
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-mac/headless_shell",
  ]],
];

/** Newest Playwright revision first: `chromium-1248` before `chromium-999`. */
const byRevisionDesc = (a, b) => Number(b.replace(/\D+/g, "")) - Number(a.replace(/\D+/g, ""));

// The first existing browser: $CHROME, the system installs, then every Playwright cache root —
// $PLAYWRIGHT_BROWSERS_PATH (where the Agent0 installer puts it) before the default cache.
export function findBrowser({ env = process.env, home = homedir(), platform = process.platform,
  exists = existsSync, list = readdirSync } = {}) {
  const candidates = [
    env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const roots = [
    env.PLAYWRIGHT_BROWSERS_PATH && env.PLAYWRIGHT_BROWSERS_PATH !== "0" ? env.PLAYWRIGHT_BROWSERS_PATH : null,
    join(home, platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright"),
  ].filter((r) => r && exists(r));
  for (const [prefix, layouts] of PLAYWRIGHT_LAYOUTS) {
    for (const root of roots) {
      for (const dir of list(root).filter((d) => d.startsWith(prefix)).sort(byRevisionDesc)) {
        candidates.push(...layouts.map((l) => join(root, dir, l)));
      }
    }
  }
  return candidates.find((p) => p && exists(p)) ?? null;
}

// Chromium refuses to start as root without --no-sandbox, which is how an Agent0 sandbox runs.
export function browserArgs({ width, height, png, url, root = process.getuid?.() === 0 }) {
  return [
    "--headless=new", ...(root ? ["--no-sandbox"] : []), "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=2", "--virtual-time-budget=4000", `--window-size=${width},${height}`,
    `--screenshot=${png}`, url,
  ];
}

function render(pagePath, outDir) {
  const parts = extract(readFileSync(pagePath, "utf8"));
  if (!parts) { console.error("no <style>, .fig-scroll <svg>, or viewBox found — was the page built from templates/page.html?"); return 1; }
  const browser = findBrowser();
  if (!browser) { console.error("no Chrome or Chromium found; set CHROME=/path/to/chrome or PLAYWRIGHT_BROWSERS_PATH"); return 2; }
  mkdirSync(outDir, { recursive: true });
  const work = join(tmpdir(), `impact-map-${process.pid}`);
  mkdirSync(work, { recursive: true });
  for (const theme of ["light", "dark"]) {
    const html = join(work, `diagram-${theme}.html`);
    const png = resolve(outDir, `what-changes-${theme}.png`);
    writeFileSync(html, themedPage(parts, theme));
    try {
      execFileSync(browser, browserArgs({ width: PAGE_WIDTH, height: parts.height, png, url: pathToFileURL(html).href }),
        { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
    } catch (err) {
      const why = String(err.stderr || err.message).trim().split("\n").filter(Boolean).pop() || "unknown error";
      console.error(`render failed (${theme}, ${browser}): ${why}`);
      return 1;
    }
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
  // findBrowser over a fake filesystem: an Agent0 install has only Playwright's browsers, under
  // $PLAYWRIGHT_BROWSERS_PATH, sometimes only the headless shell.
  const PW = "/ws/playwright/browsers";
  const fakeFs = (paths) => {
    const set = new Set(paths);
    const exists = (p) => set.has(p) || [...set].some((q) => q.startsWith(`${p}/`));
    const list = (dir) => [...new Set([...set].filter((q) => q.startsWith(`${dir}/`)).map((q) => q.slice(dir.length + 1).split("/")[0]))];
    return { exists, list, home: "/home/u", platform: "linux" };
  };
  const shell = `${PW}/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell`;
  const full = `${PW}/chromium-1248/chrome-linux64/chrome`;
  const env = { PLAYWRIGHT_BROWSERS_PATH: PW };
  checks.push(
    ["finds the headless shell under $PLAYWRIGHT_BROWSERS_PATH", findBrowser({ env, ...fakeFs([shell]) }), shell],
    ["prefers a full Chromium over the headless shell", findBrowser({ env, ...fakeFs([shell, full]) }), full],
    ["picks the newest revision, compared as numbers", findBrowser({ env, ...fakeFs([`${PW}/chromium-999/chrome-linux64/chrome`, full]) }), full],
    ["still finds the default ~/.cache/ms-playwright", findBrowser({ env: {}, ...fakeFs(["/home/u/.cache/ms-playwright/chromium-1/chrome-linux/chrome"]) }),
      "/home/u/.cache/ms-playwright/chromium-1/chrome-linux/chrome"],
    ["$CHROME wins over every cache", findBrowser({ env: { ...env, CHROME: "/opt/c" }, ...fakeFs([full, "/opt/c"]) }), "/opt/c"],
    ["no browser anywhere is null", findBrowser({ env, ...fakeFs([]) }), null],
    ["PLAYWRIGHT_BROWSERS_PATH=0 is not a directory to search", findBrowser({ env: { PLAYWRIGHT_BROWSERS_PATH: "0" }, ...fakeFs(["0/chromium-1/chrome-linux/chrome"]) }), null],
    ["root adds --no-sandbox", browserArgs({ width: 1, height: 1, png: "p", url: "u", root: true }).includes("--no-sandbox"), true],
    ["a non-root user gets no --no-sandbox", browserArgs({ width: 1, height: 1, png: "p", url: "u", root: false }).includes("--no-sandbox"), false],
  );
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
  if (argv[0] === "--find-browser") {
    const b = findBrowser();
    if (b) console.log(b); else console.error("no Chrome or Chromium found");
    return b ? 0 : 2;
  }
  if (argv.length !== 2) { console.error("usage: render-png.mjs <page.html> <out-dir> | --find-browser | --self-test"); return 2; }
  return render(argv[0], argv[1]);
}

if (process.argv[1]?.endsWith("render-png.mjs")) process.exitCode = main(process.argv.slice(2));
