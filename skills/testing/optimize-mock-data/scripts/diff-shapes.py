#!/usr/bin/env python3
"""Cluster a directory of JSON mocks by shape and report drift.

Reads every *.json file under <path> (recursively, excluding
node_modules/dist/.next/coverage), computes the shape fingerprint of
each, clusters by fingerprint match, picks the largest cluster as the
reference, and reports drift sites (missing keys, extra keys, type
drift) sorted by severity (HIGH > MED > LOW).

Severity rubric:
    HIGH — type drift on the same key path
    MED  — missing required-looking key in > 25 % of files
    LOW  — missing optional-looking key or extra key in < 25 %

Usage:
    python3 diff-shapes.py path/to/mocks/
    python3 diff-shapes.py path/to/mocks/ --glob "invoke-agent-artifacts-*.json"
    python3 diff-shapes.py file1.json file2.json file3.json    # explicit files

Exit codes:
    0  no drift
    1  drift detected (any severity)
    2  invalid JSON in at least one file
    3  fewer than 2 files resolved
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

# Local-import-friendly: shape() lives in shape.py next to this file.
sys.path.insert(0, str(Path(__file__).parent))
from shape import shape  # type: ignore  # noqa: E402

EXCLUDED_DIRS = {"node_modules", "dist", ".next", "coverage", ".git", "build"}


def resolve_files(paths: list[str], glob: str | None) -> list[Path]:
    out: list[Path] = []
    for arg in paths:
        p = Path(arg)
        if p.is_dir():
            pattern = glob or "**/*.json"
            for candidate in p.glob(pattern):
                if any(part in EXCLUDED_DIRS for part in candidate.parts):
                    continue
                out.append(candidate)
        elif p.is_file():
            out.append(p)
        else:
            print(f"warning: {arg} does not exist", file=sys.stderr)
    return sorted(set(out))


def walk_paths(node: Any, prefix: str = "") -> dict[str, str]:
    """Return {path: type-token} for every leaf-and-container in node.

    Path notation:
        thread.id
        messages[].role
        messages[].cost.dimensions[].key
    """
    out: dict[str, str] = {}
    if isinstance(node, dict):
        for k, v in node.items():
            child = f"{prefix}.{k}" if prefix else k
            out[child] = type_token(v)
            out.update(walk_paths(v, child))
    elif isinstance(node, list):
        # Merge paths from every element under the same [] suffix.
        for el in node:
            child = f"{prefix}[]"
            sub = walk_paths(el, child)
            for k, v in sub.items():
                # On conflict, prefer 'union' over a single type.
                if k in out and out[k] != v:
                    out[k] = merge_token(out[k], v)
                else:
                    out[k] = v
    return out


def type_token(node: Any) -> str:
    if node is None:
        return "null"
    if isinstance(node, bool):
        return "boolean"
    if isinstance(node, (int, float)):
        return "number"
    if isinstance(node, str):
        return "string"
    if isinstance(node, list):
        return "array"
    if isinstance(node, dict):
        return "object"
    return "unknown"


def merge_token(a: str, b: str) -> str:
    parts = sorted(set(a.split("|") + b.split("|")))
    return "|".join(parts)


def load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc.msg}")


def cluster_files(files: list[Path]) -> tuple[dict[str, list[Path]], dict[Path, Any]]:
    clusters: dict[str, list[Path]] = defaultdict(list)
    parsed: dict[Path, Any] = {}
    for path in files:
        doc = load(path)
        parsed[path] = doc
        fp = shape(doc)
        clusters[fp].append(path)
    return clusters, parsed


def pick_reference(clusters: dict[str, list[Path]]) -> str:
    items = sorted(
        clusters.items(),
        key=lambda kv: (-len(kv[1]), -max(p.stat().st_mtime for p in kv[1])),
    )
    return items[0][0]


def diff_paths(
    ref_paths: dict[str, str], outlier_paths: dict[str, str]
) -> dict[str, list[tuple[str, str, str]]]:
    """Return {category: [(path, ref_type, out_type)]}."""
    missing: list[tuple[str, str, str]] = []
    extra: list[tuple[str, str, str]] = []
    type_drift: list[tuple[str, str, str]] = []
    for path, ref_type in ref_paths.items():
        if path not in outlier_paths:
            missing.append((path, ref_type, "<missing>"))
            continue
        out_type = outlier_paths[path]
        if out_type != ref_type and out_type not in ref_type.split("|"):
            type_drift.append((path, ref_type, out_type))
    for path, out_type in outlier_paths.items():
        if path not in ref_paths:
            extra.append((path, "<not present>", out_type))
    return {"missing": missing, "extra": extra, "type_drift": type_drift}


def severity(category: str, occurrences: int, total: int) -> str:
    if category == "type_drift":
        return "HIGH"
    ratio = occurrences / total if total else 0
    if category == "missing" and ratio > 0.25:
        return "MED"
    return "LOW"


def detect_formatting(files: list[Path]) -> dict[str, Any]:
    indents = {"2-space": 0, "4-space": 0, "tab": 0, "minified": 0}
    trailing_newline = 0
    no_trailing_newline = 0
    crlf = 0
    for path in files:
        raw = path.read_text(encoding="utf-8")
        if "\r\n" in raw:
            crlf += 1
        if raw.endswith("\n"):
            trailing_newline += 1
        else:
            no_trailing_newline += 1
        if "\n" not in raw.rstrip():
            indents["minified"] += 1
            continue
        sample_lines = [ln for ln in raw.splitlines()[1:20] if ln.strip()]
        tab_lines = sum(1 for ln in sample_lines if ln.startswith("\t"))
        two_space_lines = sum(
            1 for ln in sample_lines if ln.startswith("  ") and not ln.startswith("    ")
        )
        four_space_lines = sum(1 for ln in sample_lines if ln.startswith("    "))
        if tab_lines >= two_space_lines and tab_lines >= four_space_lines and tab_lines:
            indents["tab"] += 1
        elif four_space_lines > two_space_lines:
            indents["4-space"] += 1
        else:
            indents["2-space"] += 1
    return {
        "indents": indents,
        "trailing_newline_present": trailing_newline,
        "trailing_newline_missing": no_trailing_newline,
        "crlf_files": crlf,
    }


def render_report(
    corpus_root: str,
    files: list[Path],
    clusters: dict[str, list[Path]],
    parsed: dict[Path, Any],
    reference_fp: str,
) -> tuple[str, int]:
    lines: list[str] = []
    lines.append("Optimize-Mock-Data Report")
    lines.append("=" * 25)
    lines.append(f"Corpus: {corpus_root} ({len(files)} files)")
    outlier_count = len(clusters) - 1
    ref_size = len(clusters[reference_fp])
    lines.append(
        f"Clusters: {len(clusters)} (reference: {ref_size} files / outlier clusters: {outlier_count})"
    )
    lines.append("")
    lines.append(f"Reference cluster ({ref_size} files):")
    for p in clusters[reference_fp][:8]:
        lines.append(f"  - {p.name}")
    if ref_size > 8:
        lines.append(f"  ... ({ref_size - 8} more)")
    lines.append(
        f"Fingerprint sha256: {hashlib.sha256(reference_fp.encode()).hexdigest()[:16]}…"
    )
    lines.append("")

    # Build reference path index from one reference file.
    ref_file = clusters[reference_fp][0]
    ref_paths = walk_paths(parsed[ref_file])

    drift_sites: list[dict[str, Any]] = []
    for fp, paths in clusters.items():
        if fp == reference_fp:
            continue
        outlier_doc = parsed[paths[0]]
        outlier_paths = walk_paths(outlier_doc)
        delta = diff_paths(ref_paths, outlier_paths)
        for category, entries in delta.items():
            for path, ref_type, out_type in entries:
                drift_sites.append(
                    {
                        "category": category,
                        "path": path,
                        "ref_type": ref_type,
                        "out_type": out_type,
                        "files": paths,
                        "frequency": len(paths),
                    }
                )

    # Severity-sort.
    def severity_rank(d: dict[str, Any]) -> int:
        return {"HIGH": 0, "MED": 1, "LOW": 2}[
            severity(d["category"], d["frequency"], len(files))
        ]

    drift_sites.sort(key=lambda d: (severity_rank(d), -d["frequency"]))

    high = sum(
        1 for d in drift_sites if severity(d["category"], d["frequency"], len(files)) == "HIGH"
    )
    med = sum(
        1 for d in drift_sites if severity(d["category"], d["frequency"], len(files)) == "MED"
    )
    low = sum(
        1 for d in drift_sites if severity(d["category"], d["frequency"], len(files)) == "LOW"
    )

    lines.append(f"Drift sites ({len(drift_sites)} total — H:{high} M:{med} L:{low}):")
    lines.append("")
    if not drift_sites:
        lines.append("  None — every file shares the reference shape.")
    for d in drift_sites:
        sev = severity(d["category"], d["frequency"], len(files))
        lines.append(
            f"  {sev} — {d['path']:<50} ({d['frequency']}/{len(files)} files)"
        )
        lines.append(f"    Reference type: {d['ref_type']}")
        lines.append(f"    Outlier type:   {d['out_type']}")
        sample_files = ", ".join(p.name for p in d["files"][:3])
        suffix = "" if len(d["files"]) <= 3 else f", ... (+{len(d['files']) - 3})"
        lines.append(f"    Files: {sample_files}{suffix}")
        lines.append("")

    fmt = detect_formatting(files)
    lines.append("Formatting:")
    indents_summary = ", ".join(f"{n} {k}" for k, n in fmt["indents"].items() if n)
    lines.append(f"  Indentation: {indents_summary}")
    lines.append(
        f"  Trailing newline: {fmt['trailing_newline_present']} present, "
        f"{fmt['trailing_newline_missing']} missing"
    )
    lines.append(
        f"  Line endings: {'mixed (CRLF detected)' if fmt['crlf_files'] else 'all LF'}"
    )
    lines.append("")

    recs: list[str] = []
    if any(severity(d["category"], d["frequency"], len(files)) == "HIGH" for d in drift_sites):
        recs.append("HIGH severity drift detected — hand-review before normalizing.")
    if fmt["indents"]["tab"] and fmt["indents"]["2-space"]:
        recs.append(
            "Mixed indentation: run `python3 scripts/normalize.py --in-place <path>` to canonicalize."
        )
    if med:
        recs.append(
            "Backfill missing required-looking keys, or mark them officially optional."
        )
    if not recs:
        recs.append("Looks consistent — no action needed.")
    lines.append("Recommendations:")
    for i, r in enumerate(recs, 1):
        lines.append(f"  {i}. {r}")
    lines.append("")
    lines.append(
        f"Summary: {len(files)} files / {len(clusters)} clusters / "
        f"{len(drift_sites)} drift sites (HIGH:{high} MED:{med} LOW:{low})"
    )

    exit_code = 0 if not drift_sites else 1
    return "\n".join(lines), exit_code


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Cluster JSON mocks by shape and report drift.",
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="Directory or list of files to analyze.",
    )
    parser.add_argument(
        "--glob",
        default=None,
        help='Glob filter when path is a directory (default "**/*.json").',
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable JSON report instead of the text format.",
    )
    args = parser.parse_args()

    files = resolve_files(args.paths, args.glob)
    if len(files) < 2:
        print(
            f"error: need at least 2 files to detect drift; resolved {len(files)}",
            file=sys.stderr,
        )
        return 3

    corpus_root = (
        str(args.paths[0]) if len(args.paths) == 1 else f"{len(args.paths)} files"
    )
    clusters, parsed = cluster_files(files)
    reference_fp = pick_reference(clusters)

    if args.json:
        result = {
            "corpus": corpus_root,
            "files": [str(p) for p in files],
            "cluster_count": len(clusters),
            "reference_size": len(clusters[reference_fp]),
            "reference_fingerprint_sha256": hashlib.sha256(
                reference_fp.encode()
            ).hexdigest(),
        }
        print(json.dumps(result, indent=2))
        return 0 if len(clusters) == 1 else 1

    report, exit_code = render_report(
        corpus_root, files, clusters, parsed, reference_fp
    )
    print(report)
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
