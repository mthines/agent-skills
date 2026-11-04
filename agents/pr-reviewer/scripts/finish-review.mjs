#!/usr/bin/env node
/**
 * finish-review.mjs — Step 4 in one tool call: validate-judgments → finalize → `assert` marker →
 * execute-write-plan. The same four scripts with the same arguments, run in the order Step 4 already
 * names, so a clean run costs one model turn instead of four to six.
 *
 * It stops at the first stage that exits non-zero, prints that stage's own output, and exits with
 * its code, so a validation rejection, a finalize refusal, or `execute-write-plan` exit 3 (MCP path)
 * reads exactly as it does when the stages run by hand. It never retries and never skips a stage.
 *
 * usage: finish-review.mjs --context <ctx.json> --judgments <judgments.json> --out-dir <dir>
 *          [--dry-run] [--tool-calls <n>]
 *   --dry-run   finalize runs with --dry-run (it exports the run itself); no assert marker, and
 *               execute-write-plan runs with --dry-run so its pre-write checks and step preview still run.
 *   --self-test
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** @param {string[]} argv @returns {Record<string, string|boolean>} */
export function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) o[a.slice(2)] = true;
    else { o[a.slice(2)] = next; i++; }
  }
  return o;
}

/**
 * The stage list for these options; pure, so the self-test can assert the order without spawning.
 * @param {Record<string, string|boolean>} o @returns {{ name: string, argv: string[] }[]}
 */
export function planStages(o) {
  const node = (/** @type {string} */ s) => join(HERE, s);
  const stages = [
    { name: "validate", argv: [node("validate-judgments.mjs"), String(o.judgments)] },
    {
      name: "finalize",
      argv: [node("finalize.mjs"), "--context", String(o.context), "--judgments", String(o.judgments),
        "--out-dir", String(o["out-dir"]), ...(o["dry-run"] ? ["--dry-run"] : [])],
    },
  ];
  const plan = join(String(o["out-dir"]), "write-plan.json");
  if (o["dry-run"]) {
    stages.push({ name: "post", argv: [node("execute-write-plan.mjs"), "--plan", plan, "--dry-run"] });
    return stages;
  }
  stages.push({
    name: "assert",
    argv: [node("review-telemetry.mjs"), "step", "assert", ...(o["tool-calls"] ? ["--attr", `tool_calls_so_far=${o["tool-calls"]}`] : []),
      "--run-dir", dirname(resolve(String(o.context)))],
  });
  stages.push({ name: "post", argv: [node("execute-write-plan.mjs"), "--plan", plan] });
  return stages;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o["self-test"]) return selfTest();
  for (const k of ["context", "judgments", "out-dir"]) {
    if (typeof o[k] !== "string") { console.error(`finish-review: --${k} is required`); process.exit(2); }
  }
  for (const s of planStages(o)) {
    const r = spawnSync(process.execPath, s.argv, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    process.stdout.write(`── ${s.name} ──\n${r.stdout || ""}`);
    if (r.stderr) process.stderr.write(r.stderr);
    // The assert marker always exits 0; every other stage's non-zero code is the answer.
    if (r.status !== 0) {
      console.error(`finish-review: stopped at ${s.name} (exit ${r.status}); run the stages after it by hand once fixed`);
      process.exit(r.status ?? 1);
    }
  }
}

function selfTest() {
  let fail = 0;
  const check = (/** @type {string} */ n, /** @type {boolean} */ ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${n}`); if (!ok) fail++; };
  const base = { context: "/r/ctx.json", judgments: "/r/j.json", "out-dir": "/r/out" };
  const names = (/** @type {any} */ o) => planStages(o).map((s) => s.name).join(",");
  check("real run: validate, finalize, assert, post in order", names(base) === "validate,finalize,assert,post");
  check("--dry-run: no assert, but the post stage still runs", names({ ...base, "dry-run": true }) === "validate,finalize,post");
  check("--dry-run post stage passes --dry-run to execute-write-plan", planStages({ ...base, "dry-run": true })[2].argv.includes("--dry-run"));
  check("real run's post stage has no --dry-run", !planStages(base)[3].argv.includes("--dry-run"));
  const fin = planStages({ ...base, "dry-run": true })[1].argv;
  check("--dry-run reaches finalize", fin.includes("--dry-run"));
  check("assert marker carries the run dir and tool-call count",
    planStages({ ...base, "tool-calls": "41" })[2].argv.join(" ").includes("tool_calls_so_far=41 --run-dir /r"));
  check("post reads <out-dir>/write-plan.json", planStages(base)[3].argv.at(-1) === "/r/out/write-plan.json");
  const miss = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: "utf8" });
  check("missing flags exit 2", miss.status === 2);
  console.log(fail ? `${fail} FAILED` : "all passed");
  process.exit(fail ? 1 : 0);
}

main();
