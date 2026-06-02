// Heap snapshot summariser.
//
// Reads a Chrome DevTools `.heapsnapshot` file, prints:
//   - total node count and self_size
//   - breakdown by node type (object, closure, native, array, string, code, ...)
//   - top N constructors by total self_size (with object counts)
//
// Usage:
//   node --max-old-space-size=4096 heap-summary.mjs <snapshot.heapsnapshot> [topN]
//
// `--max-old-space-size=4096` is required for snapshots > ~150 MB on disk;
// raise it for larger snapshots (real apps often produce 400–800 MB files).
//
// File format reference: https://v8.dev/blog/heap-snapshots
// The shape is JSON with a flat `nodes` integer array; each node is described
// by `meta.node_fields.length` consecutive integers (typically 6).

import { readFileSync } from "fs";

const path = process.argv[2];
const topN = parseInt(process.argv[3] ?? "25", 10);

if (!path) {
	console.error("Usage: node heap-summary.mjs <snapshot.heapsnapshot> [topN]");
	process.exit(1);
}

const snap = JSON.parse(readFileSync(path, "utf-8"));

const NODE_FIELDS = snap.snapshot.meta.node_fields.length;
const NODE_TYPES = snap.snapshot.meta.node_types[0];
const TYPE_IDX = snap.snapshot.meta.node_fields.indexOf("type");
const NAME_IDX = snap.snapshot.meta.node_fields.indexOf("name");
const SELF_SIZE_IDX = snap.snapshot.meta.node_fields.indexOf("self_size");
const nodes = snap.nodes;
const strings = snap.strings;
const nodeCount = snap.snapshot.node_count;

let totalSelfSize = 0;
const byType = new Map();
const byConstructor = new Map();

for (let i = 0; i < nodeCount; i++) {
	const base = i * NODE_FIELDS;
	const type = NODE_TYPES[nodes[base + TYPE_IDX]];
	const nameIdx = nodes[base + NAME_IDX];
	const selfSize = nodes[base + SELF_SIZE_IDX];

	totalSelfSize += selfSize;
	byType.set(type, (byType.get(type) ?? 0) + selfSize);

	// Group by constructor name. `object` and `closure` carry a JS class /
	// function name; `native` carries a DOM/Web API constructor name.
	if (type === "object" || type === "closure" || type === "native") {
		const name = strings[nameIdx] || "<unknown>";
		const e = byConstructor.get(name) ?? { size: 0, count: 0 };
		e.size += selfSize;
		e.count += 1;
		byConstructor.set(name, e);
	}
}

const mb = (b) => (b / 1024 / 1024).toFixed(1);

console.log(`File: ${path}`);
console.log(`Total nodes: ${nodeCount.toLocaleString()}`);
console.log(`Total self_size: ${mb(totalSelfSize)} MB`);

console.log("\nBy node type:");
for (const [t, s] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
	console.log(`  ${t.padEnd(20)} ${mb(s).padStart(8)} MB`);
}

console.log(`\nTop ${topN} constructors (by total self_size):`);
console.log("  size_mb | count    | name");
for (const [name, e] of [...byConstructor.entries()]
	.sort((a, b) => b[1].size - a[1].size)
	.slice(0, topN)) {
	console.log(`  ${mb(e.size).padStart(7)} | ${String(e.count).padStart(8)} | ${name}`);
}
