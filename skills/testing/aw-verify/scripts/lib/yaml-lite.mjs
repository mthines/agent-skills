#!/usr/bin/env node
// yaml-lite.mjs — the YAML subset `.agents/aw/*.yml` uses, parsed with no dependency.
//
// The suite's scripts run on any machine with Node and nothing installed, so they cannot import a YAML
// package. This reads what the committed config files hold: block mappings and sequences by indent,
// `- key: v` sequence items, flow `[a, 'b']` and `{ k: v }` (one level of nesting), plain, single- and
// double-quoted scalars, `|` / `>` block scalars with `-` chomping, and `#` comments.
// Not supported: anchors, aliases, tags, multi-document files, multi-line flow collections; a line it cannot
// place throws, so a caller never reads a file cut short.
//
// Usage: import { parseYaml } from "./lib/yaml-lite.mjs";   node yaml-lite.mjs --self-test
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q && line[i - 1] !== "\\") q = null; continue; }
    if (c === "'" || c === '"') { if (i === 0 || /[\s:[{,]/.test(line[i - 1])) q = c; continue; }
    if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}

// Split on top-level commas, outside quotes and nested brackets.
function splitFlow(s) {
  const out = []; let depth = 0, q = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; cur += c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// The index of the `:` that separates a key from its value, outside quotes and brackets; -1 when none.
function keyColon(s) {
  let q = null, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === "[" || c === "{") depth++;
    if (c === "]" || c === "}") depth--;
    if (c === ":" && depth === 0 && (i === s.length - 1 || s[i + 1] === " ")) return i;
  }
  return -1;
}

export function scalar(raw) {
  const s = raw.trim();
  if (s === "") return null;
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map(scalar);
  if (s.startsWith("{") && s.endsWith("}")) {
    const o = {};
    for (const part of splitFlow(s.slice(1, -1))) {
      const k = keyColon(part);
      if (k < 0) o[unquote(part)] = null;
      else o[unquote(part.slice(0, k).trim())] = scalar(part.slice(k + 1));
    }
    return o;
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length > 1) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"') && s.endsWith('"') && s.length > 1) return JSON.parse(s);
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
const unquote = (s) => { const v = scalar(s); return v == null ? "" : String(v); };

export function parseYaml(text) {
  const raw = String(text).replace(/\t/g, "  ").split("\n");
  const lines = [];
  for (let i = 0; i < raw.length; i++) lines.push({ raw: raw[i], indent: raw[i].search(/\S/), text: stripComment(raw[i]).trim() });
  let i = 0;
  const skip = () => { while (i < lines.length && (lines[i].indent < 0 || lines[i].text === "" || lines[i].text === "---")) i++; };

  function blockScalar(header, parentIndent) {
    const fold = header.startsWith(">"), strip = header.includes("-");
    const body = [];
    let ind = -1;
    while (i < lines.length) {
      const l = lines[i];
      if (l.raw.trim() === "") { body.push(""); i++; continue; }
      if (l.indent <= parentIndent) break;
      if (ind < 0) ind = l.indent;
      body.push(l.raw.slice(ind)); i++;
    }
    while (body.length && body[body.length - 1] === "") body.pop();
    const joined = fold ? body.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ") : body.join("\n");
    return strip ? joined : joined + "\n";
  }

  // The value after `key:` or `- `: inline, a block scalar, or a nested block below.
  function value(rest, ownIndent) {
    if (/^[|>][+-]?$/.test(rest)) return blockScalar(rest, ownIndent);
    if (rest !== "") return scalar(rest);
    skip();
    if (i >= lines.length || lines[i].indent <= ownIndent) {
      // A sequence may sit at the key's own indent (`key:\n- a`).
      if (i < lines.length && lines[i].indent === ownIndent && lines[i].text.startsWith("- ")) return node(ownIndent);
      return null;
    }
    return node(lines[i].indent);
  }

  function node(indent) {
    skip();
    if (i >= lines.length) return null;
    if (lines[i].text === "-" || lines[i].text.startsWith("- ")) {
      const arr = [];
      while (i < lines.length) {
        skip();
        if (i >= lines.length || lines[i].indent !== indent || !(lines[i].text === "-" || lines[i].text.startsWith("- "))) break;
        const item = lines[i].text === "-" ? "" : lines[i].text.slice(2).trim();
        const itemIndent = indent + 2;
        if (item !== "" && keyColon(item) > 0 && !/^[[{'"]/.test(item)) {
          // `- key: v` opens a mapping whose further keys sit at the item's content indent.
          lines[i] = { ...lines[i], indent: itemIndent, text: item };
          arr.push(mapping(itemIndent));
        } else { i++; arr.push(value(item, indent)); }
      }
      return arr;
    }
    return mapping(indent);
  }

  function mapping(indent) {
    const obj = {};
    while (i < lines.length) {
      skip();
      if (i >= lines.length || lines[i].indent !== indent || lines[i].text.startsWith("- ")) break;
      const t = lines[i].text, k = keyColon(t);
      if (k < 0) throw new Error(`yaml-lite: expected "key: value" at line ${i + 1}: ${t}`);
      i++;
      obj[unquote(t.slice(0, k).trim())] = value(t.slice(k + 1).trim(), indent);
    }
    return obj;
  }

  skip();
  if (i >= lines.length) return null;
  const doc = node(lines[i].indent);
  skip();
  if (i < lines.length) throw new Error(`yaml-lite: cannot read line ${i + 1}: ${lines[i].text}`);
  return doc;
}

function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  t("nested mappings", eq(parseYaml("a:\n  b: 1\n  c: x\n"), { a: { b: 1, c: "x" } }));
  t("comments are dropped, # inside quotes kept", eq(parseYaml("a: 'x # y' # note\nb: c#d\n"), { a: "x # y", b: "c#d" }));
  t("flow sequence and mapping", eq(parseYaml("a: [x, 'y z', \"w\"]\nb: { k: v, n: 2 }\n"), { a: ["x", "y z", "w"], b: { k: "v", n: 2 } }));
  t("nested flow keeps commas inside", eq(parseYaml("c: { authors: [\"a[bot]\", b], host: 'x,y' }\n"), { c: { authors: ["a[bot]", "b"], host: "x,y" } }));
  t("sequence of mappings", eq(parseYaml("rules:\n  - paths: ['a/**']\n    env: preview\n  - paths: [b]\n    env: checks\n"),
    { rules: [{ paths: ["a/**"], env: "preview" }, { paths: ["b"], env: "checks" }] }));
  t("sequence at the key's indent", eq(parseYaml("rules:\n- env: local\n  when: after-pr\n"), { rules: [{ env: "local", when: "after-pr" }] }));
  t("block sequence of scalars", eq(parseYaml("paths:\n  - 'a/**'\n  - b/*.md\n"), { paths: ["a/**", "b/*.md"] }));
  t("folded block scalar with strip", eq(parseYaml("cmd: >-\n  sh -c 'a\n  b'\nnext: 1\n"), { cmd: "sh -c 'a b'", next: 1 }));
  t("literal block scalar keeps newlines", eq(parseYaml("s: |\n  a\n  b\n"), { s: "a\nb\n" }));
  t("an empty value is null", eq(parseYaml("a:\nb: 1\n"), { a: null, b: 1 }));
  t("booleans and numbers", eq(parseYaml("a: true\nb: 300\nc: '300'\n"), { a: true, b: 300, c: "300" }));
  t("a value with a colon and no space stays a string", eq(parseYaml("u: https://x.dev:3000/a\n"), { u: "https://x.dev:3000/a" }));
  const env = parseYaml("version: 1\nenvironments:\n  preview:\n    auth:\n      storage_state: .browser/s.json\n      refresh:\n        when: always\n        command: >-\n          sh -c 'E2E_EMAIL=\"$X\"\n          node login.mjs'\n        timeout_seconds: 300\n");
  t("environments.yml shape", env.environments.preview.auth.refresh.command === "sh -c 'E2E_EMAIL=\"$X\" node login.mjs'" && env.environments.preview.auth.refresh.timeout_seconds === 300);
  let threw = false; try { parseYaml("a: [\n  x,\n  y\n]\nverify:\n  default: checks\n"); } catch { threw = true; }
  t("a multi-line flow list throws instead of dropping the keys after it", threw);
  threw = false; try { parseYaml("a:\n    b: 1\n  c: 2\n"); } catch { threw = true; }
  t("a mis-indented key throws", threw);
  t("an empty document is null", parseYaml("# only a comment\n") === null);

  console.log(`yaml-lite self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (isMainModule() && process.argv.includes("--self-test")) process.exit(selfTest());
