#!/usr/bin/env python3
"""Cap arrays of data points inside artifact subtrees.

trim.py reduces fixture file size by limiting the length of arrays
of data points (telemetry records, time-series samples, attribute
lists, catalog entries) that sit somewhere under an `artifacts.*`
subtree. Top-level conversation arrays (`$.messages`, `$.thread.*`)
are never touched. Order is preserved — the first N entries are
kept, the rest are dropped.

trim never modifies any string under any condition. It only drops
trailing array entries. A message `content` field that says
"Below is a table with 50 web events ..." is left byte-identical
after trim runs.

Which arrays get trimmed is governed by a strict allowlist of
parent keys (see DATA_POINT_KEYS). Arrays whose parent key is not
on the list are left alone, even inside `artifacts.*` — that keeps
structural arrays (e.g. `panels`, `widgets`, `queries`) intact.

Idempotent: a second run with the same flags is a no-op.
Round-trip-safe: re-parses the rendered output before writing.
Indent-preserving: detects the source file's indentation (tab vs
N-space) and renders with the same indent unless `--indent` is set.

Usage:
    python3 trim.py path/to/mock.json
    python3 trim.py --in-place path/to/mock.json
    python3 trim.py --in-place --max-array webEvents=2 path/to/mock.json

Exit codes:
    0  rewrite succeeded (or no changes needed)
    2  invalid JSON
    3  round-trip mismatch or top-level message-count regression
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

# Strict allowlist. Only arrays whose immediate parent key is one of
# these get a budget. Anything else is left alone. No "default"
# fallback — adding a fallback would risk trimming structural arrays
# (panels, widgets, queries, etc.) the consumer needs intact.
DATA_POINT_KEYS: dict[str, int] = {
    "webEvents": 2,
    "logRecords": 2,
    "scopeLogs": 1,
    "scopeSpans": 1,
    "resourceSpans": 1,
    "series": 3,
    "dataPoints": 5,
    "points": 5,
    "samples": 5,
    "metrics": 3,
    "events": 2,
    "spans": 2,
    "rows": 3,
    "records": 3,
    "results": 3,
    "attributes": 5,
    "catalog": 3,
}

PROTECTED_ROOT_KEYS = {"messages", "thread"}


def parse_overrides(raw: list[str]) -> dict[str, int]:
    budgets = dict(DATA_POINT_KEYS)
    for entry in raw:
        if "=" not in entry:
            raise SystemExit(f"--max-array expects key=value, got {entry!r}")
        key, _, val = entry.partition("=")
        budgets[key.strip()] = int(val.strip())
    return budgets


def detect_indent(source: str) -> int | str:
    """Detect indent from the source. Returns int (n spaces) or '\\t'."""
    for line in source.splitlines():
        if not line or line[0] not in (" ", "\t"):
            continue
        if line[0] == "\t":
            return "\t"
        n = 0
        for ch in line:
            if ch == " ":
                n += 1
            else:
                break
        if n > 0:
            return n
    return 2


def walk(
    node: Any,
    budgets: dict[str, int],
    ancestry: tuple[str, ...] = (),
    stats: dict[str, int] | None = None,
) -> Any:
    if stats is None:
        stats = {"trimmed": 0, "scanned": 0}
    if isinstance(node, dict):
        return {
            k: walk(v, budgets, ancestry + (k,), stats=stats)
            for k, v in node.items()
        }
    if isinstance(node, list):
        parent_key = ancestry[-1] if ancestry else ""
        inside_artifact = "artifacts" in ancestry
        # Refuse to descend into protected top-level subtrees reached
        # without crossing an artifact ancestor.
        if (
            ancestry
            and ancestry[0] in PROTECTED_ROOT_KEYS
            and not inside_artifact
        ):
            return [
                walk(el, budgets, ancestry + (str(i),), stats=stats)
                for i, el in enumerate(node)
            ]
        if inside_artifact and parent_key in budgets:
            stats["scanned"] += 1
            limit = budgets[parent_key]
            if len(node) > limit:
                stats["trimmed"] += 1
                node = node[:limit]
        return [
            walk(el, budgets, ancestry + (str(i),), stats=stats)
            for i, el in enumerate(node)
        ]
    # Strings, numbers, bools, null — return verbatim. NEVER modify.
    return node


def render(doc: Any, indent: int | str) -> str:
    if indent == "\t":
        text = json.dumps(doc, indent="\t", ensure_ascii=False)
    else:
        text = json.dumps(doc, indent=int(indent), ensure_ascii=False)
    return text + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Cap arrays of data points inside artifact subtrees. "
            "Never modifies strings."
        ),
    )
    parser.add_argument("path", help="File to trim (.json).")
    parser.add_argument(
        "--in-place",
        "-i",
        action="store_true",
        help="Rewrite the file in place. Default: print to stdout.",
    )
    parser.add_argument(
        "--max-array",
        action="append",
        default=[],
        metavar="KEY=N",
        help=(
            "Per-key entry budget. Repeatable. "
            "Overrides the built-in DATA_POINT_KEYS allowlist for that key. "
            "Keys outside the allowlist remain ignored unless added here."
        ),
    )
    parser.add_argument(
        "--indent",
        default=None,
        help=(
            "Indent: integer for N spaces, or 'tab'. "
            "Default: detect from source file (preserves tabs vs 2-space)."
        ),
    )
    args = parser.parse_args()

    budgets = parse_overrides(args.max_array)

    path = Path(args.path)
    if not path.exists():
        print(f"{path}: file not found", file=sys.stderr)
        return 3

    source = path.read_text(encoding="utf-8")
    try:
        doc = json.loads(source)
    except json.JSONDecodeError as exc:
        print(f"{path}: invalid JSON: {exc.msg}", file=sys.stderr)
        return 2

    pre_messages = (
        len(doc.get("messages", [])) if isinstance(doc, dict) else None
    )

    stats: dict[str, int] = {"trimmed": 0, "scanned": 0}
    trimmed = walk(doc, budgets, stats=stats)

    post_messages = (
        len(trimmed.get("messages", []))
        if isinstance(trimmed, dict)
        else None
    )
    if pre_messages is not None and pre_messages != post_messages:
        print(
            f"{path}: top-level messages count changed "
            f"({pre_messages} → {post_messages}); refusing to write",
            file=sys.stderr,
        )
        return 3

    if args.indent is None:
        indent: int | str = detect_indent(source)
    elif args.indent == "tab":
        indent = "\t"
    else:
        indent = int(args.indent)

    rendered = render(trimmed, indent)

    try:
        reparsed = json.loads(rendered)
    except json.JSONDecodeError as exc:
        print(f"{path}: round-trip parse failed: {exc.msg}", file=sys.stderr)
        return 3
    if reparsed != trimmed:
        print(
            f"{path}: round-trip mismatch — refusing to write",
            file=sys.stderr,
        )
        return 3

    original_size = path.stat().st_size
    if args.in_place:
        # True no-op when nothing was trimmed: do not rewrite, even if
        # canonical formatting would differ from the source's hand-written
        # layout. Trim is array-cardinality only; reformatting is normalize.
        if stats["trimmed"] == 0 or source == rendered:
            print(
                f"{path}: no changes ({stats['trimmed']} trimmed, "
                f"{stats['scanned']} arrays scanned)",
                file=sys.stderr,
            )
            return 0
        path.write_text(rendered, encoding="utf-8")
        new_size = path.stat().st_size
        print(
            f"trimmed {path} ({original_size} → {new_size} bytes, "
            f"{stats['trimmed']} arrays trimmed, "
            f"{stats['scanned']} arrays scanned)",
            file=sys.stderr,
        )
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
