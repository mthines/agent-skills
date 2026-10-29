#!/usr/bin/env node
// @ts-check
/**
 * check-gh-shim.mjs — the test suite for agent0-gh-shim.sh, the `gh` wrapper the Agent0
 * setup puts first on PATH. Runs the shim against a fake `gh` that serves a paginated list
 * and logs every call it receives. `--self-test` is the only mode (L1 G114 runs it).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = join(HERE, "agent0-gh-shim.sh");

// A fake gh: a 5-item list served 2 per page, an object endpoint, and a log of every call.
const FAKE_GH = `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_LOG"
printf 'PATH=%s\\n' "$PATH" >> "$FAKE_LOG"
case "$*" in
  *--paginate*) echo "FALLBACK $*"; exit 0 ;;
esac
[ "$1" = api ] || { echo "PASSTHROUGH $*"; exit 0; }
case "$*" in
  *items*"&page=1") echo '[1,2]' ;;
  *items*"&page=2") echo '[3,4]' ;;
  *items*"&page=3") echo '[5]' ;;
  *big*"&page=1"|*big*"&page=2") jq -nc '[range(100)]' ;;
  *big*"&page=3") jq -nc '[range(50)]' ;;
  *search*) echo '{"total_count":1,"items":[9]}' ;;
  *fails*) echo "gh: Server Error (HTTP 502)" >&2; exit 1 ;;
  *) echo "PASSTHROUGH $*" ;;
esac
`;

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "gh-shim-"));
  const shimDir = join(root, "shim"), realDir = join(root, "real"), log = join(root, "calls.log");
  mkdirSync(shimDir);
  mkdirSync(realDir);
  copyFileSync(SHIM, join(shimDir, "gh"));
  chmodSync(join(shimDir, "gh"), 0o755);
  writeFileSync(join(realDir, "gh"), FAKE_GH);
  chmodSync(join(realDir, "gh"), 0o755);
  const sysPath = process.env.PATH || "";

  /** @param {string[]} args @param {string} [path] */
  const gh = (args, path = `${shimDir}:${realDir}:${sysPath}`) => {
    writeFileSync(log, "");
    const r = spawnSync(join(shimDir, "gh"), args, { encoding: "utf8", env: { ...process.env, PATH: path, FAKE_LOG: log } });
    const lines = readFileSync(log, "utf8").split("\n");
    return { out: r.stdout.trim(), err: r.stderr, status: r.status, calls: lines.filter((l) => l && !l.startsWith("PATH=")), paths: lines.filter((l) => l.startsWith("PATH=")) };
  };

  let failed = 0;
  /** @param {string} name @param {boolean} ok @param {unknown} [detail] */
  const check = (name, ok, detail) => {
    console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${JSON.stringify(detail)}`}`);
    if (!ok) failed++;
  };

  const nonApi = gh(["pr", "view", "1"]);
  check("a non-api command passes straight through", nonApi.out === "PASSTHROUGH pr view 1", nonApi);

  const single = gh(["api", "repos/o/r/items"]);
  check("an api call without --paginate passes straight through", single.out === "PASSTHROUGH api repos/o/r/items", single);

  const jq = gh(["api", "repos/o/r/items?per_page=2", "--paginate", "--jq", ".[]"]);
  check("--paginate walks ?page=N until a short page, applying --jq to each",
    jq.out === "1\n2\n3\n4\n5" && jq.calls.length === 3 && jq.calls.every((c) => !c.includes("--paginate")), jq);

  const raw = gh(["api", "repos/o/r/items?per_page=2", "--paginate"]);
  check("--paginate without --jq prints each page", raw.out === "[1,2][3,4][5]", raw);

  const big = gh(["api", "repos/o/r/big?per_page=200", "--paginate", "--jq", ".[]"]);
  check("per_page above GitHub's 100 cap still walks every page", big.out.split("\n").length === 250 && big.calls.length === 3, { n: big.out.split("\n").length, calls: big.calls });

  const graphql = gh(["api", "graphql", "--paginate", "-f", "query=q"]);
  check("graphql --paginate is handed back to gh unchanged", graphql.out.startsWith("FALLBACK api graphql --paginate"), graphql);

  const obj = gh(["api", "search/issues?q=x", "--paginate", "--jq", ".items[]"]);
  check("a non-array response is handed back to gh's own --paginate", obj.out.startsWith("FALLBACK api search/issues?q=x --paginate") && /--jq \.items\[\]/.test(obj.out), obj);

  const fails = gh(["api", "repos/o/r/fails", "--paginate"]);
  check("a failing page exits non-zero", fails.status !== 0, fails);

  check("the real gh never sees the shim's own directory on PATH", jq.paths.length > 0 && jq.paths.every((p) => !p.split(/[=:]/).includes(shimDir)), jq.paths);

  const missing = gh(["api", "x", "--paginate"], `${shimDir}:/nonexistent`);
  check("no real gh on PATH exits 127", missing.status === 127 && /real gh not found/.test(missing.err), missing);

  rmSync(root, { recursive: true, force: true });
  console.log(failed ? `check-gh-shim self-test: ${failed} failed` : "check-gh-shim self-test: all passed");
  return failed ? 1 : 0;
}

if (process.argv[2] === "--self-test") process.exit(selfTest());
console.error("usage: check-gh-shim.mjs --self-test");
process.exit(2);
