#!/usr/bin/env python3
"""Truncate verbose string fields in a JSON mock while preserving shape.

Every truncation:
    - leaves the document valid JSON
    - preserves keys, types, structure
    - appends "…(truncated, was N chars)" so the action is visible
      and idempotent
    - skips protected key names (ids, hashes, discriminator tags)
    - skips strings that look parseable (URLs, JSON-in-string, base64,
      PEM blocks)

Usage:
    python3 shrink.py path/to/mock.json                        # stdout
    python3 shrink.py --in-place path/to/mock.json
    python3 shrink.py --in-place --max-string 200 path/to/mock.json
    python3 shrink.py --in-place --max-string 500 --keep-urls path/to/mock.json

Exit codes:
    0  rewrite succeeded (or no changes needed)
    2  invalid JSON
    3  round-trip mismatch (revert and abort)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

TRUNCATION_MARKER_RE = re.compile(r"…\(truncated, was \d+ chars\)$")
BASE64_RE = re.compile(r"^[A-Za-z0-9+/]{40,}={0,2}$")
URL_RE = re.compile(r"^https?://", re.IGNORECASE)

PROTECTED_KEYS = {
    "hash",
    "actionId",
    "threadId",
    "userId",
    "panelId",
    "dashboardId",
    "traceId",
    "spanId",
    "sessionId",
    "key",
    "type",
    "role",
    "name",
    "version",
}

PROTECTED_KEY_SUFFIX_RE = re.compile(r"Id$")  # camelCase *Id keys


def is_protected_key(key: str) -> bool:
    if key in PROTECTED_KEYS:
        return True
    if key == "id":
        return True
    if PROTECTED_KEY_SUFFIX_RE.search(key):
        return True
    return False


def looks_parseable(value: str) -> str | None:
    """Return a label if `value` is something we should not blindly truncate."""
    trimmed = value.strip()
    if not trimmed:
        return None
    if trimmed.startswith("{") and trimmed.endswith("}"):
        return "json-object"
    if trimmed.startswith("[") and trimmed.endswith("]"):
        return "json-array"
    if URL_RE.match(trimmed):
        return "url"
    if trimmed.startswith("-----BEGIN"):
        return "pem"
    if BASE64_RE.match(trimmed):
        return "base64"
    return None


def shrink_url(value: str, max_string: int) -> str:
    """Keep scheme+host+path, collapse the query string."""
    # Split on the first '?'. Keep the prefix verbatim.
    prefix, _, query = value.partition("?")
    if not query:
        return value  # No query string to collapse.
    if len(value) <= max_string:
        return value
    return f"{prefix}?…(truncated, was {len(value)} chars)"


def shrink_string(
    value: str,
    max_string: int,
    keep_urls: bool,
) -> str:
    if TRUNCATION_MARKER_RE.search(value):
        return value  # Already truncated; idempotent.
    if len(value) <= max_string:
        return value
    label = looks_parseable(value)
    if label == "url" and not keep_urls:
        return shrink_url(value, max_string)
    if label is not None:
        return value  # Leave parseable strings alone.
    head_len = max(40, max_string - 40)
    return f"{value[:head_len]}…(truncated, was {len(value)} chars)"


def walk(
    node: Any,
    max_string: int,
    keep_urls: bool,
    parent_key: str | None = None,
    stats: dict[str, int] | None = None,
) -> Any:
    if stats is None:
        stats = {"truncated": 0, "skipped_protected": 0, "skipped_parseable": 0}
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            out[k] = walk(v, max_string, keep_urls, parent_key=k, stats=stats)
        return out
    if isinstance(node, list):
        return [
            walk(el, max_string, keep_urls, parent_key=parent_key, stats=stats)
            for el in node
        ]
    if isinstance(node, str):
        if parent_key is not None and is_protected_key(parent_key):
            if len(node) > max_string:
                stats["skipped_protected"] += 1
            return node
        if len(node) <= max_string:
            return node
        result = shrink_string(node, max_string, keep_urls)
        if result == node:
            stats["skipped_parseable"] += 1
        else:
            stats["truncated"] += 1
        return result
    return node


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Truncate verbose string fields while preserving shape.",
    )
    parser.add_argument("path", help="File to shrink (.json).")
    parser.add_argument(
        "--in-place",
        "-i",
        action="store_true",
        help="Rewrite the file in place. Default: print to stdout.",
    )
    parser.add_argument(
        "--max-string",
        type=int,
        default=200,
        help="Maximum string length before truncation (default 200).",
    )
    parser.add_argument(
        "--keep-urls",
        action="store_true",
        help="Do not collapse query strings on long URLs.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indent width in spaces (default 2).",
    )
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"{path}: file not found", file=sys.stderr)
        return 3

    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"{path}: invalid JSON: {exc.msg}", file=sys.stderr)
        return 2

    stats: dict[str, int] = {
        "truncated": 0,
        "skipped_protected": 0,
        "skipped_parseable": 0,
    }
    shrunk = walk(doc, args.max_string, args.keep_urls, stats=stats)

    rendered = json.dumps(shrunk, indent=args.indent, ensure_ascii=False) + "\n"

    # Round-trip safety check.
    try:
        reparsed = json.loads(rendered)
    except json.JSONDecodeError as exc:
        print(f"{path}: round-trip parse failed: {exc.msg}", file=sys.stderr)
        return 3
    if reparsed != shrunk:
        print(
            f"{path}: round-trip mismatch — refusing to write",
            file=sys.stderr,
        )
        return 3

    original_size = path.stat().st_size
    if args.in_place:
        original = path.read_text(encoding="utf-8")
        if original == rendered:
            print(
                f"{path}: no changes ({stats['truncated']} truncated, "
                f"{stats['skipped_protected']} protected, "
                f"{stats['skipped_parseable']} parseable)",
                file=sys.stderr,
            )
            return 0
        path.write_text(rendered, encoding="utf-8")
        new_size = path.stat().st_size
        print(
            f"shrunk {path} ({original_size} → {new_size} bytes, "
            f"{stats['truncated']} fields truncated, "
            f"{stats['skipped_protected']} protected, "
            f"{stats['skipped_parseable']} parseable)",
            file=sys.stderr,
        )
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
