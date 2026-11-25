#!/usr/bin/env node
// render-cards.mjs — pre-renders every status card (card.mjs) to assets/cards/<key>-<theme>.png and the
// mascot moods to assets/mascot/<mood>.{svg,png} (the PNG is the comment footer's face) with headless
// Chrome. Run it after changing card.mjs or mascot.mjs and commit the output; state.mjs links these files.
//
//   node render-cards.mjs            render everything (needs Chrome: $CHROME, macOS Chrome, or google-chrome on PATH)
//   node render-cards.mjs --check    exit 1 when a reachable state has no card (no Chrome needed)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CARD_SIZE, allKeys, card } from "./card.mjs";
import { isMain } from "./lib.mjs";
import { MOODS, svg } from "./mascot.mjs";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");
export const CARDS_DIR = join(ASSETS, "cards");
export const THEMES = ["light", "dark"];

export const missingCards = () => [
	...allKeys().flatMap((k) => THEMES.map((t) => join(CARDS_DIR, `${k}-${t}.png`))),
	...Object.keys(MOODS).map((m) => join(ASSETS, "mascot", `${m}.png`)),
].filter((f) => !existsSync(f)).map((f) => f.slice(ASSETS.length + 1));

function chrome() {
	const candidates = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium"].filter(Boolean);
	for (const c of candidates) {
		try {
			execFileSync(c, ["--version"], { stdio: "ignore" });
			return c;
		} catch {}
	}
	throw new Error("no Chrome found: set CHROME to a Chrome or Chromium binary");
}

// Chrome can exit non-zero on stderr noise and still write the file; the existence check is the truth.
function shoot(bin, html, png, size) {
	try {
		execFileSync(bin, ["--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", "--force-device-scale-factor=1",
			"--virtual-time-budget=4000", `--screenshot=${png}`, `--window-size=${size}`, `file://${html}`], { stdio: "ignore" });
	} catch {}
	if (!existsSync(png)) throw new Error(`Chrome wrote no ${png}`);
}

function render() {
	const bin = chrome();
	const tmp = mkdtempSync(join(tmpdir(), "atelier-cards-"));
	mkdirSync(CARDS_DIR, { recursive: true });
	mkdirSync(join(ASSETS, "mascot"), { recursive: true });
	for (const mood of Object.keys(MOODS)) {
		writeFileSync(join(ASSETS, "mascot", `${mood}.svg`), svg(mood));
		const html = join(tmp, `${mood}.html`);
		writeFileSync(html, `<style>html,body{margin:0;background:transparent}svg{display:block;width:96px;height:96px}</style>${svg(mood)}`);
		shoot(bin, html, join(ASSETS, "mascot", `${mood}.png`), "96,96");
	}
	for (const key of allKeys())
		for (const theme of THEMES) {
			const html = join(tmp, `${key}-${theme}.html`);
			writeFileSync(html, card(key.split("-"), theme));
			shoot(bin, html, join(CARDS_DIR, `${key}-${theme}.png`), CARD_SIZE.join(","));
		}
	console.log(`rendered ${allKeys().length * THEMES.length} cards to ${CARDS_DIR}`);
}

if (isMain(import.meta.url) && process.argv[2] === "--check") {
	const missing = missingCards();
	if (missing.length) {
		console.error(`missing images (run node render-cards.mjs): ${missing.join(", ")}`);
		process.exit(1);
	}
	console.log(`cards: ${allKeys().length * THEMES.length}/${allKeys().length * THEMES.length} present`);
} else if (isMain(import.meta.url)) render();
