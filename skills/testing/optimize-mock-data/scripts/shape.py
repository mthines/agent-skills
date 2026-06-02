#!/usr/bin/env python3
"""Emit a deterministic JSON shape fingerprint for a file or stdin.

Reads a JSON document (or one document per line for .jsonl) and
prints a canonical shape signature where:

  - object keys are sorted alphabetically
  - leaf values are replaced with their type (string|number|boolean|null)
  - heterogeneous arrays become union(...)
  - empty arrays are []

Usage:
    python3 shape.py path/to/file.json
    python3 shape.py path/to/file.jsonl
    python3 shape.py --sha256 path/to/file.json   # emit only the sha256 of the fingerprint
    cat file.json | python3 shape.py -

Exit codes:
    0  success
    2  invalid JSON
    3  file not found
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


def shape(node: Any) -> str:
    """Return the canonical shape string for a parsed JSON node."""
    if node is None:
        return "null"
    if isinstance(node, bool):
        return "boolean"
    if isinstance(node, (int, float)):
        return "number"
    if isinstance(node, str):
        return "string"
    if isinstance(node, list):
        if not node:
            return "[]"
        element_shapes = sorted({shape(el) for el in node})
        if len(element_shapes) == 1:
            return f"[{element_shapes[0]}]"
        return f"[union({','.join(element_shapes)})]"
    if isinstance(node, dict):
        if not node:
            return "{}"
        parts = [f"{k}:{shape(v)}" for k, v in sorted(node.items())]
        return "{" + ",".join(parts) + "}"
    raise TypeError(f"Unsupported JSON node type: {type(node).__name__}")


def fingerprint_file(path: Path) -> list[str]:
    """Return a list of fingerprints (one per document for jsonl, one for json)."""
    raw = path.read_text(encoding="utf-8")
    if path.suffix == ".jsonl":
        results: list[str] = []
        for lineno, line in enumerate(raw.splitlines(), 1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                doc = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(
                    f"{path}:{lineno}: invalid JSON on line {lineno}: {exc.msg}"
                )
            results.append(shape(doc))
        return results
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc.msg}")
    return [shape(doc)]


def parse_stdin() -> list[str]:
    raw = sys.stdin.read()
    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"<stdin>: invalid JSON: {exc.msg}")
    return [shape(doc)]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Emit a deterministic JSON shape fingerprint.",
    )
    parser.add_argument(
        "path",
        help="Path to a .json or .jsonl file, or '-' for stdin.",
    )
    parser.add_argument(
        "--sha256",
        action="store_true",
        help="Emit only the sha256 of the fingerprint (handy for clustering).",
    )
    args = parser.parse_args()

    if args.path == "-":
        fingerprints = parse_stdin()
    else:
        path = Path(args.path)
        if not path.exists():
            print(f"{path}: file not found", file=sys.stderr)
            return 3
        fingerprints = fingerprint_file(path)

    for fp in fingerprints:
        if args.sha256:
            print(hashlib.sha256(fp.encode("utf-8")).hexdigest())
        else:
            print(fp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
