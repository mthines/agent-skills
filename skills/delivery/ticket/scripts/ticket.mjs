#!/usr/bin/env node
// ticket.mjs — the deterministic half of the ticket skill: read the repo's tracker config and decide.
//
//   node ticket.mjs --decide --request "<text>" [--ticket <id|url>] [--unattended] [--repo <dir>]
//        prints one line: `TICKET: link <id>` | `TICKET: ask` | `TICKET: create` | `TICKET: skip — <reason>`
//   node ticket.mjs --state --stage build|ready|merge [--repo <dir>]     the tracker state for that stage, or `none`
//   node ticket.mjs --pr-line --ticket <id> [--repo <dir>]               the PR-body line that links it (`Closes AI-12`)
//   node ticket.mjs --check [--repo <dir>]                               `tracker.yml ok: …`, exit 1 when it does not load
//   node ticket.mjs --self-test
// Config: <repo>/.agents/aw/tracker.yml, with ~/.agents/aw/config.yml → repos.<owner/repo>.tracker merged over it.
// Exit 0 on a decision, 1 on a config that does not load, 2 on a usage error.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROVIDERS = ["linear", "github", "none"];
export const REQUIRE = ["always", "ask", "never"];
const DEFAULT_STATES = {
	linear: { build: "In Progress", ready: "In Review", merge: "Done" },
	github: { build: "none", ready: "none", merge: "closed" },
	none: { build: "none", ready: "none", merge: "none" },
};

// The YAML subset tracker.yml uses: nested maps, scalars, `[a, b]` flow lists, and `- x` scalar lists.
export function parseYaml(text) {
	const root = {};
	const stack = [{ indent: -1, node: root }];
	let pendingList = null;
	const scalar = (raw) => {
		const v = raw.replace(/\s+#.*$/, "").trim();
		if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== "");
		const q = v.match(/^(['"])(.*)\1$/);
		if (q) return q[2];
		if (v === "true" || v === "false") return v === "true";
		if (/^-?\d+$/.test(v)) return Number(v);
		return v;
	};
	for (const raw of String(text).split("\n")) {
		if (!raw.trim() || /^\s*#/.test(raw)) continue;
		const indent = raw.length - raw.trimStart().length;
		const line = raw.trim();
		while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
		const parent = stack.at(-1).node;
		if (line.startsWith("- ")) {
			if (!pendingList || /^[\w.-]+:\s/.test(line.slice(2))) throw new Error(`unsupported YAML (list of maps) at: ${line}`);
			pendingList.push(scalar(line.slice(2)));
			continue;
		}
		const m = line.match(/^(['"]?)([^'":]+)\1:\s*(.*)$/);
		if (!m) throw new Error(`unsupported YAML at: ${line}`);
		const [, , key, rest] = m;
		if (rest.replace(/\s+#.*$/, "").trim() === "") {
			const child = {};
			parent[key] = child;
			stack.push({ indent, node: child, key, parent });
			pendingList = [];
			Object.defineProperty(child, "__list", { value: pendingList, enumerable: false, configurable: true });
			continue;
		}
		parent[key] = scalar(rest);
		pendingList = null;
	}
	// A key followed only by `- x` lines is a list, not a map.
	const fold = (node) => {
		for (const [k, v] of Object.entries(node)) {
			if (v && typeof v === "object" && !Array.isArray(v)) {
				if (!Object.keys(v).length && v.__list?.length) node[k] = [...v.__list];
				else fold(v);
			}
		}
		return node;
	};
	return fold(root);
}

function deepMerge(a, b) {
	if (!b || typeof b !== "object" || Array.isArray(b)) return b ?? a;
	const out = { ...(a || {}) };
	for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(out[k], v) : v;
	return out;
}

// Only the `repos.<slug>.tracker` block of the personal overlay: the rest of that file holds shapes this parser does not read.
export function overlayBlock(text, slug) {
	const lines = String(text).split("\n");
	const at = (re, from, indent) => {
		for (let i = from; i < lines.length; i++) {
			const l = lines[i];
			if (!l.trim() || /^\s*#/.test(l)) continue;
			const ind = l.length - l.trimStart().length;
			if (ind < indent) return -1;
			if (ind === indent && re.test(l.trim())) return i;
		}
		return -1;
	};
	const esc = slug.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	const r = at(/^repos:\s*$/, 0, 0);
	if (r < 0) return null;
	const s = lines.slice(r + 1).findIndex((l) => new RegExp(`^\\s+(['"]?)${esc}\\1:\\s*$`).test(l));
	if (s < 0) return null;
	const slugLine = r + 1 + s;
	const slugIndent = lines[slugLine].length - lines[slugLine].trimStart().length;
	const childIndent = (lines.slice(slugLine + 1).find((l) => l.trim() && !/^\s*#/.test(l)) || "").search(/\S/);
	if (childIndent <= slugIndent) return null;
	const t = at(/^tracker:\s*$/, slugLine + 1, childIndent);
	if (t < 0) return null;
	const body = [];
	for (const l of lines.slice(t + 1)) {
		if (l.trim() && l.search(/\S/) <= childIndent) break;
		body.push(l);
	}
	return body.join("\n");
}

function repoSlug(repo) {
	try {
		const url = execFileSync("git", ["-C", repo, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
		return url.replace(/\.git$/, "").split(/[/:]/).slice(-2).join("/");
	} catch {
		return null;
	}
}

// null when the repo has no tracker.yml; throws when it does not load.
export function loadTracker(repo, { home = homedir(), slug = repoSlug(repo) } = {}) {
	const file = join(repo, ".agents", "aw", "tracker.yml");
	if (!existsSync(file)) return null;
	let cfg = parseYaml(readFileSync(file, "utf8"));
	const overlay = join(home, ".agents", "aw", "config.yml");
	if (slug && existsSync(overlay)) {
		const block = overlayBlock(readFileSync(overlay, "utf8"), slug);
		if (block) cfg = deepMerge(cfg, parseYaml(block));
	}
	const provider = cfg.provider ?? "none";
	if (!PROVIDERS.includes(provider)) throw new Error(`tracker.yml provider: ${provider} is not one of ${PROVIDERS.join(", ")}`);
	const require = cfg.require ?? "ask";
	if (!REQUIRE.includes(require)) throw new Error(`tracker.yml require: ${require} is not one of ${REQUIRE.join(", ")}`);
	if (provider === "linear" && !cfg.linear?.team) throw new Error("tracker.yml provider: linear needs linear.team");
	return { ...cfg, provider, require, states: { ...DEFAULT_STATES[provider], ...(cfg.states || {}) } };
}

// A Linear key (AI-3112) or URL, a GitHub issue URL, or `#12` when the provider is github.
export function findTicket(text, provider = null) {
	const s = String(text ?? "");
	const gh = s.match(/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/(\d+)/);
	if (gh) return `${gh[1]}#${gh[2]}`;
	const linear = s.match(/linear\.app\/[^\s]*?\/issue\/([A-Z][A-Z0-9]{1,9}-\d+)/) || s.match(/\b([A-Z][A-Z0-9]{1,9}-\d+)\b/);
	if (linear && provider !== "github") return linear[1];
	const hash = s.match(/(?:^|\s)#(\d+)\b/);
	if (hash && provider === "github") return `#${hash[1]}`;
	return null;
}

export function decide({ request = "", ticket = null, unattended = false, config = null }) {
	const id = findTicket(ticket || "", config?.provider) || findTicket(request, config?.provider);
	if (id) return `TICKET: link ${id}`;
	if (!config) return "TICKET: skip — no .agents/aw/tracker.yml; /atelier setup configures a tracker";
	if (config.provider === "none") return "TICKET: skip — tracker.yml provider: none";
	if (config.require === "never") return "TICKET: skip — tracker.yml require: never";
	if (config.require === "always") return "TICKET: create";
	return unattended ? "TICKET: skip — require: ask and no human present; create one and link it" : "TICKET: ask";
}

export function prLine(id, provider = null) {
	const s = String(id).trim();
	if (/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(s) && provider !== "github") return `Closes ${s}`;
	if (/^\d+$/.test(s)) return `Closes #${s}`;
	return `Closes ${s}`;
}

function selfTest() {
	let pass = 0;
	let fail = 0;
	const t = (name, ok, detail = "") => {
		if (ok) pass++;
		else {
			fail++;
			console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
		}
	};
	t("a Linear key in the request links", decide({ request: "fix AI-3112 crash" }) === "TICKET: link AI-3112");
	t("a Linear URL links its key", findTicket("see https://linear.app/dash0/issue/AI-42/some-title") === "AI-42");
	t("a GitHub issue URL links as owner/repo#n", findTicket("https://github.com/acme/web/issues/7") === "acme/web#7");
	t("#12 is a ticket only when the provider is github", findTicket("fix #12") === null && findTicket("fix #12", "github") === "#12");
	t("✗ no tracker.yml never asks or creates", /^TICKET: skip — no \.agents\/aw\/tracker\.yml/.test(decide({ request: "add a button" })));
	const cfg = (o) => ({ provider: "linear", require: "ask", linear: { team: "AI" }, ...o });
	t("require: ask asks a human", decide({ request: "x", config: cfg() }) === "TICKET: ask");
	t("✓ require: ask never creates unattended", /^TICKET: skip — require: ask and no human/.test(decide({ request: "x", unattended: true, config: cfg() })));
	t("require: always creates, attended or not", decide({ request: "x", config: cfg({ require: "always" }) }) === "TICKET: create" && decide({ request: "x", unattended: true, config: cfg({ require: "always" }) }) === "TICKET: create");
	t("require: never and provider: none skip", /require: never/.test(decide({ request: "x", config: cfg({ require: "never" }) })) && /provider: none/.test(decide({ request: "x", config: cfg({ provider: "none" }) })));
	t("a named ticket links even under require: never", decide({ request: "AI-9", config: cfg({ require: "never" }) }) === "TICKET: link AI-9");
	t("--ticket wins over the request text", decide({ request: "AI-1", ticket: "AI-2", config: cfg() }) === "TICKET: link AI-2");
	t("PR lines per provider", prLine("AI-3112") === "Closes AI-3112" && prLine("12") === "Closes #12" && prLine("#12", "github") === "Closes #12" && prLine("acme/web#7") === "Closes acme/web#7");
	const y = parseYaml("version: 1\nprovider: linear  # team tracker\nrequire: 'always'\nlinear:\n  team: AI\n  labels: [agent, atelier]\nstates:\n  merge: Shipped\nskills:\n  create: project-management:linear-planning\nextra:\n  - a\n  - b\n");
	t("the YAML subset reads maps, flow and block lists, and colons in values", y.provider === "linear" && y.require === "always" && y.linear.labels.join() === "agent,atelier" && y.skills.create === "project-management:linear-planning" && y.extra.join() === "a,b", JSON.stringify(y));
	let threw = false;
	try {
		parseYaml("x:\n  - name: a\n");
	} catch {
		threw = true;
	}
	t("a list of maps is refused, never misread", threw);
	const tmp = mkdtempSync(join(tmpdir(), "ticket-"));
	try {
		mkdirSync(join(tmp, "repo", ".agents", "aw"), { recursive: true });
		mkdirSync(join(tmp, "home", ".agents", "aw"), { recursive: true });
		writeFileSync(join(tmp, "repo", ".agents", "aw", "tracker.yml"), "version: 1\nprovider: linear\nlinear:\n  team: AI\n");
		writeFileSync(join(tmp, "home", ".agents", "aw", "config.yml"), "policies:\n  push: own-prs\nrepos:\n  acme/web:\n    environments:\n      - weird: list\n    tracker:\n      require: always\n      linear:\n        project: Agents\n  other/repo:\n    tracker:\n      require: never\n");
		const c = loadTracker(join(tmp, "repo"), { home: join(tmp, "home"), slug: "acme/web" });
		t("the personal overlay merges repos.<slug>.tracker only", c.require === "always" && c.linear.team === "AI" && c.linear.project === "Agents" && c.states.merge === "Done", JSON.stringify(c));
		t("another repo's overlay does not apply", loadTracker(join(tmp, "repo"), { home: join(tmp, "home"), slug: "zzz/none" }).require === "ask");
		writeFileSync(join(tmp, "repo", ".agents", "aw", "tracker.yml"), "version: 1\nprovider: jira\n");
		let err = "";
		try {
			loadTracker(join(tmp, "repo"), { home: join(tmp, "home"), slug: null });
		} catch (e) {
			err = e.message;
		}
		t("an unknown provider does not load", /provider: jira is not one of/.test(err), err);
		t("no tracker.yml loads as null", loadTracker(join(tmp, "home"), { home: join(tmp, "home") }) === null);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
	console.log(`ticket self-test: ${pass} passed, ${fail} failed`);
	return fail === 0 ? 0 : 1;
}

function args(argv) {
	const a = {};
	for (let i = 0; i < argv.length; i++) {
		const k = argv[i].replace(/^--/, "");
		a[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
	}
	return a;
}

function main() {
	const a = args(process.argv.slice(2));
	if (a["self-test"]) process.exit(selfTest());
	const repo = resolve(typeof a.repo === "string" ? a.repo : process.cwd());
	let config;
	try {
		config = loadTracker(repo);
	} catch (e) {
		console.error(`ticket: ${e.message}`);
		process.exit(1);
	}
	if (a.decide) console.log(decide({ request: typeof a.request === "string" ? a.request : "", ticket: typeof a.ticket === "string" ? a.ticket : null, unattended: !!a.unattended, config }));
	else if (a.state) {
		if (!["build", "ready", "merge"].includes(a.stage)) {
			console.error("ticket: --state needs --stage build|ready|merge");
			process.exit(2);
		}
		console.log(config?.states?.[a.stage] ?? "none");
	} else if (a["pr-line"]) {
		if (typeof a.ticket !== "string") {
			console.error("ticket: --pr-line needs --ticket <id>");
			process.exit(2);
		}
		console.log(prLine(a.ticket, config?.provider));
	} else if (a.check) {
		console.log(config ? `tracker.yml ok: provider ${config.provider}, require ${config.require}` : "tracker.yml absent");
	} else {
		console.error("ticket: pass one of --decide, --state, --pr-line, --check, --self-test");
		process.exit(2);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
