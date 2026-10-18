---
title: 'aw-tester — intent specs and the probe loop'
impact: HIGH
tags:
  - aw-tester
  - intent-specs
  - probe
---

# aw-tester — intent specs and the probe loop

Part of the [`aw-tester`](../templates/aw-tester.agent.md) agent definition. Read when the specs file's header carries the line `Format: intent`.

## Contents

- [Route lookup, replay, and heal](#route-lookup-replay-and-heal)
- [The probe loop](#the-probe-loop)
- [Probe budget](#probe-budget)

## Route lookup, replay, and heal

An intent spec names what the user does and what must be true; you work out the
route. The engine-agnostic rules — parsing, the must-follow and detour rules, the
evidence forms, the closed `unreachable` list, grading, the route cache, and the
verdict keys — are [contract § 6](./spec-run-contract.md#6-intent-specs).
This file is how Playwright carries them out. Auth, the bypass header, bail
mode, auto-capture, and lessons work exactly as for a grammar spec.

For each `## Spec N:` block, in order:

1. **Look up its route.** Compute its `<sha8>` with the command in
   [contract § 6.6](./spec-run-contract.md#66-route-cache--replay-first-heal-on-failure)
   and look for `$AW_DIR/routes/Spec-N-<sha8>.md` — the route cache,
   `.agent/<branch>/.aw-tester/routes/`, which persists across runs in this
   worktree like `last-run.spec.ts` does.
2. **Hit → replay, in one launch.** Run the route through the probe below once:
   its `url:` as `start`, its `WHEN` actions as `steps`, and as `checks` every
   `THEN` locator plus a locator for each `# uncompiled:` item. Grade the spec
   from that single launch — `THEN`s and network items from `checks` and
   `requests`, the uncompiled items from `checks` and `aria`. Never launch a
   second time to judge an item: the route's mutations run exactly once
   (contract § 6.2). All pass → `route: replayed`, copy the file's
   `# deviations:` line into `deviations`. Any fail → heal by the route's
   `# mutations:` line (contract § 6.6): performed none of the listed
   mutations → go to step 3 once and report `route: healed`; performed one
   and every route step ran → re-judge the failed assertions from that
   launch's `aria` and `checks` without launching again (`route:
   replayed`); performed one and a later route step failed → delete the
   route file and grade the spec `skipped: route drifted after a mutation`.
3. **Miss (or heal) → explore with the probe loop below**, grade per contract
   § 6.5, and on a pass write the compiled route to
   `$AW_DIR/routes/Spec-N-<sha8>.md` with its five comment lines —
   `# mutations:` lists the `WHEN` positions whose step was a mutation (item
   4's commit launches) — unless an action needed a `within` scope or was a
   `goto` after `start`, neither of which the grammar can express: then cache
   nothing and note that the spec explores every run.

After every spec ran, rebuild `last-run.spec.ts` from the compiled routes so the
`hot_loop:` handle re-runs the passing specs deterministically. A spec with no
route (it failed or was skipped) is absent from that file; say so in `notes`.

## The probe loop

You cannot see the page between steps of a batch script, so explore by
re-launching a small probe: it replays the actions resolved so far, then reports
the page. Write the probe once per run:

```ts
// $AW_DIR/probe.spec.ts — reads $AW_PROBE_DIR/probe-in.json on every launch
import { test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.AW_PROBE_DIR as string;
const cfg = JSON.parse(readFileSync(join(DIR, 'probe-in.json'), 'utf8'));
const rx = (v: any) => {
  const m = typeof v === 'string' ? v.match(/^\/(.*)\/([a-z]*)$/) : null;
  return m ? new RegExp(m[1], m[2]) : v;
};

test('probe', async ({ browser }) => {
  test.setTimeout(120_000); // a multi-step replay outlives the 30 s default
  const bypass = cfg.bypassHeader; // { name, env } — the value is read from the env, never written to disk
  const context = await browser.newContext({
    baseURL: cfg.baseURL,
    storageState: cfg.storageState || undefined,
    extraHTTPHeaders: bypass ? { [bypass.name]: process.env[bypass.env] ?? '' } : undefined,
    // cfg.video: a .webm path, set only on a launch that grades the spec (--record-video)
    recordVideo: cfg.video ? { dir: join(DIR, 'video-raw'), size: { width: 1280, height: 720 } } : undefined,
  });
  const page = await context.newPage();
  const requests: string[] = [];
  page.on('response', (r) =>
    requests.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`));
  // Mutating requests, recorded when ISSUED, to the app's own origins only — never telemetry.
  const apiOrigins = new Set([new URL(cfg.baseURL).origin, ...(cfg.apiOrigins ?? [])]);
  const mutations: string[] = [];
  page.on('request', (q) => {
    const u = new URL(q.url());
    if (/^(POST|PUT|PATCH|DELETE)$/.test(q.method()) && apiOrigins.has(u.origin))
      mutations.push(`${q.method()} ${u.pathname}`);
  });
  const find = (l: any): any => {
    const root = l.within ? find(l.within) : page;
    if (l.role) return root.getByRole(l.role, { name: rx(l.name), exact: l.exact ?? true });
    if (l.label) return root.getByLabel(rx(l.label));
    if (l.placeholder) return root.getByPlaceholder(rx(l.placeholder));
    if (l.text) return root.getByText(rx(l.text));
    if (l.testid) return root.getByTestId(l.testid);
    throw new Error(`unsupported locator ${JSON.stringify(l)}`);
  };
  const steps: any[] = [];
  let fatal: string | null = null;
  try { await page.goto(cfg.start); } catch (e) { fatal = String(e).slice(0, 300); }
  for (const s of fatal ? [] : cfg.steps ?? []) {
    try {
      if (s.action === 'goto') { await page.goto(s.value); steps.push({ ok: true }); continue; }
      const t = find(s.locator);
      const n = await t.count();
      if (n !== 1) throw new Error(`locator matched ${n} elements — name the instance`);
      if (s.dry) { steps.push({ ok: true, dry: true }); continue; } // resolve only — never act
      const before = mutations.length;
      if (s.action === 'click') await t.click({ timeout: 5000 });
      else if (s.action === 'fill') await t.fill(s.value, { timeout: 5000 });
      else if (s.action === 'press') await t.press(s.value, { timeout: 5000 });
      else if (s.action === 'select') await t.selectOption(s.value, { timeout: 5000 });
      else if (s.action === 'check') await t.check({ timeout: 5000 });
      else if (s.action === 'hover') await t.hover({ timeout: 5000 });
      else throw new Error(`unsupported action ${s.action}`);
      await page.waitForLoadState('domcontentloaded');
      // An explicit settle, not networkidle: networkidle returns at once on a page that already idled.
      await page.waitForTimeout(cfg.settleMs ?? 1500);
      // the mutating requests this step issued — the evidence that settles "was it a mutation?"
      steps.push({ ok: true, fired: mutations.slice(before) });
    } catch (e) { steps.push({ ok: false, error: String(e).slice(0, 300) }); break; }
  }
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const checks: any[] = [];
  for (const c of cfg.checks ?? []) {
    try {
      const t = find(c);
      const n = await t.count();
      checks.push({ n, visible: n === 1 ? await t.isVisible() : null,
        text: n === 1 ? (await t.innerText()).slice(0, 200) : null });
    } catch (e) { checks.push({ error: String(e).slice(0, 200) }); }
  }
  const body = page.locator('body');
  const aria = typeof body.ariaSnapshot === 'function' ? await body.ariaSnapshot() : await body.innerText();
  if (cfg.shot) await page.screenshot({ path: cfg.shot, fullPage: true }).catch(() => {});
  writeFileSync(join(DIR, 'probe-out.json'), JSON.stringify(
    { url: page.url(), fatal, steps, checks, aria: aria.slice(0, 20000), requests: requests.slice(-100) }, null, 2));
  const video = page.video();
  await context.close();
  if (cfg.video && video) await video.saveAs(cfg.video).then(() => video.delete()).catch(() => {});
});
```

Each launch: delete `probe-out.json`, write `$AW_DIR/probe-in.json`, run the
probe, read `probe-out.json`. Never read a file an earlier launch left: a
launch that writes no `probe-out.json` (it crashed or timed out) is a probe
error — keep the tail of its output for `diagnostics`, and it counts against
the probe budget. A `fatal` value means `start` itself did not load.

```bash
# probe-in.json: { baseURL, storageState, bypassHeader, apiOrigins, settleMs, start,
#                  steps: [{action, locator, value, dry}], checks: [locator, …], shot, video }
# video: a .webm path — set only on a grading launch under --record-video; absent otherwise.
# apiOrigins: the app's own API origins besides the preview's (it is always included) —
#   the aw-target's adversarial.allowed_origins when set; never analytics or third-party hosts.
# settleMs: wait after each action before reading `fired` (default 1500; raise it for a debounced control).
# A locator is the single-braces form as JSON, optionally scoped:
#   {"role": "button", "name": "Rename", "within": {"role": "banner"}}
rm -f "$AW_DIR/probe-out.json"
AW_PROBE_DIR="$AW_DIR" "$PLAYWRIGHT_BIN" test --reporter=line --workers=1 "$AW_DIR/probe.spec.ts"
```

Walk the spec's steps with it:

1. Probe with `steps: []` to see the `start` page.
2. For each step, choose the action and locator from the `aria` snapshot by the
   ladder (try `hints` first), append it to `steps`, and probe again. A step
   that comes back `ok: true` and changes the page as the step intends is done.
   A `locator matched N elements` error means you must name the instance — add a
   `name`, or scope it with `within`.
3. A plain step that cannot be done as written gets at most 3 detour actions,
   each one probe, recorded as a deviation. A `[must-follow]` step gets none: if
   its target is not in the snapshot, the spec fails (unless contract § 6.4
   applies).
4. **Never replay a mutating step** (contract § 6.2 — save, submit, create,
   delete, send, or a persisted toggle). Append it with `"dry": true`: the
   probe checks that its locator matches one element and does not act. Then
   run one **commit launch** — the same `steps` with `dry` removed from that
   step, plus `checks` and `shot` (item 5) when it is the spec's last step.
   Read that step's `fired` — the `POST`/`PUT`/`PATCH`/`DELETE` requests it
   issued to `apiOrigins` within `settleMs`:
   - **Empty, and the step only opened a dialog, menu, or popover** — it was
     not the mutation (its confirm is). Mark it replayable and keep exploring
     from `start` as in item 2; the next step is the one to dry-resolve.
   - **Empty, and the step did more than open a dialog, menu, or popover** —
     treat it as the mutation anyway: never replay it, continue as for a
     non-empty `fired`, and put `fired: [] — treated as a mutation` in
     `notes` (its request went to an origin `apiOrigins` does not list, or
     landed after `settleMs`: add the origin, or raise `settleMs`).
   - **Not empty** — the mutation happened, in that launch only. To explore
     the steps after it, set `start` to the commit launch's `url` and `steps`
     to only the actions resolved after the mutation, so no later launch
     replays it. When the next step acts on UI the mutation left open — the
     commit launch's `aria` shows it and the re-launched page does not — stop:
     the remaining items are `unreachable: transient state lost` (contract
     § 6.4), never a fail. The Chrome driver, which never restarts, can run
     such a spec.
   Keep every commit launch's `requests` for the network items.
5. After the last step, probe once more with every candidate evidence locator in
   `checks` and `shot` set to the auto-final capture path when `--auto-capture`
   is on — when the last step was mutating, its commit launch is this probe.
   Grade each `expected` item from `checks` (a `locator:` line needs
   `n: 1` and the state the item claims), `requests` (a network item needs the
   exact `METHOD /path → NNN`), or the `text` of a check (a `text:` line).

## Probe budget

At most **20 probe launches per spec**. Hitting it is
`unreachable: explore budget exhausted`, exactly like the contract's 25-action
budget — whichever runs out first.

Delete `probe-in.json` and `probe-out.json` when the run ends; keep `routes/`.
