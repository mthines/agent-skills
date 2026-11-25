#!/usr/bin/env node
// card.mjs — the status card on top of atelier's sticky PR comment (rules/state.md § Comment).
// One card per reachable run state and theme, pre-rendered to assets/cards/<key>-<theme>.png by
// render-cards.mjs; state.mjs only picks the file, so GitHub never has to draw anything.
//
//   node card.mjs --self-test

import { isMain, makeTester } from "./lib.mjs";
import { svg as mascot } from "./mascot.mjs";

export const CARD_STAGES = ["build", "ready", "merge", "deliver"];
const OUTCOME = { proceed: "done", skipped: "skipped", hold: "hold", failed: "failed", refuse: "refuse" };
// What each stage can end in, so every reachable state has a pre-rendered card.
const ENDINGS = {
	build: ["done", "skipped", "hold", "failed"],
	ready: ["done", "hold", "failed"],
	merge: ["done", "hold", "failed", "refuse"],
	deliver: ["done", "skipped", "hold", "failed"],
};

/** The four card outcomes (done|skipped|hold|failed|refuse|pending) for a parsed state. */
export function outcomes(state) {
	const o = CARD_STAGES.map((s) => OUTCOME[state?.stages?.[s]?.decision] ?? "pending");
	// A stage before the furthest recorded one has completed, whatever an older entry said.
	const cur = o.findLastIndex((x) => x !== "pending");
	return o.map((x, i) => (i < cur && x !== "done" && x !== "skipped" ? "done" : i > cur ? "pending" : x));
}

export const cardKey = (o) => o.join("-");

/** Every state the stage machine can reach, in pipeline order. */
export function allKeys() {
	const keys = [];
	CARD_STAGES.forEach((stage, cur) => {
		const firsts = cur === 0 ? [null] : ["done", "skipped"];
		for (const first of firsts)
			for (const end of ENDINGS[stage]) {
				const o = CARD_STAGES.map((_, i) => (i > cur ? "pending" : i === cur ? end : i === 0 ? first : "done"));
				keys.push(cardKey(o));
			}
	});
	return keys;
}

/** The headline and mascot mood for a state; colours are picked per theme by `tone`. */
export function verdict(o) {
	const cur = Math.max(0, o.findLastIndex((x) => x !== "pending"));
	const at = CARD_STAGES[cur][0].toUpperCase() + CARD_STAGES[cur].slice(1);
	const end = o[cur];
	if (end === "hold") return { mood: "held", tone: "amber", lead: `Held at ${at}.`, tail: "Needs you." };
	if (end === "failed") return { mood: "failed", tone: "red", lead: `${at} failed.`, tail: "Needs a fix." };
	if (end === "refuse") return { mood: "refused", tone: "coral", lead: "Merge refused.", tail: "The gate said no." };
	if (cur === 3) return end === "skipped"
		? { mood: "ready", tone: "sky", lead: "Merged.", tail: "Delivery skipped." }
		: { mood: "shipped", tone: "green", lead: "Merged.", tail: "And delivered." };
	if (cur === 2) return { mood: "working", tone: "blue", lead: "Merged.", tail: "Delivering…" };
	if (cur === 1) return { mood: "ready", tone: "sky", lead: "Ready.", tail: "Waiting on the merge." };
	return { mood: "working", tone: "blue", lead: end === "skipped" ? "Existing PR." : "Built.", tail: "Getting it ready…" };
}

const LABEL = { done: "done", skipped: "skipped", hold: "needs you", failed: "failed", refuse: "refused", pending: "not reached" };

/** One-line plain-text summary, the image's alt text. */
export function altText(o) {
	const v = verdict(o);
	return `Atelier: ${v.lead} ${v.tail} ${CARD_STAGES.map((s, i) => `${s[0].toUpperCase()}${s.slice(1)} ${LABEL[o[i]]}`).join(", ")}.`;
}

const STAGE_INFO = [
	{ name: "Build", what: "aw builds a draft PR", icon: '<path d="m14.6 9.4 5.6-5.6a1.8 1.8 0 0 1 2.6 2.6l-5.6 5.6"/><path d="M14.6 9.4 9.9 11.8a3 3 0 0 0-1.4 1.4L7 16.5l3.5-1.5a3 3 0 0 0 1.4-1.4l2.4-4.7"/><path d="M7 16.5c-1.2 1.3-1.5 3-3.5 4 2.6.6 5.4.1 6.6-2"/>' },
	{ name: "Ready", what: "review, threads, green CI", icon: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' },
	{ name: "Merge", what: "flag contract, squash", icon: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>' },
	{ name: "Deliver", what: "main's pipeline goes green", icon: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>' },
];
const THEMES = {
	dark: {
		vars: "--bg:#09090b;--card:#111114;--line:#232329;--line2:#2e2e36;--text:#f4f4f5;--dim:#a1a1aa;--faint:#63636e;--dotc:rgba(255,255,255,.07);--skip:#27272a",
		c: { green: "#4ade80", blue: "#60a5fa", violet: "#a78bfa", amber: "#fbbf24", red: "#f87171", coral: "#fb923c", faint: "#63636e", mint: "#86efac", sky: "#93c5fd", lilac: "#c4b5fd" },
	},
	light: {
		vars: "--bg:#ffffff;--card:#fafafa;--line:#e4e4e7;--line2:#d4d4d8;--text:#09090b;--dim:#52525b;--faint:#a1a1aa;--dotc:rgba(0,0,0,.09);--skip:#e4e4e7",
		c: { green: "#16a34a", blue: "#2563eb", violet: "#7c3aed", amber: "#d97706", red: "#dc2626", coral: "#ea580c", faint: "#a1a1aa", mint: "#059669", sky: "#2563eb", lilac: "#7c3aed" },
	},
};
const GRADIENT = { amber: ["amber", "coral"], red: ["red", "coral"], coral: ["coral", "red"], green: ["green", "mint"], blue: ["blue", "violet"], sky: ["sky", "lilac"] };
const BADGE = {
	done: '<path d="m5 10 3 3 7-7"/>',
	skipped: '<path d="m4 5 5 5-5 5M11 5l5 5-5 5"/>',
	hold: '<path d="M7.5 5v10M12.5 5v10"/>',
	failed: '<path d="m5 5 10 10M15 5 5 15"/>',
	refuse: '<path d="M4 10h12"/>',
	pending: "",
};
const COLOR = { done: "green", skipped: "faint", hold: "amber", failed: "red", refuse: "coral", pending: "faint" };

/** The card as a 1400×330 HTML page; render-cards.mjs screenshots it. */
export function card(o, theme = "dark") {
	const { vars, c } = THEMES[theme];
	const v = verdict(o);
	const [g0, g1] = GRADIENT[v.tone].map((k) => c[k]);
	const cur = Math.max(0, o.findLastIndex((x) => x !== "pending"));
	const pct = (i) => 12.5 + i * 25;
	const nodes = STAGE_INFO.map((s, i) => {
		const badge = BADGE[o[i]] ? `<span class="badge"><svg viewBox="0 0 20 20">${BADGE[o[i]]}</svg></span>` : "";
		return `<div class="node ${o[i]}${i === cur ? " cur" : ""}" style="--c:${c[COLOR[o[i]]]}">
  <div class="dot"><svg viewBox="0 0 24 24" class="ic">${s.icon}</svg>${badge}</div>
  <h3>${s.name}</h3><p>${s.what}</p><span class="chip mono">${LABEL[o[i]]}</span></div>`;
	}).join("\n");
	return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
:root{${vars}}
*{box-sizing:border-box;margin:0;padding:0}
html{background:transparent}
body{width:1400px;height:330px;border-radius:18px;background:var(--bg);box-shadow:inset 0 0 0 1px var(--line);color:var(--text);overflow:hidden;position:relative;font-family:"Geist",-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:absolute;inset:0;background-image:radial-gradient(var(--dotc) 1px,transparent 1.2px);background-size:22px 22px;-webkit-mask-image:radial-gradient(900px 380px at 62% 60%,#000 20%,transparent 75%)}
body::after{content:"";position:absolute;left:${410 + pct(cur) * 9.6}px;top:200px;width:520px;height:220px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,${g0}22,${g1}10 55%,transparent);filter:blur(10px)}
.mono{font-family:"Geist Mono",ui-monospace,monospace}
.wrap{position:relative;z-index:1;display:flex;height:100%;padding:40px 56px 0 40px;gap:28px}
.hero{width:280px;flex:none;display:flex;align-items:center;justify-content:center;margin-top:-40px}
.hero svg{width:190px;height:190px}
.eyebrow{font-size:14px;color:var(--faint);letter-spacing:.02em}.eyebrow b{color:var(--dim);font-weight:500}
.main{flex:1;min-width:0}
h1{font-size:44px;font-weight:600;letter-spacing:-.035em;line-height:1.05;margin-top:12px}
h1 span{background:linear-gradient(90deg,${g0},${g1});-webkit-background-clip:text;color:transparent}
.pipe{position:relative;margin-top:30px;height:170px}
.rail{position:absolute;top:28px;height:2px;left:${pct(0)}%;right:${100 - pct(3)}%;background:repeating-linear-gradient(90deg,var(--line2) 0 6px,transparent 6px 12px)}
.fill{position:absolute;top:28px;height:2px;left:${pct(0)}%;width:${pct(cur) - pct(0)}%;background:linear-gradient(90deg,${c.green},${c[COLOR[o[cur]]]});box-shadow:0 0 12px ${c[COLOR[o[cur]]]}66}
.nodes{position:absolute;inset:0;display:grid;grid-template-columns:repeat(4,1fr)}
.node{display:flex;flex-direction:column;align-items:center;text-align:center}
.dot{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;background:var(--card);border:1px solid var(--line2);position:relative}
.ic{width:24px;height:24px;fill:none;stroke:var(--faint);stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.node:not(.pending):not(.skipped) .dot{border-color:color-mix(in srgb,var(--c) 55%,transparent)}
.node:not(.pending):not(.skipped) .ic{stroke:var(--c)}
.node.cur .dot{box-shadow:0 0 0 6px color-mix(in srgb,var(--c) 10%,transparent),0 0 28px color-mix(in srgb,var(--c) 30%,transparent)}
.node.pending .dot,.node.skipped .dot{border-style:dashed}
.badge{position:absolute;right:-7px;top:-7px;width:22px;height:22px;border-radius:50%;background:var(--c);display:grid;place-items:center;box-shadow:0 0 0 3px var(--bg)}
.badge svg{width:13px;height:13px;fill:none;stroke:var(--bg);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.node.skipped .badge{background:var(--skip)}.node.skipped .badge svg{stroke:var(--dim)}
.node h3{font-size:19px;font-weight:600;letter-spacing:-.015em;margin-top:16px}
.node.pending h3{color:var(--faint)}
.node p{font-size:14px;color:var(--dim);margin-top:5px}
.node.pending p{color:var(--faint)}
.chip{font-size:12.5px;border-radius:6px;padding:4px 8px;margin-top:12px;color:var(--c);background:color-mix(in srgb,var(--c) 8%,transparent);border:1px solid color-mix(in srgb,var(--c) 25%,transparent)}
</style></head><body><div class="wrap">
<div class="hero">${mascot(v.mood)}</div>
<div class="main">
  <div class="eyebrow mono"><b>atelier</b> · build → ready → merge → deliver</div>
  <h1>${v.lead} <span>${v.tail}</span></h1>
  <div class="pipe"><div class="rail"></div><div class="fill"></div><div class="nodes">${nodes}</div></div>
</div></div></body></html>`;
}

function selfTest() {
	const { t, done } = makeTester("card");
	const keys = allKeys();
	t("26 reachable states", keys.length === 26, String(keys.length));
	t("keys are unique", new Set(keys).size === keys.length);
	t("no state → build pending", cardKey(outcomes(null)) === "pending-pending-pending-pending");
	const s = { stages: { build: { decision: "skipped" }, ready: { decision: "proceed" } } };
	t("an existing PR at Ready", cardKey(outcomes(s)) === "skipped-done-pending-pending" && keys.includes("skipped-done-pending-pending"));
	const stale = { stages: { build: { decision: "proceed" }, ready: { decision: "hold" }, merge: { decision: "proceed" } } };
	t("a stage before the furthest one counts as done", cardKey(outcomes(stale)) === "done-done-done-pending");
	t("every reachable outcome set maps back to a known key", keys.every((k) => keys.includes(cardKey(outcomes({ stages: Object.fromEntries(k.split("-").map((x, i) => [CARD_STAGES[i], x === "pending" ? undefined : { decision: { done: "proceed", skipped: "skipped", hold: "hold", failed: "failed", refuse: "refuse" }[x] }])) })))));
	t("a refused merge reads as refused", verdict(["done", "done", "refuse", "pending"]).lead === "Merge refused.");
	t("alt text names every stage", altText(["skipped", "done", "pending", "pending"]) === "Atelier: Ready. Waiting on the merge. Build skipped, Ready done, Merge not reached, Deliver not reached.");
	for (const theme of Object.keys(THEMES)) t(`${theme} card renders`, card(["done", "hold", "pending", "pending"], theme).includes("Held at Ready."));
	return done();
}

if (isMain(import.meta.url) && process.argv[2] === "--self-test") process.exit(selfTest());
