/** Render rows as a fixed-width text table. */
export function formatTable(rows) {
  return rows.map((r) => `${r.name.padEnd(10)} ${String(r.p95).padStart(6)}`).join("\n");
}
