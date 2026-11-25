#!/usr/bin/env node
// card.mjs — the status card on top of atelier's sticky PR comment (rules/state.md § Comment).
// One card per reachable run state and theme, pre-rendered to assets/cards/<key>-<theme>.png by
// render-cards.mjs; state.mjs only picks the file, so GitHub never has to draw anything.
//
//   node card.mjs --self-test

import { isMain, makeTester } from "./lib.mjs";

export const CARD_STAGES = ["build", "ready", "merge", "deliver"];
/** What a reader sees for each stage; the keys above stay the stored names, so old comments still resume. */
export const STAGE_TITLE = { build: "Build & review", ready: "Verify", merge: "Merge", deliver: "Deliver" };
const OUTCOME = { proceed: "done", skipped: "skipped", hold: "hold", failed: "failed", refuse: "refuse" };
// What each stage can end in, so every reachable state has a pre-rendered card; state.mjs refuses
// to record any other stage and decision pair.
export const ENDINGS = {
	build: ["done", "skipped", "hold", "failed", "refuse"],
	ready: ["done", "hold", "failed"],
	merge: ["done", "hold", "failed", "refuse"],
	deliver: ["done", "skipped", "hold", "failed"],
};

export const outcomeOf = (decision) => OUTCOME[decision];

/** The four card outcomes (done|skipped|hold|failed|refuse|pending) for a parsed state. */
export function outcomes(state) {
	// The current stage is the last one recorded (`state.stage`), not the furthest: a re-run of Ready
	// after a refused merge leaves the merge entry behind, and it must not decide the card.
	const cur = CARD_STAGES.indexOf(state?.stage);
	return CARD_STAGES.map((s, i) => {
		if (i > cur) return "pending";
		const x = OUTCOME[state.stages?.[s]?.decision];
		if (i === cur) return x ?? "pending";
		return x === "skipped" ? "skipped" : "done";
	});
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

/** The headline, the comment's title line, and the mascot mood for a state; colours are picked per theme by `tone`. */
export function verdict(o) {
	const cur = Math.max(0, o.findLastIndex((x) => x !== "pending"));
	const at = STAGE_TITLE[CARD_STAGES[cur]];
	const end = o[cur];
	if (end === "hold") return { mood: "held", tone: "amber", lead: `Held at ${at}.`, tail: "Needs you.", title: `Held at ${at}` };
	if (end === "failed") return { mood: "failed", tone: "red", lead: `${at} failed.`, tail: "Needs a fix.", title: `${at} failed` };
	if (end === "refuse") return { mood: "refused", tone: "coral", lead: `${at} refused.`, tail: "The gate said no.", title: `${at} refused` };
	if (cur === 3) return end === "skipped"
		? { mood: "ready", tone: "sky", lead: "Merged.", tail: "Delivery skipped.", title: "Merged, delivery skipped" }
		: { mood: "shipped", tone: "green", lead: "Merged.", tail: "And delivered.", title: "Merged and delivered" };
	if (cur === 2) return { mood: "working", tone: "blue", lead: "Merged.", tail: "Delivering…", title: "Merged, delivering" };
	if (cur === 1) return { mood: "ready", tone: "sky", lead: "Verified.", tail: "Waiting on the merge.", title: "Verified, merge next" };
	return { mood: "working", tone: "blue", lead: end === "skipped" ? "Existing PR." : "Built and reviewed.", tail: "Verifying…", title: `${end === "skipped" ? "Existing PR" : "Reviewed"}, verify next` };
}

const LABEL = { done: "done", skipped: "skipped", hold: "needs you", failed: "failed", refuse: "refused", pending: "not reached" };

/** One-line plain-text summary, the image's alt text. */
export function altText(o) {
	const v = verdict(o);
	return `Atelier: ${v.lead} ${v.tail} ${CARD_STAGES.map((s, i) => `${STAGE_TITLE[s]} ${LABEL[o[i]]}`).join(", ")}.`;
}

const STAGE_INFO = [
	{ name: STAGE_TITLE.build, what: "aw builds it, an agent reviews it", icon: '<path d="m14.6 9.4 5.6-5.6a1.8 1.8 0 0 1 2.6 2.6l-5.6 5.6"/><path d="M14.6 9.4 9.9 11.8a3 3 0 0 0-1.4 1.4L7 16.5l3.5-1.5a3 3 0 0 0 1.4-1.4l2.4-4.7"/><path d="M7 16.5c-1.2 1.3-1.5 3-3.5 4 2.6.6 5.4.1 6.6-2"/>' },
	{ name: STAGE_TITLE.ready, what: "green CI, every criterion proven", icon: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>' },
	{ name: "Merge", what: "flag contract, squash", icon: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>' },
	{ name: "Deliver", what: "main's pipeline goes green", icon: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>' },
];
// GitHub's own comment palettes, so the transparent card sits on the comment as if it were part of it.
// Every text colour clears 4.5:1 on its background; status is never colour alone (badge glyph + word).
const THEMES = {
	dark: {
		vars: "--bg:#0d1117;--card:#151b23;--line2:#3d444d;--text:#f0f6fc;--dim:#9198a1;--faint:#9198a1;--skip:#3d444d",
		c: { green: "#3fb950", blue: "#4493f8", violet: "#ab7df8", amber: "#d29922", red: "#f85149", coral: "#f0883e", faint: "#9198a1", mint: "#56d364", sky: "#79c0ff", lilac: "#d2a8ff" },
	},
	light: {
		vars: "--bg:#ffffff;--card:#f6f8fa;--line2:#d1d9e0;--text:#1f2328;--dim:#59636e;--faint:#59636e;--skip:#d1d9e0",
		c: { green: "#1a7f37", blue: "#0969da", violet: "#8250df", amber: "#9a6700", red: "#d1242f", coral: "#bc4c00", faint: "#59636e", mint: "#1a7f37", sky: "#0969da", lilac: "#8250df" },
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

/** The card as a transparent 1400×214 page, the pipeline only; shown at width 700, so every size here is twice its on-screen size. render-cards.mjs screenshots it. */
export const CARD_SIZE = [1400, 214];
export function card(o, theme = "dark") {
	const { vars, c } = THEMES[theme];
	const v = verdict(o);
	const [g0, g1] = GRADIENT[v.tone].map((k) => c[k]);
	const cur = Math.max(0, o.findLastIndex((x) => x !== "pending"));
	const pct = (i) => 10 + i * (80 / 3);
	const nodes = STAGE_INFO.map((s, i) => {
		const badge = BADGE[o[i]] ? `<span class="badge"><svg viewBox="0 0 20 20">${BADGE[o[i]]}</svg></span>` : "";
		return `<div class="node ${o[i]}${i === cur ? " cur" : ""}" style="--c:${c[COLOR[o[i]]]};left:${pct(i)}%">
  <div class="dot"><svg viewBox="0 0 24 24" class="ic">${s.icon}</svg>${badge}</div>
  <h3>${s.name}</h3><p class="st">${LABEL[o[i]]}</p></div>`;
	}).join("\n");
	return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap">
<style>
:root{${vars}}
*{box-sizing:border-box;margin:0;padding:0}
html{background:transparent}
body{width:${CARD_SIZE[0]}px;height:${CARD_SIZE[1]}px;background:transparent;color:var(--text);overflow:hidden;position:relative;font-family:"Geist",-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
body::after{content:"";position:absolute;left:${pct(cur) * 14}px;top:62px;width:280px;height:124px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,${g0}26,${g1}0d 60%,transparent);filter:blur(12px)}
.pipe{position:relative;z-index:1;height:100%;padding-top:16px}
.rail,.fill{position:absolute;top:${16 + 46 - 2}px;height:4px;border-radius:2px;left:${pct(0)}%}
.rail{right:${100 - pct(3)}%;background:repeating-linear-gradient(90deg,var(--line2) 0 10px,transparent 10px 20px)}
.fill{width:${pct(cur) - pct(0)}%;background:linear-gradient(90deg,${c.green},${c[COLOR[o[cur]]]});box-shadow:0 0 14px ${c[COLOR[o[cur]]]}55}
.nodes{position:relative;height:100%}
.node{position:absolute;top:0;width:340px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;text-align:center}
.dot{width:92px;height:92px;border-radius:26px;display:grid;place-items:center;background:var(--card);border:2px solid var(--line2);position:relative}
.ic{width:42px;height:42px;fill:none;stroke:var(--faint);stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.node:not(.pending):not(.skipped) .dot{border-color:color-mix(in srgb,var(--c) 65%,transparent);background:color-mix(in srgb,var(--c) 9%,var(--bg))}
.node:not(.pending):not(.skipped) .ic{stroke:var(--c)}
.node.cur .dot{box-shadow:0 0 0 8px color-mix(in srgb,var(--c) 14%,transparent),0 0 36px color-mix(in srgb,var(--c) 35%,transparent)}
.node.pending .dot,.node.skipped .dot{border-style:dashed}
.badge{position:absolute;right:-12px;top:-12px;width:38px;height:38px;border-radius:50%;background:var(--c);display:grid;place-items:center;box-shadow:0 0 0 5px var(--bg)}
.badge svg{width:22px;height:22px;fill:none;stroke:var(--bg);stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}
.node.skipped .badge{background:var(--skip)}.node.skipped .badge svg{stroke:var(--text)}
.node h3{font-size:34px;font-weight:600;letter-spacing:-.02em;line-height:1;margin-top:22px}
.st{font-size:27px;font-weight:500;line-height:1;margin-top:12px;color:var(--c)}
.node.pending h3,.node.pending .st,.node.skipped .st{color:var(--faint)}
.node.pending h3{font-weight:500}
</style></head><body><div class="pipe"><div class="rail"></div><div class="fill"></div><div class="nodes">${nodes}</div></div></body></html>`;
}

function selfTest() {
	const { t, done } = makeTester("card");
	const keys = allKeys();
	t("27 reachable states", keys.length === 27, String(keys.length));
	t("keys are unique", new Set(keys).size === keys.length);
	t("no state → build pending", cardKey(outcomes(null)) === "pending-pending-pending-pending");
	const s = { stage: "ready", stages: { build: { decision: "skipped" }, ready: { decision: "proceed" } } };
	t("an existing PR at Ready", cardKey(outcomes(s)) === "skipped-done-pending-pending" && keys.includes("skipped-done-pending-pending"));
	const rerun = { stage: "ready", stages: { build: { decision: "proceed" }, ready: { decision: "hold" }, merge: { decision: "refuse" } } };
	t("the last recorded stage decides, not the furthest", cardKey(outcomes(rerun)) === "done-hold-pending-pending");
	t("a stage before the current one counts as done", cardKey(outcomes({ stage: "merge", stages: { build: { decision: "hold" }, merge: { decision: "proceed" } } })) === "done-done-done-pending");
	t("a refused Build has a card and names its stage", keys.includes("refuse-pending-pending-pending") && verdict(["refuse", "pending", "pending", "pending"]).lead === "Build & review refused.");
	const decisionOf = { done: "proceed", skipped: "skipped", hold: "hold", failed: "failed", refuse: "refuse" };
	const stateOf = (k) => { const o = k.split("-"); return { stage: CARD_STAGES[o.findLastIndex((x) => x !== "pending")], stages: Object.fromEntries(o.map((x, i) => [CARD_STAGES[i], x === "pending" ? undefined : { decision: decisionOf[x] }])) }; };
	t("every reachable state round-trips to its own key", keys.every((k) => cardKey(outcomes(stateOf(k))) === k));
	t("a refused merge reads as refused", verdict(["done", "done", "refuse", "pending"]).lead === "Merge refused.");
	t("alt text names every stage", altText(["skipped", "done", "pending", "pending"]) === "Atelier: Verified. Waiting on the merge. Build & review skipped, Verify done, Merge not reached, Deliver not reached.");
	for (const theme of Object.keys(THEMES)) t(`${theme} card renders`, card(["done", "hold", "pending", "pending"], theme).includes(`class="node hold cur"`));
	return done();
}

if (isMain(import.meta.url) && process.argv[2] === "--self-test") process.exit(selfTest());
