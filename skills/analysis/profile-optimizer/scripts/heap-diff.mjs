// Heap snapshot diff.
//
// Compares two Chrome DevTools `.heapsnapshot` files and prints what grew /
// shrunk between them, grouped by constructor. Intended for the canonical
// 3-snapshot leak workflow:
//
//   1. Take baseline snapshot.
//   2. Run the suspected-leaky action N times.
//   3. Take "after" snapshot.
//   4. Diff baseline → after to find what survived.
//
// Usage:
//   node --max-old-space-size=4096 heap-diff.mjs <before.heapsnapshot> <after.heapsnapshot> [topN]
//
// The output ranks constructors by absolute byte delta. A growing leak shows
// as a positive `Δ_size_mb` AND a positive `Δ_count`. A shrinker (cache evict
// or normal idle GC) is negative on both.

import { readFileSync } from "fs";

const beforePath = process.argv[2];
const afterPath = process.argv[3];
const topN = parseInt(process.argv[4] ?? "30", 10);

if (!beforePath || !afterPath) {
	console.error(
		"Usage: node heap-diff.mjs <before.heapsnapshot> <after.heapsnapshot> [topN]"
	);
	process.exit(1);
}

function summarise(path) {
	const snap = JSON.parse(readFileSync(path, "utf-8"));
	const NF = snap.snapshot.meta.node_fields.length;
	const TYPES = snap.snapshot.meta.node_types[0];
	const TI = snap.snapshot.meta.node_fields.indexOf("type");
	const NI = snap.snapshot.meta.node_fields.indexOf("name");
	const SI = snap.snapshot.meta.node_fields.indexOf("self_size");
	const nodes = snap.nodes;
	const strings = snap.strings;
	const n = snap.snapshot.node_count;

	let total = 0;
	const byCtor = new Map();
	for (let i = 0; i < n; i++) {
		const base = i * NF;
		const type = TYPES[nodes[base + TI]];
		const selfSize = nodes[base + SI];
		total += selfSize;
		if (type === "object" || type === "closure" || type === "native") {
			const name = strings[nodes[base + NI]] || "<unknown>";
			const e = byCtor.get(name) ?? { size: 0, count: 0 };
			e.size += selfSize;
			e.count += 1;
			byCtor.set(name, e);
		}
	}
	return { total, nodeCount: n, byCtor };
}

const before = summarise(beforePath);
const after = summarise(afterPath);

const mb = (b) => (b / 1024 / 1024).toFixed(2);
const sgn = (n) => (n >= 0 ? `+${n}` : `${n}`);

console.log(`Before: ${beforePath}`);
console.log(`  total: ${mb(before.total)} MB / ${before.nodeCount.toLocaleString()} nodes`);
console.log(`After:  ${afterPath}`);
console.log(`  total: ${mb(after.total)} MB / ${after.nodeCount.toLocaleString()} nodes`);
console.log(
	`\nDelta: ${sgn(mb(after.total - before.total))} MB / ${sgn(
		(after.nodeCount - before.nodeCount).toLocaleString()
	)} nodes\n`
);

// Per-constructor diff
const allNames = new Set([...before.byCtor.keys(), ...after.byCtor.keys()]);
const rows = [];
for (const name of allNames) {
	const b = before.byCtor.get(name) ?? { size: 0, count: 0 };
	const a = after.byCtor.get(name) ?? { size: 0, count: 0 };
	rows.push({
		name,
		dSize: a.size - b.size,
		dCount: a.count - b.count,
		beforeMb: b.size / 1024 / 1024,
		afterMb: a.size / 1024 / 1024,
		beforeCount: b.count,
		afterCount: a.count,
	});
}

console.log(`Top ${topN} growers (by Δ_size):`);
console.log(
	"  Δ_size_mb | Δ_count   | before_mb | after_mb | before_cnt | after_cnt | name"
);
for (const r of rows.sort((a, b) => b.dSize - a.dSize).slice(0, topN)) {
	console.log(
		`  ${sgn(mb(r.dSize)).padStart(9)} | ${sgn(r.dCount).padStart(9)} | ${r.beforeMb
			.toFixed(2)
			.padStart(9)} | ${r.afterMb.toFixed(2).padStart(8)} | ${String(r.beforeCount).padStart(
			10
		)} | ${String(r.afterCount).padStart(9)} | ${r.name}`
	);
}

console.log(`\nTop ${topN} shrinkers (by Δ_size):`);
console.log(
	"  Δ_size_mb | Δ_count   | before_mb | after_mb | before_cnt | after_cnt | name"
);
for (const r of rows.sort((a, b) => a.dSize - b.dSize).slice(0, topN)) {
	console.log(
		`  ${sgn(mb(r.dSize)).padStart(9)} | ${sgn(r.dCount).padStart(9)} | ${r.beforeMb
			.toFixed(2)
			.padStart(9)} | ${r.afterMb.toFixed(2).padStart(8)} | ${String(r.beforeCount).padStart(
			10
		)} | ${String(r.afterCount).padStart(9)} | ${r.name}`
	);
}
