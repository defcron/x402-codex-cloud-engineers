import assert from "node:assert/strict";
import test from "node:test";
import { expandUriTemplate, handleUriTemplateWorkerRequest, inspectUriTemplate, UriTemplateError, URI_TEMPLATE_LIMITS, validateUriTemplateInput } from "./uri-template.ts";

test("parses expression variables and modifiers", () => {
  assert.deepEqual(inspectUriTemplate("/users/{id}{?fields*}").variables, ["id", "fields"]);
  assert.deepEqual(inspectUriTemplate("{?fields*}").expressions[0], {
    operator: "?", variables: [{ name: "fields", explode: true, prefix: null }],
  });
});

test("rejects malformed template syntax and URI literals", () => {
  for (const value of ["x}", "{x", "{{x}}", "{}", "{x,,y}", "{x:0}", "{x:10000}", "{x:2*}", "{bad name}", "{x%Q1}", "/has space", "/bad%", "/emoji-😀"]) {
    assert.throws(() => inspectUriTemplate(value), UriTemplateError, value);
  }
});

test("accepts configured maximum input and output boundaries", () => {
  assert.equal(inspectUriTemplate("a".repeat(URI_TEMPLATE_LIMITS.templateChars)).valid, true);
  assert.equal(inspectUriTemplate("{x}".repeat(URI_TEMPLATE_LIMITS.expressions)).expressions.length, 100);
  const vars = Array.from({ length: URI_TEMPLATE_LIMITS.variables }, (_, i) => `v${i}`);
  assert.equal(inspectUriTemplate(`{${vars.join(",")}}`).variables.length, 50);
  assert.equal(inspectUriTemplate(`{${"x".repeat(URI_TEMPLATE_LIMITS.variableNameChars)}}`).valid, true);
  assert.equal(expandUriTemplate("{x}", { x: "x".repeat(URI_TEMPLATE_LIMITS.valueChars) }).expanded.length, 4096);
  assert.equal(expandUriTemplate("{?list*}", { list: Array(URI_TEMPLATE_LIMITS.collectionEntries).fill("x") }).valid, true);
  assert.equal(expandUriTemplate("{x}".repeat(64), { x: "x".repeat(4096) }).expanded.length, URI_TEMPLATE_LIMITS.outputChars);
});

test("applies the RFC 6570 operator forms", () => {
  const values = { var: "value", hello: "Hello World!", path: "/foo/bar", x: 1024, y: 768 };
  const examples = new Map([
    ["{var}", "value"], ["{hello}", "Hello%20World%21"], ["{+path}/here", "/foo/bar/here"],
    ["{#path}", "#/foo/bar"], ["X{.var}", "X.value"], ["{/var}", "/value"],
    ["{;x,y}", ";x=1024;y=768"], ["{?x,y}", "?x=1024&y=768"],
    ["{&x,y}", "&x=1024&y=768"], ["{var:3}", "val"],
  ]);
  for (const [template, expected] of examples) assert.equal(expandUriTemplate(template, values).expanded, expected, template);
});

test("expands lists and flat maps", () => {
  const values = { list: ["red", "green", "blue"], keys: { semi: ";", dot: ".", comma: "," } };
  assert.equal(expandUriTemplate("{?list}", values).expanded, "?list=red,green,blue");
  assert.equal(expandUriTemplate("{list*}", values).expanded, "red,green,blue");
  assert.equal(expandUriTemplate("{/list*}", values).expanded, "/red/green/blue");
  assert.equal(expandUriTemplate("{.list*}", values).expanded, ".red.green.blue");
  assert.equal(expandUriTemplate("{;list*}", values).expanded, ";list=red;list=green;list=blue");
  assert.equal(expandUriTemplate("{?list*}", values).expanded, "?list=red&list=green&list=blue");
  assert.equal(expandUriTemplate("{keys*}", values).expanded, "semi=%3B,dot=.,comma=%2C");
  assert.equal(expandUriTemplate("{.keys*}", values).expanded, ".semi=%3B.dot=..comma=%2C");
  assert.equal(expandUriTemplate("{/keys*}", values).expanded, "/semi=%3B/dot=./comma=%2C");
  assert.equal(expandUriTemplate("{;keys*}", values).expanded, ";semi=%3B;dot=.;comma=%2C");
  assert.equal(expandUriTemplate("{?keys*}", values).expanded, "?semi=%3B&dot=.&comma=%2C");
  assert.equal(expandUriTemplate("{keys}", values).expanded, "semi,%3B,dot,.,comma,%2C");
});

test("encodes scalar values and preserves reserved characters only for reserved operators", () => {
  assert.equal(expandUriTemplate("{var}", { var: "a/b café!" }).expanded, "a%2Fb%20caf%C3%A9%21");
  assert.equal(expandUriTemplate("{+var}", { var: "a/b?c!'()*" }).expanded, "a/b?c!'()*");
});

test("reports missing and unused values", () => {
  const result = expandUriTemplate("/p/{id}{?q,missing}", { id: "", q: "", spare: 2 });
  assert.equal(result.expanded, "/p/?q=");
  assert.deepEqual(result.missing_variables, ["missing"]);
  assert.deepEqual(result.unused_variables, ["spare"]);
  assert.equal(expandUriTemplate("{;empty}", { empty: "" }).expanded, ";empty");
  assert.equal(expandUriTemplate("{?empty}", { empty: "" }).expanded, "?empty=");
  assert.equal(expandUriTemplate("{?absent}", {}).expanded, "");
});

test("preserves percent-encoded varnames and safely handles prototype-like names", () => {
  assert.equal(expandUriTemplate("{?foo%20bar}", { "foo%20bar": "x" }).expanded, "?foo%20bar=x");
  const request = validateUriTemplateInput(JSON.parse('{"template":"{?__proto__,constructor}","values":{"__proto__":"p","constructor":"c"}}'));
  assert.equal(Object.getPrototypeOf(request.values), null);
  assert.equal(expandUriTemplate(request.template, request.values).expanded, "?__proto__=p&constructor=c");
});

test("validates strict request bodies for a Worker route", () => {
  const valid = validateUriTemplateInput({ template: "/p/{id}", values: { id: "7" } });
  assert.equal(valid.template, "/p/{id}");
  assert.deepEqual(Object.entries(valid.values), [["id", "7"]]);
  assert.throws(() => validateUriTemplateInput({ template: "/p/{id}", values: { id: "7" }, extra: true }), UriTemplateError);
  assert.throws(() => validateUriTemplateInput({ template: "/p/{id}", values: { id: [{ nested: "x" }] } }), UriTemplateError);
});

test("Worker adapter returns bounded JSON and rejects bad HTTP inputs", async () => {
  const valid = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template: "/users/{id}{?fields*}", values: { id: "a/b", fields: ["name", "email"] } }),
  }));
  assert.equal(valid.status, 200);
  assert.equal(valid.body.expanded, "/users/a%2Fb?fields=name&fields=email");

  const malformed = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{" ,
  }));
  assert.equal(malformed.status, 400);

  const unsupportedType = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
  }));
  assert.equal(unsupportedType.status, 415);

  const wrongMethod = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", { method: "GET" }));
  assert.equal(wrongMethod.status, 405);

  const invalidUtf8 = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "application/json" }, body: new Uint8Array([0xc3, 0x28]),
  }));
  assert.equal(invalidUtf8.status, 400);

  const failedStream = new ReadableStream({ start(controller) { controller.error(new Error("transport failure")); } });
  const unreadable = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "application/json" }, body: failedStream, duplex: "half",
  }));
  assert.equal(unreadable.status, 400);
});

test("Worker adapter accepts the byte limit and rejects one byte over", async () => {
  const base = '{"template":"x","values":{}}';
  const exactBody = base + " ".repeat(URI_TEMPLATE_LIMITS.requestBytes - base.length);
  const exact = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "application/json" }, body: exactBody,
  }));
  assert.equal(exact.status, 200);

  const over = await handleUriTemplateWorkerRequest(new Request("https://worker.invalid/v1/uri-template", {
    method: "POST", headers: { "content-type": "application/json" }, body: `${exactBody} `,
  }));
  assert.equal(over.status, 413);
});

test("rejects invalid values and bounds", () => {
  assert.throws(() => inspectUriTemplate("a".repeat(URI_TEMPLATE_LIMITS.templateChars + 1)), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => inspectUriTemplate("{x}".repeat(URI_TEMPLATE_LIMITS.expressions + 1)), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => inspectUriTemplate(`{${Array.from({ length: 51 }, (_, i) => `v${i}`).join(",")}}`), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => inspectUriTemplate(`{${"x".repeat(URI_TEMPLATE_LIMITS.variableNameChars + 1)}}`), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => expandUriTemplate("{x}", { x: "v".repeat(4097) }), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => expandUriTemplate("{x}", { x: Array(101).fill("v") }), (error) => error instanceof UriTemplateError && error.status === 413);
  assert.throws(() => expandUriTemplate("{x}", { x: { nested: { bad: 1 } } }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x:2}", { x: ["a"] }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}", { x: Infinity }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}", { x: Number.NaN }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}", { x: "\ud800" }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}", { x: Symbol("bad") }), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}", Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`v${i}`, "x"]))), UriTemplateError);
  assert.throws(() => expandUriTemplate("{x}".repeat(100), { x: "x".repeat(4096) }), (error) => error instanceof UriTemplateError && error.status === 413);
});
