import test from "node:test";
import assert from "node:assert/strict";
import { handleApiVersionRoutingRequest } from "./worker-handler.mjs";

const input = {
  openapi_json: JSON.stringify({ openapi: "3.1.0", info: { title: "X", version: "1" }, paths: { "/v1/items": { get: { operationId: "items" } } } }),
  request: { method: "GET", path: "/v1/items", headers: [{ name: "X-API-Key", value: "secret" }] },
  selectors: [{ source: "path_prefix", value: "/v1", version: "1" }]
};

test("returns JSON route inspection without echoing request headers", async () => {
  const response = await handleApiVersionRoutingRequest(new Request("https://local.test/inspect", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input)
  }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.route.status, "matched");
  assert.equal(JSON.stringify(result).includes("secret"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("rejects non-POST requests and non-JSON content types", async () => {
  assert.equal((await handleApiVersionRoutingRequest(new Request("https://local.test/inspect"))).status, 405);
  const response = await handleApiVersionRoutingRequest(new Request("https://local.test/inspect", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}"
  }));
  assert.equal(response.status, 415);
});

test("maps malformed JSON to a client error", async () => {
  const response = await handleApiVersionRoutingRequest(new Request("https://local.test/inspect", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{"
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /valid JSON/);
});

test("streams and rejects request bodies over 512 KiB", async () => {
  const response = await handleApiVersionRoutingRequest(new Request("https://local.test/inspect", {
    method: "POST", headers: { "content-type": "application/json" }, body: " ".repeat(524289)
  }));
  assert.equal(response.status, 413);
});
