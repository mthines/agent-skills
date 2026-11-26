#!/usr/bin/env node
// rollout-state.mjs — one `deployment.rollout.state` gauge point per rollout transition, for the live board (rules/rollout-state.md).
// tick.mjs calls emitRollout() after it writes the PR comment; export is opt-in and never changes a tick's outcome.
//   node rollout-state.mjs --self-test

import { existsSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE = "deployment-verify";
export const SCOPE_NAME = "agent-skills/deployment-verify";
export const GAUGE = "deployment.rollout.state";
export const PHASES = Object.freeze(["deploy", "baseline", "step", "hold", "rollback", "done"]);

const warn = (msg) => process.stderr.write(`deployment-verify: ${msg}\n`);

// The same export settings atelier uses, so a rollout lands in the dataset its run did: off wins, then ATELIER_OTLP_*,
// then PR_REVIEWER_OTLP_*, then the host's OTEL_EXPORTER_OTLP_* only when ATELIER_TELEMETRY=on. Keep in step with atelier's telemetry.mjs exportTarget.
export function exportTarget(env = process.env) {
	const mode = String(env.ATELIER_TELEMETRY || "").toLowerCase();
	if (mode === "off") return { endpoint: "", headers: {} };
	if (env.ATELIER_OTLP_ENDPOINT) return { endpoint: env.ATELIER_OTLP_ENDPOINT, headers: parseHeaders(env.ATELIER_OTLP_HEADERS) };
	if (env.PR_REVIEWER_OTLP_ENDPOINT && String(env.PR_REVIEWER_TELEMETRY || "").toLowerCase() !== "off") {
		return { endpoint: env.PR_REVIEWER_OTLP_ENDPOINT, headers: parseHeaders(env.PR_REVIEWER_OTLP_HEADERS) };
	}
	if (mode === "on" && env.OTEL_EXPORTER_OTLP_ENDPOINT) return { endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT, headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) };
	return { endpoint: "", headers: {} };
}

export function parseHeaders(s) {
	const out = {};
	for (const pair of String(s || "").split(",")) {
		const i = pair.indexOf("=");
		if (i <= 0) continue;
		let v = pair.slice(i + 1).trim();
		try {
			v = decodeURIComponent(v);
		} catch {}
		out[pair.slice(0, i).trim()] = v;
	}
	return out;
}

// pr-reviewer's otlp.mjs: the env override, this checkout, the installed agent's real path, then the Agent0 install.
export function otlpScript(env = process.env, home = homedir()) {
	const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
	const installed = (() => {
		try {
			return join(dirname(realpathSync(join(home, ".claude", "agents", "pr-reviewer.md"))), "pr-reviewer", "scripts", "otlp.mjs");
		} catch {
			return null;
		}
	})();
	const candidates = [
		env.DEPLOYMENT_VERIFY_OTLP_MJS,
		join(here, "..", "..", "..", "..", "agents", "pr-reviewer", "scripts", "otlp.mjs"),
		installed,
		"/tmp/workspace/agent-skills/agents/pr-reviewer/scripts/otlp.mjs",
	].filter(Boolean);
	const hit = candidates.find((p) => existsSync(p));
	if (!hit) throw new Error(`cannot find pr-reviewer/scripts/otlp.mjs (set DEPLOYMENT_VERIFY_OTLP_MJS, tried ${candidates.join(", ")})`);
	return hit;
}

// A transition is a first state, or a change of phase, step, or outcome; a lease or a window change is not one.
export function changed(prev, next) {
	if (!next?.phase) return false;
	if (!prev?.phase) return true;
	return prev.phase !== next.phase || prev.step_value !== next.step_value || prev.outcome !== next.outcome;
}

// Bounded labels only: phase, step, outcome, environment. The free-text reason stays on the PR comment.
export function labels(next, { pr, slug }) {
	const [owner, name] = String(slug || "").split("/");
	const stepped = next.phase === "step" || next.phase === "hold";
	const step = stepped ? next.step_value ?? next.hold?.at : null;
	return {
		"atelier.work.ref": pr.url,
		"vcs.repository.name": name || null,
		"vcs.owner.name": owner || null,
		"vcs.change.id": String(pr.number),
		"deployment.phase": next.phase,
		"deployment.step": step === null || step === undefined ? null : String(step),
		"deployment.outcome": next.outcome || null,
		"deployment.env": next.env || null,
		// A rollout on a local stack is a test, not a merged change: every dashboard panel drops it.
		...(next.env === "local" ? { "atelier.smoke": true } : {}),
	};
}

/** After a tick wrote the state: export one gauge point if the rollout moved. Returns the flush result, or null. Never throws. */
export async function emitRollout({ prev, next, pr, slug = null, env = process.env, now = Date.now() } = {}) {
	try {
		if (!pr?.number || !pr?.url || !changed(prev, next)) return null;
		const { endpoint, headers } = exportTarget(env);
		if (!endpoint) return null;
		const otlp = await import(pathToFileURL(otlpScript(env)).href);
		const ex = new otlp.OtlpExporter({
			endpoint, headers, scopeName: SCOPE_NAME,
			resource: { "service.name": SERVICE, "service.namespace": "agent-skills", "service.instance.id": `${slug || "repo"}#${pr.number}` },
		});
		ex.gauge(GAUGE, now / 1000, labels(next, { pr, slug }), "s");
		return await ex.flush();
	} catch (e) {
		warn(`rollout state not exported — ${String(e?.message || e).slice(0, 200)}`);
		return null;
	}
}

// ───────────────────────────── self-test ─────────────────────────────

async function selfTest() {
	let failed = 0;
	let n = 0;
	const t = (name, ok, detail = "") => {
		n++;
		if (!ok) failed++;
		console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
	};
	const pr = { number: 41, url: "https://github.com/acme/web/pull/41" };
	const first = { phase: "deploy", env: "production" };
	const step10 = { phase: "step", step_value: 10, env: "production" };
	t("a first state is a transition", changed(null, first) && changed({}, first));
	t("the same phase, step, and outcome is not, even with a lease change", !changed(step10, { ...step10, lease: { holder: "x" }, step_set_at: "T" }));
	t("a new step, phase, or outcome is", changed(step10, { ...step10, step_value: 50 }) && changed(step10, { ...step10, phase: "hold" }) && changed(step10, { phase: "done", outcome: "PASS" }));
	t("a state with no phase is never one", !changed(first, {}) && !changed(null, null));
	const l = labels(step10, { pr, slug: "acme/web" });
	t("a step carries its value, the PR, the repo, and the environment", l["deployment.step"] === "10" && l["atelier.work.ref"] === pr.url && l["vcs.repository.name"] === "web"
		&& l["vcs.owner.name"] === "acme" && l["vcs.change.id"] === "41" && l["deployment.env"] === "production" && l["atelier.smoke"] === undefined);
	t("a hold names the step it holds at", labels({ phase: "hold", hold: { at: 50 }, env: "production" }, { pr, slug: "a/b" })["deployment.step"] === "50");
	t("deploy and done carry no step; done carries the outcome", labels(first, { pr })["deployment.step"] === null && labels({ phase: "done", outcome: "ROLLED_BACK" }, { pr })["deployment.outcome"] === "ROLLED_BACK");
	t("a local rollout is smoke", labels({ phase: "step", step_value: 1, env: "local" }, { pr })["atelier.smoke"] === true);
	t("export targets: off wins, ATELIER first, PR_REVIEWER reused, host OTEL only with ATELIER_TELEMETRY=on", exportTarget({ ATELIER_TELEMETRY: "off", ATELIER_OTLP_ENDPOINT: "x" }).endpoint === ""
		&& exportTarget({ ATELIER_OTLP_ENDPOINT: "a", PR_REVIEWER_OTLP_ENDPOINT: "b" }).endpoint === "a" && exportTarget({ PR_REVIEWER_OTLP_ENDPOINT: "b" }).endpoint === "b"
		&& exportTarget({ PR_REVIEWER_OTLP_ENDPOINT: "b", PR_REVIEWER_TELEMETRY: "off" }).endpoint === "" && exportTarget({ OTEL_EXPORTER_OTLP_ENDPOINT: "h" }).endpoint === ""
		&& exportTarget({ ATELIER_TELEMETRY: "on", OTEL_EXPORTER_OTLP_ENDPOINT: "h", OTEL_EXPORTER_OTLP_HEADERS: "k=v" }).headers.k === "v");
	t("headers parse with percent-decoding", parseHeaders("Authorization=Bearer%20tok,Dash0-Dataset=default").Authorization === "Bearer tok");

	const received = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			try {
				received.push({ path: String(req.url), body: JSON.parse(body) });
			} catch {
				received.push({ path: String(req.url), body: null });
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end("{}");
		});
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
	const env = { ATELIER_OTLP_ENDPOINT: `http://127.0.0.1:${server.address().port}` };
	try {
		const now = Date.parse("2026-11-26T10:00:00Z");
		const sent = await emitRollout({ prev: first, next: step10, pr, slug: "acme/web", env, now });
		const metrics = received.find((r) => r.path === "/v1/metrics")?.body?.resourceMetrics?.[0];
		const point = metrics?.scopeMetrics?.[0]?.metrics?.find((m) => m.name === GAUGE)?.gauge?.dataPoints?.[0];
		const attr = (k) => point?.attributes?.find((x) => x.key === k)?.value?.stringValue;
		t("a transition exports one gauge point: service, phase, step, value = epoch seconds", sent?.exported === true && point?.asDouble === now / 1000
			&& metrics.resource.attributes.some((x) => x.key === "service.name" && x.value.stringValue === SERVICE) && attr("deployment.phase") === "step" && attr("deployment.step") === "10", JSON.stringify(point));
		const before = received.length;
		const none = await emitRollout({ prev: step10, next: { ...step10, lease: null }, pr, slug: "acme/web", env, now });
		t("an unchanged tick sends nothing", none === null && received.length === before);
		t("no endpoint, no PR, or no URL sends nothing", (await emitRollout({ prev: null, next: first, pr, env: {} })) === null && (await emitRollout({ prev: null, next: first, pr: null, env })) === null
			&& (await emitRollout({ prev: null, next: first, pr: { number: 1 }, env })) === null && received.length === before);
		const dead = await emitRollout({ prev: null, next: first, pr, env: { ATELIER_OTLP_ENDPOINT: "http://127.0.0.1:1" } });
		t("a dead backend is not a failure", dead === null || dead.exported === false);
		t("a missing otlp.mjs is not a failure", (await emitRollout({ prev: null, next: first, pr, env: { ...env, DEPLOYMENT_VERIFY_OTLP_MJS: "/nope.mjs" } })).exported === true, "falls back to the checkout copy");
	} finally {
		server.close();
	}
	console.log(failed ? `${failed}/${n} failed` : `${n}/${n} passed`);
	return failed ? 1 : 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
	if (process.argv.includes("--self-test")) process.exit(await selfTest());
	warn("pass --self-test; tick.mjs imports emitRollout");
}
