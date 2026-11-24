#!/usr/bin/env node
// deployment-verify earned-autonomy recommendation. Pure and deterministic: it only RECOMMENDS.
// Nothing in this skill advances a hold or flips a flag because of what it returns.
//
//   node promote.mjs --risk-class <files.json>             → one word: ui | api | data | config | other | unknown
//   node promote.mjs --recommend <rule.json> < evidence.json → one JSON line {recommendation, reason}
//   node promote.mjs --self-test                            → built-in cases, exit 1 on any mismatch
//
// rule      = release.yml → promotion: { min_agree_streak, min_review_seconds, risk_classes, max_level }
// evidence  = { available, reason?, risk_class, model, signal: { agree_streak, level, model, last_override_at } | null }
//             (signal.mjs --read prints it; `available: false` = LoreKit not configured or unreachable)
// Rules this implements: rules/autonomy.md.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const RISK_CLASSES = ["data", "api", "config", "ui", "other"]; // highest risk first
export const DEFAULT_MAX_LEVEL = 1;

// The change-shape detector pr-reviewer uses (single source of truth for migrations, API contracts,
// infra, secrets). Loaded lazily: an install without it classifies nothing (`unknown` → HUMAN).
let classifyShape = null;
try {
	({ classify: classifyShape } = await import("../../../../agents/pr-reviewer/scripts/classify-shape.mjs"));
} catch {
	classifyShape = null;
}

// No bare `app/`: Rails, Next.js route handlers, and Python packages keep backend code there.
const UI_RE = /\.(tsx|jsx|vue|svelte|css|scss|sass|less|html)$|(^|\/)(components|pages|ui|styles)\//i;
const CONFIG_RE = /(^|\/)(\.github|\.agents|config|configs|deploy)\/|\.(ya?ml|toml|ini|env)$|(^|\/)(\.env[^/]*|Dockerfile[^/]*)$/i;
const DOCS_RE = /\.(md|mdx|rst|txt)$|(^|\/)docs\//i;
const TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)(test|tests|__tests__|spec|e2e)\/)/;

/**
 * The PR's risk class, from its changed files ({ filename, patch? }[]). Deterministic: the highest-risk
 * class any production file reaches wins. `unknown` when the shape detector is not installed.
 */
export function riskClass(files, classify = classifyShape) {
	if (typeof classify !== "function") return "unknown";
	const prod = (files || []).filter((f) => f?.filename && !TEST_RE.test(f.filename) && !DOCS_RE.test(f.filename));
	if (!prod.length) return "other";
	const shapes = new Set(classify(prod).shapes || []);
	if (shapes.has("schema-migration")) return "data";
	if (shapes.has("api-contract")) return "api";
	if (shapes.has("infra") || shapes.has("secrets") || prod.some((f) => CONFIG_RE.test(f.filename))) return "config";
	if (prod.some((f) => UI_RE.test(f.filename))) return "ui";
	return "other";
}

const human = (reason) => ({ recommendation: "HUMAN", reason });
const posInt = (n) => Number.isInteger(n) && n > 0;

/** AUTO only when a committed rule allows this risk class and the learned signal has earned it; else HUMAN. */
export function recommend(rule, evidence) {
	if (!rule || typeof rule !== "object") return human("no promotion rule in release.yml");
	if (!posInt(rule.min_agree_streak)) return human("promotion rule has no positive integer min_agree_streak");
	if (!evidence || typeof evidence !== "object") return human("no earned-autonomy evidence");
	if (evidence.available === false) return human(`LoreKit unreachable (${evidence.reason || "no reason given"})`);
	const rc = evidence.risk_class;
	if (!RISK_CLASSES.includes(rc)) return human(`unknown risk class ${rc ?? "(none)"}`);
	if (!(rule.risk_classes || []).includes(rc)) return human(`risk class ${rc} is not in promotion.risk_classes`);
	const sig = evidence.signal;
	if (!sig) return human(`no signal yet for ${rc}`);
	if (sig.model && evidence.model && sig.model !== evidence.model) return human(`model ${evidence.model} differs from the signal's ${sig.model}`);
	const maxLevel = Number.isInteger(rule.max_level) ? rule.max_level : DEFAULT_MAX_LEVEL;
	const level = Math.min(sig.level || 0, maxLevel);
	if (level < 1) return human(`level ${sig.level || 0} for ${rc} (max_level ${maxLevel})`);
	if ((sig.agree_streak || 0) < rule.min_agree_streak) return human(`agree streak ${sig.agree_streak || 0} < ${rule.min_agree_streak}`);
	return { recommendation: "AUTO", reason: `${rc}: level ${level}, agree streak ${sig.agree_streak} ≥ ${rule.min_agree_streak}` };
}

// ──────────────────────────── self-test ───────────────────────────

function selfTest() {
	const rule = { min_agree_streak: 3, min_review_seconds: 60, risk_classes: ["ui", "config"], max_level: 1 };
	const earned = { available: true, risk_class: "ui", model: "m1", signal: { agree_streak: 4, level: 1, model: "m1", last_override_at: null } };
	const recCases = [
		["HUMAN: no rule", null, earned, "HUMAN"],
		["HUMAN: no evidence", rule, null, "HUMAN"],
		["HUMAN: unknown risk class", rule, { ...earned, risk_class: "frontend" }, "HUMAN"],
		["HUMAN: lorekit unreachable", rule, { available: false, reason: "LOREKIT_API_KEY unset" }, "HUMAN"],
		["AUTO: earned ui signal", rule, earned, "AUTO"],
		["HUMAN: risk class not allowed", rule, { ...earned, risk_class: "data" }, "HUMAN"],
		["HUMAN: level 0", rule, { ...earned, signal: { ...earned.signal, level: 0 } }, "HUMAN"],
		["HUMAN: max_level 0 caps the signal", { ...rule, max_level: 0 }, earned, "HUMAN"],
		["HUMAN: model changed", rule, { ...earned, model: "m2" }, "HUMAN"],
		["HUMAN: streak below a tightened rule", { ...rule, min_agree_streak: 9 }, earned, "HUMAN"],
		["HUMAN: no signal yet", rule, { ...earned, signal: null }, "HUMAN"],
	];
	const fakeClassify = (files) => ({
		shapes: files.flatMap((f) => (/migrations\//.test(f.filename) ? ["schema-migration"] : /openapi/.test(f.filename) ? ["api-contract"] : [])),
	});
	const rcCases = [
		["risk class: ui", [{ filename: "apps/web/src/components/Button.tsx" }], "ui"],
		["risk class: api", [{ filename: "api/openapi.yaml" }, { filename: "apps/web/src/components/Button.tsx" }], "api"],
		["risk class: data", [{ filename: "db/migrations/0042_add.sql" }, { filename: "api/openapi.yaml" }], "data"],
		["risk class: config", [{ filename: ".github/workflows/ci.yml" }, { filename: "src/app/page.tsx" }], "config"],
		["risk class: other", [{ filename: "src/lib/math.ts" }, { filename: "README.md" }], "other"],
		["risk class: backend code under app/ is not ui", [{ filename: "app/models/user.rb" }, { filename: "src/app/api/users/route.ts" }, { filename: "backend/app/db/queries.py" }], "other"],
		["risk class: tests and docs only are other", [{ filename: "src/x.test.ts" }, { filename: "docs/a.md" }], "other"],
		["risk class: unknown without the detector", [{ filename: "src/x.ts" }], "unknown", null],
	];
	let failed = 0;
	for (const [name, r, e, want] of recCases) {
		const got = recommend(r, e);
		const ok = got.recommendation === want;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got.recommendation} (${got.reason})`);
	}
	for (const [name, files, want, cls = fakeClassify] of rcCases) {
		const got = riskClass(files, cls);
		const ok = got === want;
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` — expected ${want}`}`);
	}
	// The real detector, when installed: a migration path is data.
	if (classifyShape) {
		const ok = riskClass([{ filename: "db/migrations/0042_add.sql" }]) === "data";
		if (!ok) failed++;
		console.log(`${ok ? "ok  " : "FAIL"} risk class: pr-reviewer's classify-shape detects a migration`);
	}
	const total = recCases.length + rcCases.length + (classifyShape ? 1 : 0);
	console.log(failed ? `${failed}/${total} failed` : `${total}/${total} passed`);
	process.exit(failed ? 1 : 0);
}

function main() {
	const argv = process.argv.slice(2);
	if (argv[0] === "--self-test") return selfTest();
	try {
		if (argv[0] === "--risk-class") {
			const raw = JSON.parse(readFileSync(argv[1], "utf8"));
			console.log(riskClass(Array.isArray(raw) ? raw : raw.files));
			return;
		}
		if (argv[0] === "--recommend") {
			const rule = argv[1] ? JSON.parse(readFileSync(argv[1], "utf8")) : null;
			const evidence = JSON.parse(readFileSync(0, "utf8") || "null");
			console.log(JSON.stringify(recommend(rule, evidence)));
			return;
		}
		throw new Error("usage: promote.mjs --risk-class <files.json> | --recommend <rule.json> < evidence.json | --self-test");
	} catch (error) {
		console.error(`promote.mjs: ${error.message}`);
		process.exit(2);
	}
}

const self = (() => {
	try {
		return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
})();
if (self) main();
