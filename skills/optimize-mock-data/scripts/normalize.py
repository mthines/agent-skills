#!/usr/bin/env python3
"""Rewrite a JSON / JSONL file with canonical formatting.

Canonical form:
    - 2-space indent (configurable)
    - LF line endings
    - trailing newline
    - sorted object keys (configurable; off by default since arrays
      of objects in fixtures often have a conventional reading order)
    - no trailing whitespace

Pure shape-preserving — round-trips back to the same Python object.

Usage:
    python3 normalize.py path/to/mock.json                   # stdout
    python3 normalize.py --in-place path/to/mock.json
    python3 normalize.py --in-place --sort-keys path/to/mock.json
    python3 normalize.py --in-place --indent 4 path/to/mock.json
    python3 normalize.py --in-place --fill-missing <ref.json> path/to/mock.json

Exit codes:
    0  rewrite succeeded (or no changes needed)
    2  invalid JSON
    3  round-trip mismatch (revert and abort — bug in this script)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def canonicalize(
    doc: Any, indent: int, sort_keys: bool
) -> str:
    return json.dumps(
        doc,
        indent=indent,
        sort_keys=sort_keys,
        ensure_ascii=False,
        separators=(",", ": "),
    ) + "\n"


def fill_missing(target: Any, reference: Any) -> Any:
    """Add keys present in `reference` but missing in `target` as null.

    Recurses into nested objects and into arrays element-wise (using
    the first reference element as the template).
    """
    if isinstance(reference, dict) and isinstance(target, dict):
        for k, ref_v in reference.items():
            if k not in target:
                target[k] = None
            else:
                target[k] = fill_missing(target[k], ref_v)
        return target
    if isinstance(reference, list) and isinstance(target, list):
        if reference and target:
            template = reference[0]
            return [fill_missing(el, template) for el in target]
        return target
    return target


def load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc.msg}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rewrite a JSON file with canonical formatting.",
    )
    parser.add_argument("path", help="File to normalize (.json or .jsonl).")
    parser.add_argument(
        "--in-place",
        "-i",
        action="store_true",
        help="Rewrite the file in place. Default: print to stdout.",
    )
    parser.add_argument(
        "--indent",
        type=int,
        default=2,
        help="Indent width in spaces (default 2).",
    )
    parser.add_argument(
        "--sort-keys",
        action="store_true",
        help="Sort object keys alphabetically. Default: preserve key order.",
    )
    parser.add_argument(
        "--fill-missing",
        metavar="REF",
        default=None,
        help="Reference file whose keys (recursive) get backfilled as null where missing.",
    )
    args = parser.parse_args()

    path = Path(args.path)
    if not path.exists():
        print(f"{path}: file not found", file=sys.stderr)
        return 3

    if path.suffix == ".jsonl":
        out_lines: list[str] = []
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                doc = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise SystemExit(
                    f"{path}:{lineno}: invalid JSON: {exc.msg}"
                )
            out_lines.append(
                json.dumps(doc, sort_keys=args.sort_keys, ensure_ascii=False)
            )
        rendered = "\n".join(out_lines) + "\n"
    else:
        doc = load(path)
        if args.fill_missing:
            ref_doc = load(Path(args.fill_missing))
            doc = fill_missing(doc, ref_doc)
        rendered = canonicalize(doc, args.indent, args.sort_keys)
        # Round-trip safety check.
        try:
            reparsed = json.loads(rendered)
        except json.JSONDecodeError as exc:
            print(f"{path}: round-trip parse failed: {exc.msg}", file=sys.stderr)
            return 3
        if reparsed != doc:
            print(
                f"{path}: round-trip mismatch — refusing to write",
                file=sys.stderr,
            )
            return 3

    if args.in_place:
        original = path.read_text(encoding="utf-8")
        if original == rendered:
            return 0
        path.write_text(rendered, encoding="utf-8")
        print(
            f"normalized {path} ({len(original)} → {len(rendered)} bytes)",
            file=sys.stderr,
        )
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    sys.exit(main())
