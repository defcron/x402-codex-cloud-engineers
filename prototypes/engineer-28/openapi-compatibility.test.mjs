import test from "node:test";
import assert from "node:assert/strict";
import { compareOpenApiVersions } from "./openapi-compatibility.mjs";

const spec = paths => JSON.stringify({ openapi: "3.1.0", info: { title: "Demo", version: "1" }, paths });
const operation = (extra = {}) => ({ responses: { "200": { description: "OK" } }, ...extra });

test("reports operation additions and removals in opposite directions", () => {
  const before = spec({ "/old": { get: operation() } });
  const after = spec({ "/new": { post: operation() } });
  const result = compareOpenApiVersions(before, after);
  assert.equal(result.compared_operations, 2);
  assert.equal(result.operations[0].findings[0].backward, "breaking");
  assert.equal(result.operations[1].findings[0].forward, "breaking");
});

test("finds request requiredness changes as backward breaking", () => {
  const before = spec({ "/items": { post: operation({ parameters: [{ in: "query", name: "limit", required: false }] }) } });
  const after = spec({ "/items": { post: operation({ parameters: [{ in: "query", name: "limit", required: true }] }) } });
  const finding = compareOpenApiVersions(before, after).operations[0].findings[0];
  assert.equal(finding.change, "parameter:query:limit");
  assert.equal(finding.backward, "breaking");
});

test("finds a newly introduced required parameter", () => {
  const before = spec({ "/items": { get: operation() } });
  const after = spec({ "/items": { get: operation({ parameters: [{ in: "query", name: "tenant", required: true }] }) } });
  const finding = compareOpenApiVersions(before, after).operations[0].findings[0];
  assert.equal(finding.change, "parameter:query:tenant");
  assert.equal(finding.backward, "breaking");
});

test("leaves an unchanged operation clear", () => {
  const document = spec({ "/health": { get: operation() } });
  const row = compareOpenApiVersions(document, document).operations[0];
  assert.equal(row.status, "unchanged");
  assert.deepEqual(row.findings, []);
});

test("flags removed documented response properties", () => {
  const oldSchema = { type: "object", properties: { id: { type: "string" }, label: { type: "string" } } };
  const newSchema = { type: "object", properties: { id: { type: "string" } } };
  const before = spec({ "/items": { get: operation({ responses: { "200": { description: "OK", content: { "application/json": { schema: oldSchema } } } } }) } });
  const after = spec({ "/items": { get: operation({ responses: { "200": { description: "OK", content: { "application/json": { schema: newSchema } } } } }) } });
  assert.equal(compareOpenApiVersions(before, after).operations[0].findings[0].backward, "breaking");
});

test("marks changed unresolved refs inconclusive", () => {
  const doc = ref => spec({
    "/items": {
      get: operation({
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { $ref: ref } } }
          }
        }
      })
    }
  });
  assert.equal(compareOpenApiVersions(doc("#/components/schemas/A"), doc("#/components/schemas/B")).operations[0].findings[0].backward, "inconclusive");
});

test("rejects malformed JSON, unsupported OpenAPI, and invalid direction", () => {
  assert.throws(() => compareOpenApiVersions("{", "{}"), /valid JSON/);
  assert.throws(() => compareOpenApiVersions(JSON.stringify({ openapi: "2.0", paths: {} }), spec({})), /OpenAPI 3.0 or 3.1/);
  assert.throws(() => compareOpenApiVersions(spec({}), spec({}), { direction: "sideways" }), /direction/);
  assert.throws(() => compareOpenApiVersions(spec({}), spec({}), []), /options must be an object/);
});

test("projects the requested direction into each finding", () => {
  const before = spec({});
  const after = spec({ "/new": { get: operation() } });
  const result = compareOpenApiVersions(before, after, { direction: "forward" });
  assert.equal(result.direction, "forward");
  assert.equal(result.operations[0].findings[0].impact, "breaking");
});

test("rejects empty input and excessive JSON nesting", () => {
  assert.throws(() => compareOpenApiVersions("", spec({})), /non-empty JSON string/);
  const root = { openapi: "3.1.0", paths: {} };
  let node = root;
  for (let i = 0; i < 66; i++) node = node.next = {};
  assert.throws(() => compareOpenApiVersions(JSON.stringify(root), spec({})), /depth 64/);
});

test("enforces the input cap", () => {
  assert.throws(() => compareOpenApiVersions(" ".repeat(131073), spec({})), /131072 characters/);
});
