import test from "node:test";
import assert from "node:assert/strict";
import { inspectApiVersionRouting, RoutingInspectorError } from "./inspect.mjs";

const document = paths => JSON.stringify({ openapi: "3.1.0", info: { title: "Shop", version: "3" }, paths });
const selector = (source, fields) => ({ source, version: "2025-01", ...fields });
const request = (method = "GET", path = "/v1/items/42", rest = {}) => ({ method, path, query: [], headers: [], ...rest });
const inspect = (paths, req = request(), selectors = [selector("path_prefix", { value: "/v1" })]) =>
  inspectApiVersionRouting({ openapi_json: document(paths), request: req, selectors });

test("resolves explicit version selector and a templated operation", () => {
  const result = inspect({ "/v1/items/{id}": { get: { operationId: "getItem", summary: "Read item" } } });
  assert.equal(result.selector.selected_version, "2025-01");
  assert.equal(result.route.status, "matched");
  assert.equal(result.route.matched_operation.operation_id, "getItem");
});

test("matches query selector exactly and header selector case-insensitively", () => {
  const paths = { "/items": { get: {} } };
  const query = inspect(paths, request("GET", "/items", { query: [{ name: "api-version", value: "2" }] }), [selector("query", { name: "api-version", value: "2" })]);
  const header = inspect(paths, request("GET", "/items", { headers: [{ name: "X-API-Version", value: "2" }] }), [selector("header", { name: "x-api-version", value: "2" })]);
  assert.equal(query.selector.selected_version, "2025-01");
  assert.equal(header.selector.selected_version, "2025-01");
});

test("static paths take precedence over templated siblings", () => {
  const result = inspect({ "/items/{id}": { get: { operationId: "byId" } }, "/items/search": { get: { operationId: "search" } } }, request("GET", "/items/search"));
  assert.equal(result.route.matched_operation.operation_id, "search");
});

test("reports method-not-allowed with allowed methods", () => {
  const result = inspect({ "/items": { get: {}, post: {} } }, request("DELETE", "/items"));
  assert.equal(result.route.status, "method_not_allowed");
  assert.deepEqual(result.route.allowed_methods, ["GET", "POST"]);
});

test("reports missing routes and unmatched version selectors independently", () => {
  const result = inspect({ "/items": { get: {} } }, request("GET", "/absent"), [selector("query", { name: "v", value: "9" })]);
  assert.equal(result.route.status, "not_found");
  assert.equal(result.selector.status, "unmatched");
});

test("reports ambiguous version rules and ambiguous templated routes", () => {
  const ambiguousVersion = inspect({ "/items": { get: {} } }, request("GET", "/items", { query: [{ name: "v", value: "2" }] }), [
    selector("query", { version: "v2", name: "v", value: "2" }),
    selector("query", { version: "v3", name: "v", value: "2" })
  ]);
  assert.equal(ambiguousVersion.selector.status, "ambiguous");
  const ambiguousRoute = inspect({ "/items/{id}": { get: {} }, "/{type}/items": { get: {} } }, request("GET", "/items/items"));
  assert.equal(ambiguousRoute.route.status, "ambiguous");
});

test("does not decode encoded slashes into multiple path segments", () => {
  const result = inspect({ "/files/{name}": { get: {} } }, request("GET", "/files/a%2Fb"));
  assert.equal(result.route.status, "matched");
});

test("path-prefix selector uses a segment boundary", () => {
  const result = inspect({ "/items": { get: {} } }, request("GET", "/v10/items"), [selector("path_prefix", { value: "/v1" })]);
  assert.equal(result.selector.status, "unmatched");
});

test("does not treat Accept media types as version selectors", () => {
  const result = inspect({ "/items": { get: {} } }, request("GET", "/items", { headers: [{ name: "Accept", value: "application/vnd.shop.v2+json" }] }), [
    selector("header", { name: "x-api-version", value: "2" })
  ]);
  assert.equal(result.selector.status, "unmatched");
  assert.equal(result.route.status, "matched");
});

test("rejects empty input, invalid OpenAPI, query-in-path, and malformed templates", () => {
  assert.throws(() => inspectApiVersionRouting(null), RoutingInspectorError);
  assert.throws(() => inspectApiVersionRouting({ openapi_json: "", request: request(), selectors: [selector("path_prefix", { value: "/v1" })] }), /non-empty string/);
  assert.throws(() => inspectApiVersionRouting({ openapi_json: JSON.stringify({ openapi: "2.0", info: {}, paths: {} }), request: request(), selectors: [selector("path_prefix", { value: "/v1" })] }), /OpenAPI 3.0 or 3.1/);
  assert.throws(() => inspect({ "/items/{id": { get: {} } }), /malformed template/);
  assert.throws(() => inspect({ "/items": { get: {} } }, request("GET", "/items?v=2")), /without query or fragment/);
});

test("enforces selector, pair, path, document-depth, and size bounds", () => {
  const one = selector("path_prefix", { value: "/v1" });
  assert.throws(() => inspect({ "/items": { get: {} } }, request(), Array.from({ length: 33 }, (_, i) => ({ ...one, version: String(i) }))), /32 entries/);
  assert.throws(() => inspect({ "/items": { get: {} } }, request("GET", "/items", { query: Array.from({ length: 65 }, (_, i) => ({ name: "x" + i, value: "a" })) })), /64 entries/);
  assert.throws(() => inspect({ "/items": { get: {} } }, request("GET", "/" + "a".repeat(2048))), /2048 characters/);
  assert.throws(() => inspectApiVersionRouting({ openapi_json: " ".repeat(262145), request: request(), selectors: [one] }), /262144 characters/);
  const tooManyPaths = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => ["/p" + i, { get: {} }]));
  assert.throws(() => inspect(tooManyPaths), /1000 paths/);
  const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
  const tooManyOperations = Object.fromEntries(Array.from({ length: 251 }, (_, i) => ["/p" + i, Object.fromEntries(methods.map(method => [method, {}]))]));
  assert.throws(() => inspect(tooManyOperations), /2000 operations/);
  const deep = { openapi: "3.1.0", info: {}, paths: {} }; let cursor = deep;
  for (let i = 0; i < 66; i++) cursor = cursor.next = {};
  assert.throws(() => inspectApiVersionRouting({ openapi_json: JSON.stringify(deep), request: request(), selectors: [one] }), /depth 64/);
});

test("rejects unknown fields at each declared input layer", () => {
  const base = { openapi_json: document({ "/items": { get: {} } }), request: request("GET", "/items"), selectors: [selector("path_prefix", { value: "/v1" })] };
  assert.throws(() => inspectApiVersionRouting({ ...base, trace: true }), /unsupported field trace/);
  assert.throws(() => inspectApiVersionRouting({ ...base, request: { ...base.request, body: {} } }), /unsupported field body/);
  assert.throws(() => inspectApiVersionRouting({ ...base, request: { ...base.request, query: [{ name: "v", value: "2", secret: "ignored" }] } }), /unsupported field secret/);
  assert.throws(() => inspectApiVersionRouting({ ...base, selectors: [{ ...base.selectors[0], priority: 2 }] }), /unsupported field priority/);
});

test("rejects malformed selector sources and request header newlines", () => {
  assert.throws(() => inspect({ "/items": { get: {} } }, request(), [{ source: "accept", version: "2", name: "Accept", value: "x" }]), /unsupported source/);
  assert.throws(() => inspect({ "/items": { get: {} } }, request("GET", "/items", { headers: [{ name: "X-Test", value: "ok" + String.fromCharCode(13, 10) + "injected: yes" }] })), /CR or LF/);
});
