/**
 * Parser for `.agent/{branch}/checks.yaml` — the executable acceptance-check
 * ledger written by `aw-create-plan` and status-flipped by the aw-executor's
 * Phase 4 check loop.
 *
 * The file is machine-emitted with a fixed, flat schema (a YAML list of flat
 * maps with known keys), so this is a tolerant line-based reader rather than
 * a full YAML parser — same convention as the other hand-rolled parsers in
 * this directory. Pure Node.js, no VS Code dependency, vitest-testable.
 *
 * The extension is a read-only observer of this file: check definitions are
 * executor-immutable and `status:` is executor-owned, so nothing in here (or
 * anywhere else in the extension) writes to it.
 */

export type CheckStatus = 'pending' | 'pass' | 'fail' | 'unsatisfiable';

export interface ParsedCheck {
  /** Check id, e.g. `AC-1`. Entries without an id are skipped. */
  id: string;
  /** Requirement annotation, e.g. `R1` or `R6, R8`. */
  requirement?: string;
  /** EARS criterion text — the human-readable contract for this check. */
  ears?: string;
  kind?: 'command' | 'grep' | 'judge';
  expect?: string;
  /** Unknown or missing statuses normalize to `pending`. */
  status: CheckStatus;
}

export interface ParsedChecks {
  checks: ParsedCheck[];
}

export interface ChecksSummary {
  total: number;
  pass: number;
  fail: number;
  unsatisfiable: number;
  pending: number;
}

const STATUSES: ReadonlySet<string> = new Set(['pending', 'pass', 'fail', 'unsatisfiable']);
const KINDS: ReadonlySet<string> = new Set(['command', 'grep', 'judge']);

/** Keys read off each entry. Unknown keys (setup, run, …) are ignored for display. */
const ENTRY_START = /^-\s+id:\s*(.*)$/;
const ENTRY_FIELD = /^\s+([A-Za-z_]+):\s*(.*)$/;

/**
 * Strip an inline YAML value down to its content: quoted values keep
 * everything between the quotes (including `#` and `:`); unquoted values are
 * cut at the first ` #` inline-comment marker and trimmed.
 */
function cleanValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    if ((first === '"' || first === "'") && trimmed.lastIndexOf(first) > 0) {
      return trimmed.slice(1, trimmed.lastIndexOf(first));
    }
  }
  const commentIdx = trimmed.search(/\s#/);
  return (commentIdx >= 0 ? trimmed.slice(0, commentIdx) : trimmed).trim();
}

function normalizeStatus(value: string | undefined): CheckStatus {
  return value !== undefined && STATUSES.has(value) ? (value as CheckStatus) : 'pending';
}

/**
 * Parse a checks.yaml body. Tolerant: comments, blank lines, unknown keys,
 * and malformed entries are skipped; an entry without an `id` is dropped;
 * unknown statuses normalize to `pending`. Malformed or empty input yields
 * `{ checks: [] }` — the caller renders nothing, same as an absent file.
 */
export function parseChecksYaml(content: string): ParsedChecks {
  const checks: ParsedCheck[] = [];
  let current: Partial<Record<string, string>> | undefined;

  const flush = (): void => {
    if (!current) return;
    const id = current.id;
    if (id) {
      const kind = current.kind;
      checks.push({
        id,
        requirement: current.requirement || undefined,
        ears: current.ears || undefined,
        kind: kind !== undefined && KINDS.has(kind) ? (kind as ParsedCheck['kind']) : undefined,
        expect: current.expect || undefined,
        status: normalizeStatus(current.status),
      });
    }
    current = undefined;
  };

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;

    const start = ENTRY_START.exec(line);
    if (start) {
      flush();
      current = { id: cleanValue(start[1]) };
      continue;
    }

    if (current) {
      const field = ENTRY_FIELD.exec(line);
      if (field) {
        current[field[1]] = cleanValue(field[2]);
      }
    }
  }
  flush();

  return { checks };
}

export function summarizeChecks(checks: ParsedCheck[]): ChecksSummary {
  const summary: ChecksSummary = { total: checks.length, pass: 0, fail: 0, unsatisfiable: 0, pending: 0 };
  for (const check of checks) {
    summary[check.status]++;
  }
  return summary;
}

/**
 * Compact rollup for TreeItem descriptions — `✓ 3/7`. Empty string when
 * there are no checks so callers can append it conditionally. Deliberately
 * short: VS Code clips long descriptions on narrow panels.
 */
export function formatChecksRollup(summary: ChecksSummary): string {
  if (summary.total === 0) return '';
  return `✓ ${summary.pass}/${summary.total}`;
}

/**
 * Returns the ids of checks that newly transitioned INTO `unsatisfiable`
 * relative to the previously observed statuses.
 *
 * - `prev === undefined` means no baseline exists yet (first sighting of the
 *   file) — no transition can be observed, so nothing is reported.
 * - A wholesale reset to `pending` (plan re-iteration re-derives the file)
 *   reports nothing: no check is unsatisfiable in `next`.
 * - A check already `unsatisfiable` in `prev` is not re-reported, so a
 *   notification fires once per transition, not once per watcher tick.
 */
export function diffNewUnsatisfiable(
  prev: ReadonlyMap<string, CheckStatus> | undefined,
  next: ParsedCheck[]
): string[] {
  if (prev === undefined) return [];
  return next
    .filter((c) => c.status === 'unsatisfiable' && prev.get(c.id) !== 'unsatisfiable')
    .map((c) => c.id);
}

/** Convenience: `id → status` map used as the watcher's per-file baseline. */
export function statusMapOf(checks: ParsedCheck[]): Map<string, CheckStatus> {
  return new Map(checks.map((c) => [c.id, c.status]));
}
