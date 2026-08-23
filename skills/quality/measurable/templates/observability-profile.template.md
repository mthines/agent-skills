# Observability Profile

> Written by `measurable` `setup` mode. Committed via
> `persistent-memory` (`project-shared` tier). Re-run setup to update —
> see [`../rules/setup-profile.md`](../rules/setup-profile.md).

Last updated: <yyyy-mm-dd>

## Package Map

Keep this table first — `scope-detection.md` Step 1 reads only this table.

| Path glob         | Kind        | Telemetry stack        | RUM/analytics stack | Defers to skill (if any) |
| ------------------ | ----------- | ------------------------ | --------------------- | --------------------------- |
| `apps/web/**`       | `web`       | Dash0 SDK Web             | Dash0 SDK Web          | `rum-tracking`               |
| `apps/mobile/**`    | `mobile`    | Dash0 SDK RN              | Dash0 SDK RN           | `rum-tracking`               |
| `services/api/**`   | `api`       | OpenTelemetry SDK (Node)  | —                      | —                            |
| `services/worker/**`| `worker`    | OpenTelemetry SDK (Node)  | —                      | —                            |
| `packages/ui/**`    | `shared-lib`| —                         | —                      | —                            |

Replace with the confirmed rows from the setup interview. A single-repo
(non-monorepo) project still fills this table with one row covering the
whole tree.

## Regression Detection Surface

- Existing dashboards: <name/link, or "none yet">
- Existing check rules: <name/link, or "none yet">
- Status: <"covered" | "propose-via-dash0-chat pending">

## Notes

- <any stack quirks, migration-in-progress state, or deliberate exceptions
  the setup interview surfaced>
