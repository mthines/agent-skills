---
title: Network Analysis — Reading the trace.network stream
impact: HIGH
tags:
  - network
  - waterfall
  - request-timing
  - failures
---

# Network Analysis

Most action timeouts are blocked on a request. Read the network stream
before drawing conclusions about a slow or failed action.

## Anatomy of a request

```
{"type":"requestEvent","requestId":"req-12","url":"http://localhost:3000/api/save","method":"POST","headers":[...],"timestamp":1714000005140,"frameId":"f-1"}
{"type":"responseEvent","requestId":"req-12","status":200,"timestamp":1714000007800,"headers":[...]}
{"type":"requestFinishedEvent","requestId":"req-12","timestamp":1714000007920,"transferSize":1240,"encodedBodySize":820}
```

- **TTFB:** `responseEvent.timestamp - requestEvent.timestamp` (ms).
- **Total:** `requestFinishedEvent.timestamp - requestEvent.timestamp` (ms).
- **Failures:** `requestFailedEvent.errorText` (e.g.
  `net::ERR_CONNECTION_REFUSED`, `net::ERR_ABORTED`).

## Extraction (jq)

```bash
# Top 15 slowest completed requests
jq -s '
  group_by(.requestId)
  | map({
      requestId: .[0].requestId,
      url: (.[0].url // (.[] | select(.type=="requestEvent") | .url) // null),
      method: (.[0].method // null),
      ttfb_ms: (
        (.[] | select(.type=="responseEvent") | .timestamp) -
        (.[] | select(.type=="requestEvent")  | .timestamp)
      ),
      total_ms: (
        (.[] | select(.type=="requestFinishedEvent" or .type=="requestFailedEvent") | .timestamp) -
        (.[] | select(.type=="requestEvent") | .timestamp)
      ),
      status: (.[] | select(.type=="responseEvent") | .status // null),
      failed: (any(.type=="requestFailedEvent")),
      error: (.[] | select(.type=="requestFailedEvent") | .errorText // null)
    })
  | sort_by(-.total_ms)
  | .[:15]
' trace.network
```

For larger traces, use
[`scripts/trace-summary.mjs`](../scripts/trace-summary.mjs).

## What to look for, in order

| # | Signal                                                           | Meaning                                                              |
| - | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1 | Any `requestFailedEvent`                                          | Hard failure — almost always the root cause if it overlaps an action |
| 2 | TTFB > 5,000ms                                                    | Backend or proxy is slow                                             |
| 3 | A request that started before the action and never finished       | Action timed out waiting for it (or `networkidle`)                   |
| 4 | Bursts of identical requests (same URL, same method)              | Redux/RTK loops; useEffect missing dep; SWR stampede                 |
| 5 | 4xx / 5xx on the critical path                                    | Auth / config issue; mock or fixture missing                         |
| 6 | Large `transferSize` (> 5 MB) on a single request                 | Response payload too big for E2E to wait through                     |
| 7 | Many requests > 100 to a single host                              | Chatty client; should be batched or paginated server-side            |
| 8 | Mixed http vs. https or wrong base URL                            | Misconfigured `baseURL`; webserver booted on a different port        |

## Correlate request → action

Pair a request to the action that triggered it by:

1. **Time window:** the request `timestamp` falls between
   `before.startTime` and `after.endTime` of an action.
2. **Frame id:** Playwright records `frameId` on both — usually equal
   for in-page requests.
3. **Initiator:** if the trace includes `args.data.initiator`, use it
   directly.

When an action times out:

- If a request is still pending at `after.endTime`, it is the most
  likely cause.
- If the request completed in 200ms but the action still timed out,
  the cause is in the **client-side handler** of the response, not the
  network.

## Worker / dev-server gotchas

- `net::ERR_CONNECTION_REFUSED` on the very first `goto` → dev server
  did not boot in time. Check `webServer.timeout` in
  `playwright.config.ts`.
- `net::ERR_ABORTED` mid-test → page navigated away (re-renders that
  unmount the in-flight fetch).
- `net::ERR_INTERNET_DISCONNECTED` → CI runner lost outbound network;
  not a test bug, surface to user.

## Examples

### Good — finding

> `POST /api/save` (req-12) was issued at +5,140ms (during
> `click('Save')`) and never received a response. `requestFailedEvent`
> at +35,140ms with `net::ERR_FAILED`. The corresponding click action
> timed out at +35,127ms. Root cause: backend pod unhealthy during the
> CI run — confirmed by the `503` on the next probe at +35,200ms.
> Action: this is environmental flake; retry on transient API failures
> or pre-warm the backend health-check before the test.

### Bad — finding

> The click failed because the page was slow.

Why bad: no request, no status, no number, no path.

## Common mistakes

- **Looking only at the action without the network log.** Most action
  timeouts are network-bound. **Fix:** always cross-reference.
- **Reporting `transferSize` as the time cost.** Size and time are
  correlated but not equivalent. **Fix:** report both.
- **Treating `net::ERR_ABORTED` as a failure.** Abortion is
  often-correct (page navigated). **Fix:** only call it a failure if
  it overlaps with an in-flight test action.
- **Ignoring HTTP/2 + service workers.** A SW can `respondWith` a
  cached response that bypasses the wire. **Fix:** look for
  `frame.evaluate` setup that registers a SW.
