#!/usr/bin/env node
import { formatTable } from "./format.mjs";

const rows = [
  { name: "api", p95: 120 },
  { name: "worker", p95: 340 },
];

process.stdout.write(formatTable(rows) + "\n");
