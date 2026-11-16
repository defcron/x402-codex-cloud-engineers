# URI-template conformance check prototype

This prototype handles RFC 6570 expressions without network access or model calls. The TypeScript module is the Worker integration artifact; the dependency-free Python module mirrors its behavior for standalone use. Both report referenced variables and expression modifiers, then expand templates using caller-provided JSON-compatible scalar, array, and flat-object values. Missing values are omitted per RFC 6570 and reported; unused values are reported separately.

Service key: `uri-template-conformance-check`.

## Example

```python
from uri_template import expand, inspect

template = "/users/{id}{?fields*}"
values = {"id": "a/b", "fields": ["name", "email"]}

print(inspect(template))
print(expand(template, values))
```

The expanded value is `/users/a%2Fb?fields=name&fields=email`. Values are substituted into the supplied template; this module does not fetch or validate a destination URL.

HTTP contract example (illustrative; the route is not deployed):

```json
{
  "request": {
    "template": "/users/{id}{?fields*}",
    "values": { "id": "a/b", "fields": ["name", "email"] }
  },
  "response": {
    "valid": true,
    "variables": ["id", "fields"],
    "missing_variables": [],
    "unused_variables": [],
    "expanded": "/users/a%2Fb?fields=name&fields=email"
  }
}
```

The TypeScript API exports `validateUriTemplateInput(body)`, `inspectUriTemplate(template)`, `expandUriTemplate(template, values)`, and `handleUriTemplateWorkerRequest(request)` from `uri-template.ts`, plus `UriTemplateError` (with HTTP-compatible `status` 400 or 413) and the public `URI_TEMPLATE_LIMITS`. `openapi-uri-template-fragment.json` contains a suggested paid-route schema and example for integration with the existing Worker.

## Bounds

- Template: 1–4,096 characters, at most 100 expressions and 50 distinct variables.
- Values: at most 50 variables, 256 characters per variable name, 4,096 combined scalar/key characters, and 100 entries per array or object.
- Nested objects/arrays are rejected; maps can contain scalar values only. Prefix modifiers require scalar values.
- HTTP JSON body is capped at 65,536 bytes; expanded output is capped at 262,144 characters.
- Malformed braces, operators, varspecs, percent escapes and non-URI literal characters raise `TemplateError` in Python or `UriTemplateError` in TypeScript.

## Checks

Run `node --experimental-strip-types --test test-uri-template.mjs` for the TypeScript Worker module, or `python -m unittest -v test_uri_template.py` for its Python companion. The cases cover RFC 6570 operator forms, reserved and UTF-8 encoding, percent-encoded variable names, prototype-like names, scalar/list/map expansion, missing and unused variables, malformed templates, invalid Unicode, and exact input/output boundaries.

This is an isolated reusable module, not a deployed HTTP endpoint. Integrate it with the existing Worker only after the shared owner supplies an authorized integration branch and confirms the shared reservation.

## Worker integration handoff

The production repository's `main` branch at version `0.8.206` uses TypeScript modules and Hono routes. Its `src/worker.ts` separates route payment metadata, handler registration, and the generated OpenAPI operations; the free tool catalog is maintained separately. For integration, copy `uri-template.ts` into `src/uri-template.ts` and import it as `./uri-template.js` from `src/worker.ts`. Register `POST /v1/uri-template` through the existing x402 payment route map at `$0.005`, then use this Hono handler behind the existing x402 middleware:

```ts
app.post("/v1/uri-template", async (c) => {
  const result = await handleUriTemplateWorkerRequest(c.req.raw);
  if (result.status === 200) {
    c.set("callRecord", {
      id: crypto.randomUUID(),
      day: new Date().toISOString().slice(0, 10),
      modelCostMicros: 0,
      inputTokens: 0,
      outputTokens: 0,
      priceUsd: 0.005,
      itemsProcessed: 1,
    });
  }
  return c.json(result.body, result.status);
});
```

Merge `openapi-uri-template-fragment.json` into the generated OpenAPI document, add the same example as `/examples/uri-template`, add discovery text, and register a free MCP catalog tool pointing to the paid route. Then run the production repo's `npm test` and `npm run build` before deployment. These integration steps have not been applied or run in that repository.

Merge `openapi-uri-template-fragment.json` into the generated OpenAPI document, add a public example and discovery text, and register a free MCP catalog tool pointing to the paid route. Then run the production repo's `npm test` and `npm run build` before deployment. These integration steps have not been applied or run in that repository.
