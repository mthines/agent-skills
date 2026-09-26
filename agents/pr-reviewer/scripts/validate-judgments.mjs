#!/usr/bin/env node
// @ts-check
/**
 * validate-judgments.mjs — fail-closed validator for judgments.json against
 * agents/pr-reviewer/schemas/judgments.schema.json (R5, D4).
 *
 * This is deliberately NOT a general-purpose JSON Schema implementation.
 * It interprets a FIXED keyword subset — the same subset documented in the
 * schema's own top-level "description" — and treats any OTHER keyword
 * anywhere in the schema document as a malformed schema, rejected before a
 * single byte of judgments.json is read. Supported: $schema, $id, $defs,
 * $ref, type, enum, const, properties, required, additionalProperties
 * (boolean only), items, minItems, maxItems, minLength, maxLength, minimum,
 * maximum, pattern, title, description.
 *
 * Pure JSON Schema in this subset cannot express a conditional constraint
 * across sibling fields (e.g. "title is required when prefix is a claim
 * prefix, forbidden otherwise"). Those constraints are HAND-CODED domain
 * rules layered on top in domainRules() below, run unconditionally after
 * schema validation. The rule "a secret pre-candidate can never be marked
 * exempt" (D6) lives here for the same reason — it is not expressible as a
 * type/enum/required constraint.
 *
 * A THIRD class of error is neither of the above: a candidate can satisfy
 * every schema keyword and every domainRules() check and still be something
 * finalize.mjs's own render step refuses to post — the schema's `body` has
 * no `maxLength` (render-comment.mjs's 200-char PROSE_MAX is enforced only
 * there), and nothing in the schema ties `evidence_anchors` to `prefix`
 * (render-comment.mjs refuses EVIDENCE on a non-claim prefix). Both gaps
 * were real: A/B round 1 (dash0hq/dash0#20230) needed a hand workaround for
 * exactly these two shapes, because validate-judgments passed a body that
 * finalize then rejected. `renderLegalityErrors()` closes this by calling
 * `finalize.mjs`'s OWN `checkShape()` — the exact `toInlineCommentPayload`
 * -> `renderComment` path finalize runs at write time — never a second,
 * hand-rolled copy of its caps. A judgments file that now passes
 * `validateJudgments()` is therefore proven to pass finalize's render step
 * too, on the SAME candidates, before any verifier spend.
 *
 * Usage:
 *   node validate-judgments.mjs <judgments.json>
 *   node validate-judgments.mjs --self-test
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkShape } from "./finalize.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, "..", "schemas", "judgments.schema.json");
const FINGERPRINT_PATH = join(HERE, "fingerprint.mjs");
const FIXTURES_DIR = join(HERE, "..", "..", "..", "scripts", "eval", "fixtures", "judgments");

/** The fixed keyword subset this interpreter supports. Anything else in the
 * schema document is a malformed schema, not a permissive unknown. */
export const SUPPORTED_KEYWORDS = new Set([
  "$schema", "$id", "$defs", "$ref",
  "type", "enum", "const",
  "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems",
  "minLength", "maxLength",
  "minimum", "maximum",
  "pattern",
  "title", "description",
]);

const CLAIM_PREFIXES = ["issue", "suggestion"];
const THREAD_RESOLVE_CLASSES = ["fixed", "declined", "acknowledged", "obsolete"];

export class SchemaError extends Error {}

/**
 * Recursively walks a schema NODE (not the full document — call it on the
 * root, and it recurses into $defs/properties/items itself) and returns an
 * array of "unsupported keyword" error strings. Empty array = clean.
 * @param {any} node
 * @param {string} [path]
 * @returns {string[]}
 */
export function checkSchemaKeywords(node, path = "#") {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return [];
  const errors = [];
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      errors.push(`${path}: unsupported schema keyword "${key}"`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(node, "additionalProperties")
    && typeof node.additionalProperties !== "boolean") {
    errors.push(`${path}: additionalProperties must be a boolean in this subset, got ${JSON.stringify(node.additionalProperties)}`);
  }
  if (node.$defs && typeof node.$defs === "object") {
    for (const [name, sub] of Object.entries(node.$defs)) {
      errors.push(...checkSchemaKeywords(sub, `${path}/$defs/${name}`));
    }
  }
  if (node.properties && typeof node.properties === "object") {
    for (const [name, sub] of Object.entries(node.properties)) {
      errors.push(...checkSchemaKeywords(sub, `${path}/properties/${name}`));
    }
  }
  if (node.items && typeof node.items === "object") {
    errors.push(...checkSchemaKeywords(node.items, `${path}/items`));
  }
  return errors;
}

/** @param {any} root @param {string} ref */
function resolveRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) {
    throw new SchemaError(`unsupported $ref form (only "#/$defs/<name>" is supported): ${JSON.stringify(ref)}`);
  }
  const name = ref.slice("#/$defs/".length);
  const target = root.$defs && root.$defs[name];
  if (!target) throw new SchemaError(`$ref target not found: ${ref}`);
  return target;
}

/** @param {any} data @param {string} type */
function matchesType(data, type) {
  switch (type) {
    case "object": return data !== null && typeof data === "object" && !Array.isArray(data);
    case "array": return Array.isArray(data);
    case "string": return typeof data === "string";
    case "boolean": return typeof data === "boolean";
    case "integer": return typeof data === "number" && Number.isInteger(data);
    case "number": return typeof data === "number";
    default: throw new SchemaError(`unsupported "type" value: ${JSON.stringify(type)}`);
  }
}

/** @param {any} data */
function describeType(data) {
  if (data === null) return "null";
  if (Array.isArray(data)) return "array";
  return typeof data;
}

/**
 * @param {any} root - the full schema document, for $ref resolution
 * @param {any} schema - the schema node to validate `data` against
 * @param {any} data
 * @param {string} path
 * @param {string[]} errors
 */
function validateNode(root, schema, data, path, errors) {
  if (schema.$ref) {
    validateNode(root, resolveRef(root, schema.$ref), data, path, errors);
    return;
  }
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(data)) {
    errors.push(`${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type) {
    if (!matchesType(data, schema.type)) {
      errors.push(`${path}: expected type "${schema.type}", got ${describeType(data)} (${JSON.stringify(data)})`);
      return; // a type mismatch makes every further shape check meaningless here
    }
    if (schema.type === "string") {
      if (typeof schema.minLength === "number" && data.length < schema.minLength) {
        errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
      }
      if (typeof schema.maxLength === "number" && data.length > schema.maxLength) {
        errors.push(`${path}: string longer than maxLength ${schema.maxLength}`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
        errors.push(`${path}: ${JSON.stringify(data)} does not match pattern ${schema.pattern}`);
      }
    }
    if (schema.type === "number" || schema.type === "integer") {
      if (typeof schema.minimum === "number" && data < schema.minimum) {
        errors.push(`${path}: ${data} is below minimum ${schema.minimum}`);
      }
      if (typeof schema.maximum === "number" && data > schema.maximum) {
        errors.push(`${path}: ${data} is above maximum ${schema.maximum}`);
      }
    }
    if (schema.type === "array") {
      if (typeof schema.minItems === "number" && data.length < schema.minItems) {
        errors.push(`${path}: fewer than minItems ${schema.minItems}`);
      }
      if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
        errors.push(`${path}: more than maxItems ${schema.maxItems}`);
      }
      if (schema.items) {
        data.forEach((/** @type {any} */ item, /** @type {number} */ i) =>
          validateNode(root, schema.items, item, `${path}[${i}]`, errors));
      }
    }
    if (schema.type === "object") {
      const required = schema.required || [];
      for (const key of required) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          errors.push(`${path}: missing required property "${key}"`);
        }
      }
      const props = schema.properties || {};
      for (const [key, value] of Object.entries(data)) {
        if (Object.prototype.hasOwnProperty.call(props, key)) {
          validateNode(root, props[key], value, `${path}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push(`${path}: unknown property "${key}" (additionalProperties: false)`);
        }
      }
    }
  }
}

/**
 * The candidate-level slice of `domainRules()`, extracted so `--shape-only` (A/B round 2 item 5)
 * can run it against a verifier worker's OWN candidates array without requiring the full
 * judgments wrapper (`gates`/`threads`/`memory`) that array will only ever exist inside once the
 * orchestrator merges every worker's output back together.
 * @param {any[]} candidates
 * @param {string[]} errors
 */
export function candidateDomainRules(candidates, errors) {
  candidates.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
    if (c === null || typeof c !== "object") return;
    const path = `#.candidates[${i}]`;
    const hasTitle = typeof c.title === "string" && c.title.length > 0;
    const isClaim = CLAIM_PREFIXES.includes(c.prefix);
    if (isClaim && !hasTitle) {
      errors.push(`${path}: prefix ${JSON.stringify(c.prefix)} is a claim prefix and requires a non-empty "title"`);
    }
    if (!isClaim && hasTitle) {
      errors.push(`${path}: prefix ${JSON.stringify(c.prefix)} is a one-liner form and must not carry a "title"`);
    }
    const hasReason = typeof c.unverified_reason === "string" && c.unverified_reason.length > 0;
    if (c.verdict === "unobtainable" && !hasReason) {
      errors.push(`${path}: verdict "unobtainable" requires a non-empty "unverified_reason"`);
    }
    if (c.verdict !== "unobtainable" && hasReason) {
      errors.push(`${path}: "unverified_reason" is only valid when verdict is "unobtainable" (got ${JSON.stringify(c.verdict)})`);
    }
  });
}

/**
 * Hand-coded domain rules the fixed keyword subset cannot express as
 * schema-level conditionals. Defensive against a partially-shaped `data`
 * (missing/wrong-typed fields already reported by schema validation) —
 * always runs, never throws.
 * @param {any} data
 * @param {string[]} errors
 */
export function domainRules(data, errors) {
  /** @type {any[]} */
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  candidateDomainRules(candidates, errors);

  /** @type {any[]} */
  const dispositions = Array.isArray(data?.gates?.gate4?.precandidate_dispositions)
    ? data.gates.gate4.precandidate_dispositions
    : [];
  dispositions.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
    if (d === null || typeof d !== "object") return;
    if (d.category === "secret" && d.disposition === "exempt") {
      errors.push(`#.gates.gate4.precandidate_dispositions[${i}]: a "secret" pre-candidate can never be marked "exempt" (D6 — secrets can never be exempted)`);
    }
  });

  /** @type {any[]} */
  const threads = Array.isArray(data?.threads) ? data.threads : [];
  threads.forEach((/** @type {any} */ t, /** @type {number} */ i) => {
    if (t === null || typeof t !== "object") return;
    const path = `#.threads[${i}]`;
    const hasReply = typeof t.reply === "string" && t.reply.length > 0;
    const resolves = THREAD_RESOLVE_CLASSES.includes(t.classification);
    if (resolves && !hasReply) {
      errors.push(`${path}: classification ${JSON.stringify(t.classification)} requires a non-empty "reply"`);
    }
    if (!resolves && hasReply) {
      errors.push(`${path}: classification ${JSON.stringify(t.classification)} leaves the thread open with no reply and must not carry one`);
    }
  });
}

/** Loads and self-checks the schema file. Throws SchemaError on any
 * unsupported keyword — never returns a schema this interpreter can't
 * fully account for. */
export function loadSchema() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const keywordErrors = checkSchemaKeywords(schema);
  if (keywordErrors.length) {
    throw new SchemaError(`judgments.schema.json uses unsupported keyword(s):\n${keywordErrors.join("\n")}`);
  }
  return schema;
}

/**
 * Every candidate through the REAL render path finalize.mjs uses at write time
 * (`toInlineCommentPayload` -> `renderComment`, via `finalize.mjs`'s own `checkShape()`
 * — imported, never copied). A violation here is exactly the class of failure that used
 * to surface only inside finalize itself, after verification had already spent its
 * budget on the candidate.
 * @param {any} data
 * @returns {string[]}
 */
export function renderLegalityErrors(data) {
  const { violations } = checkShape(data);
  return violations.map((v) =>
    `#.candidates[${v.index}]: fails finalize's render step (${v.field}) — ${v.reason}`);
}

/**
 * @param {any} schema - a schema already passed through loadSchema/checkSchemaKeywords
 * @param {any} data
 * @returns {string[]} errors — empty means valid
 */
export function validateJudgments(schema, data) {
  /** @type {string[]} */
  const errors = [];
  validateNode(schema, schema, data, "#", errors);
  domainRules(data, errors);
  errors.push(...renderLegalityErrors(data));
  return errors;
}

/**
 * A/B round 2 item 5 — `--shape-only`: validates a VERIFIER WORKER'S OWN OUTPUT FILE (a bare
 * candidates array, or `{ candidates: [...] }`) before the worker returns it to the orchestrator,
 * so a shape violation is caught and fixed at the source instead of surfacing only once the
 * orchestrator's own `finalize.mjs --check-shape` runs over the merged judgments file — which is
 * how A/B round 1 needed the orchestrator to hand-trim 6 (D08) and 16 (D10) verifier bodies over
 * cap, work `finding-verifier.md` itself should never have produced.
 *
 * Deliberately NOT the same validation `validateJudgments()` runs: there is no `gates`/`threads`/
 * `memory` wrapper on a single verifier's own output, so this validates each candidate against
 * `$defs.candidate` directly (never the full top-level schema, which would fail closed on every
 * missing wrapper field a worker was never asked to produce), runs the same candidate-level
 * `candidateDomainRules()` `validateJudgments()` uses, and the same render-legality check
 * (`checkShape()`, imported — never a second, hand-rolled copy of finalize.mjs's caps).
 * @param {any} schema - a schema already passed through loadSchema/checkSchemaKeywords
 * @param {any} data - a bare array of candidates, or `{ candidates: [...] }`
 * @returns {string[]} errors — empty means shape-legal
 */
export function validateShapeOnly(schema, data) {
  /** @type {string[]} */
  const errors = [];
  const candidates = Array.isArray(data) ? data : Array.isArray(data?.candidates) ? data.candidates : null;
  if (candidates === null) {
    errors.push("#: --shape-only expects a JSON array of candidates, or an object with a top-level \"candidates\" array");
    return errors;
  }
  const candidateSchema = schema?.$defs?.candidate;
  if (!candidateSchema) {
    errors.push("#: judgments.schema.json has no $defs.candidate to validate --shape-only input against");
    return errors;
  }
  candidates.forEach((/** @type {any} */ c, /** @type {number} */ i) =>
    validateNode(schema, candidateSchema, c, `#.candidates[${i}]`, errors));
  candidateDomainRules(candidates, errors);
  errors.push(...renderLegalityErrors({ candidates }));
  return errors;
}

/**
 * Asserts the schema's finder/defect_class enums equal fingerprint.mjs's
 * live FINDERS/DEFECT_CLASSES exports, by real dynamic import rather than
 * a duplicated literal — the two cannot silently drift apart.
 * @param {any} schema
 * @returns {Promise<string[]>}
 */
export async function assertEnumsMatchFingerprint(schema) {
  const fp = /** @type {any} */ (await import(pathToFileURL(FINGERPRINT_PATH).href));
  const errors = [];
  const schemaFinders = schema?.$defs?.finder?.enum ?? [];
  const schemaDefects = schema?.$defs?.defect_class?.enum ?? [];
  const sortedEq = (/** @type {any[]} */ a, /** @type {any[]} */ b) =>
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!sortedEq(schemaFinders, fp.FINDERS)) {
    errors.push(`judgments.schema.json $defs.finder.enum != fingerprint.mjs FINDERS\n  schema:      ${JSON.stringify([...schemaFinders].sort())}\n  fingerprint: ${JSON.stringify([...fp.FINDERS].sort())}`);
  }
  if (!sortedEq(schemaDefects, fp.DEFECT_CLASSES)) {
    errors.push(`judgments.schema.json $defs.defect_class.enum != fingerprint.mjs DEFECT_CLASSES\n  schema:      ${JSON.stringify([...schemaDefects].sort())}\n  fingerprint: ${JSON.stringify([...fp.DEFECT_CLASSES].sort())}`);
  }
  return errors;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // 1. The real schema file loads clean under this interpreter's own keyword set.
  let schema;
  try {
    schema = loadSchema();
    check("schema loads with only supported keywords", true);
  } catch (e) {
    check("schema loads with only supported keywords", false, /** @type {Error} */(e).message);
    schema = null;
  }

  // 2. A synthetic schema carrying an unsupported keyword is rejected — this
  // is the "rejection of an unsupported schema keyword" case AC-9 names.
  {
    const bad = { type: "object", minProperties: 1, properties: { a: { type: "string" } } };
    const errs = checkSchemaKeywords(bad);
    check("unsupported schema keyword (minProperties) is rejected", errs.length > 0 && errs.some(e => e.includes("minProperties")));
  }

  // 3. additionalProperties must be boolean, never an object (draft's
  // "schema form" of additionalProperties is explicitly out of this subset).
  {
    const bad = { type: "object", additionalProperties: { type: "string" } };
    const errs = checkSchemaKeywords(bad);
    check("non-boolean additionalProperties is rejected", errs.length > 0 && errs.some(e => e.includes("additionalProperties")));
  }

  // 4. The schema's finder/defect_class enums equal fingerprint.mjs's live exports.
  if (schema) {
    const enumErrors = await assertEnumsMatchFingerprint(schema);
    check("schema finder/defect_class enums equal fingerprint.mjs exports", enumErrors.length === 0, enumErrors.join(" | "));
  } else {
    check("schema finder/defect_class enums equal fingerprint.mjs exports", false, "schema failed to load");
  }

  // 5. Fixture-driven data validation cases.
  const loadFixture = (/** @type {string} */ name) => JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));

  if (schema) {
    {
      const data = loadFixture("valid.json");
      const errs = validateJudgments(schema, data);
      check("valid.json passes with zero errors", errs.length === 0, errs.join(" | "));
    }
    {
      // "an unknown top-level key is rejected"
      const data = loadFixture("invalid-unknown-top-level-key.json");
      const errs = validateJudgments(schema, data);
      check("unknown top-level key is rejected", errs.length > 0 && errs.some(e => e.includes("unknown property")));
    }
    {
      // "an exempt secret pre-candidate is rejected"
      const data = loadFixture("invalid-secret-exempt.json");
      const errs = validateJudgments(schema, data);
      check("exempt secret pre-candidate is rejected", errs.length > 0 && errs.some(e => e.includes("secret") && e.includes("exempt")));
    }
    {
      const data = loadFixture("invalid-title-mismatch.json");
      const errs = validateJudgments(schema, data);
      check("title/prefix domain rule is enforced both directions", errs.length > 0 && errs.some(e => e.includes("title")));
    }
    {
      const data = loadFixture("invalid-unverified-reason.json");
      const errs = validateJudgments(schema, data);
      check("unverified_reason/verdict domain rule is enforced", errs.length > 0 && errs.some(e => e.includes("unverified_reason")));
    }
    {
      const data = loadFixture("invalid-thread-reply.json");
      const errs = validateJudgments(schema, data);
      check("thread classification/reply domain rule is enforced", errs.length > 0 && errs.some(e => e.includes("reply")));
    }
    {
      // ab/DISPATCH-READY.md's 5th field-bridging gap, fixed at the source: an over-120-char
      // gate1.details (GATE_DESCRIPTION_DETAILS verbatim) is rejected HERE, with a clear
      // validator error, rather than crashing deep inside render-report.mjs at render time.
      const data = loadFixture("invalid-gate-details-overlong.json");
      const errs = validateJudgments(schema, data);
      check("an over-120-char gate1.details (GATE_DESCRIPTION_DETAILS) is rejected", errs.length > 0 && errs.some(e => e.includes("maxLength")));
    }
    {
      // A/B round 1 (dash0hq/dash0#20230): the schema's `body` carries no `maxLength`, so
      // this fixture is schema-valid and passes every domainRules() check, yet
      // render-comment.mjs's 200-char PROSE_MAX would reject it at finalize time — the
      // "validate passes a body that finalize then rejects" workaround, closed here.
      const data = loadFixture("invalid-render-overlong-body.json");
      const errs = validateJudgments(schema, data);
      check("an over-200-char BODY is caught by validate (checkShape/render-comment.mjs), not left for finalize",
        errs.length > 0 && errs.some(e => e.includes("fails finalize's render step (BODY)") && e.includes("200-char cap")));
    }
    {
      // A/B round 1's other workaround: evidence_anchors on a one-liner prefix. Nothing in
      // the schema or domainRules() ties evidence_anchors to prefix; only render-comment.mjs
      // refuses "EVIDENCE on a nitpick: — nothing is being proved".
      const data = loadFixture("invalid-render-evidence-on-nitpick.json");
      const errs = validateJudgments(schema, data);
      check("evidence_anchors on a nitpick is caught by validate, not left for finalize",
        errs.length > 0 && errs.some(e => e.includes("fails finalize's render step (EVIDENCE)") && e.includes("nothing is being proved")));
    }
    {
      // The inverse claim: a judgments file that passes validateJudgments() must ALSO
      // pass finalize's own checkShape() on the identical data — the whole point of
      // importing checkShape rather than re-deriving its caps. valid.json's own
      // unverified_reason was, before this change, 85 chars — over UNVERIFIED_MAX (40) —
      // and validate-judgments never noticed; it is now render-legal too.
      const data = loadFixture("valid.json");
      const validateErrs = validateJudgments(schema, data);
      const shapeResult = checkShape(data);
      check("a judgments file that validates ALSO passes finalize's real render step",
        validateErrs.length === 0 && shapeResult.ok === true,
        `validate errors: ${validateErrs.length}, checkShape violations: ${JSON.stringify(shapeResult.violations)}`);
    }

    // A/B round 2 item 5: --shape-only, exercised as validateShapeOnly() against the SAME
    // candidate fixtures — a verifier worker's own output has no gates/threads/memory wrapper.
    {
      const validCandidates = loadFixture("valid.json").candidates;
      const errsBare = validateShapeOnly(schema, validCandidates);
      check("validateShapeOnly accepts a BARE array of valid candidates", errsBare.length === 0, errsBare.join(" | "));
      const errsWrapped = validateShapeOnly(schema, { candidates: validCandidates });
      check("validateShapeOnly accepts the same candidates wrapped as { candidates: [...] }", errsWrapped.length === 0, errsWrapped.join(" | "));
    }
    {
      const errs = validateShapeOnly(schema, "not an array or object");
      check("validateShapeOnly rejects input that is neither an array nor { candidates: [...] }",
        errs.length > 0 && errs.some(e => e.includes("expects a JSON array of candidates")));
    }
    {
      // Same overlong body the full-document test above catches (A/B round 1's workaround),
      // reached through the shape-only entry point a verifier worker actually calls.
      const overlongBody = loadFixture("invalid-render-overlong-body.json").candidates;
      const errs = validateShapeOnly(schema, overlongBody);
      check("validateShapeOnly catches an over-200-char BODY with the exact cap in the message",
        errs.length > 0 && errs.some(e => e.includes("fails finalize's render step (BODY)") && e.includes("200-char cap")));
    }
    {
      // Domain rule reachable through shape-only: title/prefix mismatch, no threads/gate4 needed.
      const titleMismatch = loadFixture("invalid-title-mismatch.json").candidates;
      const errs = validateShapeOnly(schema, titleMismatch);
      check("validateShapeOnly enforces the title/prefix domain rule with no gates/threads wrapper",
        errs.length > 0 && errs.some(e => e.includes("title")));
    }
    {
      // A schema-type violation (candidate-level) is caught even with no full-document wrapper.
      const [firstValid] = loadFixture("valid.json").candidates;
      const badType = [{ ...firstValid, path: 123 }];
      const errs = validateShapeOnly(schema, badType);
      check("validateShapeOnly catches a candidate-level schema type violation (path: 123)",
        errs.length > 0 && errs.some(e => e.includes("expected type")));
    }
    {
      // A verifier's own CLI entry point, through the real process boundary.
      const candidatesPath = join(FIXTURES_DIR, "..", "shape-only-probe.json");
      writeFileSync(candidatesPath, JSON.stringify(loadFixture("valid.json").candidates), "utf8");
      const validOut = spawnSync("node", [fileURLToPath(import.meta.url), "--shape-only", candidatesPath], { encoding: "utf8" });
      check("CLI: --shape-only exits 0 and prints OK on a conforming candidates file",
        validOut.status === 0 && validOut.stdout.trim() === "OK", `status=${validOut.status} stdout=${validOut.stdout} stderr=${validOut.stderr}`);
      writeFileSync(candidatesPath, JSON.stringify(loadFixture("invalid-render-overlong-body.json").candidates), "utf8");
      const badOut = spawnSync("node", [fileURLToPath(import.meta.url), "--shape-only", candidatesPath], { encoding: "utf8" });
      check("CLI: --shape-only exits 1 and names the cap on a violating candidates file",
        badOut.status === 1 && badOut.stderr.includes("200-char cap"), `status=${badOut.status} stderr=${badOut.stderr}`);
      rmSync(candidatesPath, { force: true });
    }
  }

  if (failed > 0) {
    console.error(`\nvalidate-judgments self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ validate-judgments self-test: all checks passed");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    await selfTest();
    return;
  }
  // A/B round 2 item 5: `--shape-only` runs against a verifier worker's own candidates array —
  // no gates/threads/memory wrapper, so `assertEnumsMatchFingerprint`'s finder/defect_class enum
  // check still applies (candidates carry both) but full-document validation does not.
  const shapeOnlyIdx = args.indexOf("--shape-only");
  const shapeOnly = shapeOnlyIdx !== -1;
  const file = shapeOnly ? args[shapeOnlyIdx + 1] : args[0];
  if (!file) {
    console.error("usage: validate-judgments.mjs <judgments.json> | --shape-only <candidates.json> | --self-test");
    process.exit(2);
  }
  let schema;
  try {
    schema = loadSchema();
  } catch (e) {
    console.error(/** @type {Error} */(e).message);
    process.exit(1);
    return;
  }
  const enumErrors = await assertEnumsMatchFingerprint(schema);
  if (enumErrors.length) {
    console.error(enumErrors.join("\n"));
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const errors = shapeOnly ? validateShapeOnly(schema, data) : validateJudgments(schema, data);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("OK");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
