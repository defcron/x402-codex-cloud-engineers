# API version routing inspector (#28)

Inspect one captured request against one caller-supplied OpenAPI document and explicit routing-version rules. This resolves operational routing evidence; it does not compare API releases or claim compatibility.

## Customer contract

Input is one object:

- openapi_json: OpenAPI 3.0/3.1 JSON text.
- request: method, absolute path without query/fragment, optional query pairs and header pairs.
- selectors: caller-declared rules from path_prefix, query, or header. Each rule names a version and exact selector value.

Output returns the spec metadata, whether selectors are unmatched/selected/ambiguous, the selected version when unique, and whether the method/path matches an operation, is absent, has a method mismatch, or matches multiple templates. It returns operationId/summary but never echoes request header or query values.

Example:

    const openapi_json = JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Catalog", version: "2.0" },
      paths: { "/v2/items/{id}": { get: { operationId: "getItem" } } }
    });
    const request = {
      openapi_json,
      request: { method: "GET", path: "/v2/items/42", query: [], headers: [] },
      selectors: [{ source: "path_prefix", value: "/v2", version: "2" }]
    };
    console.log(inspectApiVersionRouting(request));

Expected essentials:

    {
      "api_version": "2.0",
      "selector": {"status":"selected","selected_version":"2"},
      "route": {"status":"matched","matched_operation":{"method":"GET","path":"/v2/items/{id}","operation_id":"getItem"}}
    }

## Limits and failure behavior

- HTTP JSON body: at most 524,288 bytes. OpenAPI JSON within it: at most 262,144 characters, 1,000 paths, 2,000 operations, 30,000 JSON nodes, and depth 64.
- Unknown fields at the request body, request object, selector, and query/header pair levels are rejected.\n- Request path: at most 2,048 characters. Query/header pairs: at most 64 each. Selector rules: 1–32. Names/values have explicit per-field caps enforced in the source.
- Empty/malformed or unsupported documents, invalid methods, malformed path templates, unsupported selectors, CR/LF in header inputs, and invalid request shapes return RoutingInspectorError (400); bounded-size violations return status 413.
- Path matching is segment-wise and does not percent-decode, fetch server URLs, resolve references, or execute document content. Static exact path wins over templates; multiple matching templates are reported ambiguous.
- Version resolution only applies caller rules. It does not infer conventional version names or parse Accept media types. It does not include auth middleware; integrations must not echo/store captured credentials.

## Distinct scope

Main ledger key for #28 is api-version-routing-inspector. #29 owns openapi-operation-compatibility-diff, which compares before/after OpenAPI operation contracts and reports likely directional breaking changes. #28 takes one request snapshot, applies caller rules, and resolves its route in one spec; there are no before/after docs, schema diffs, or breaking-change findings here. The former #28 compatibility-matrix prototype was superseded because it duplicated #29's customer job and remains only for review.

#42 owns API version/media negotiation. This service intentionally ignores Accept negotiation and only applies explicit path-prefix, query-parameter, or header selector rules.

## Worker integration handoff

See manifest.json. The manifest proposes POST /v1/api-version-routing-inspector at $0.005 per request and zero runtime model/API calls. worker-handler.mjs provides bounded JSON HTTP handling but no payment logic. A central integrator must register handleApiVersionRoutingRequest through the existing Worker router and existing x402 payment middleware, add the request/response schema and example to live OpenAPI/docs, and confirm the live challenge price/network/asset/payTo. This branch has no production route registration, deployment target, or quota slot.

Focused tests:

    node --test workstreams/engineer-28-api-version-routing-inspector/inspect.test.mjs workstreams/engineer-28-api-version-routing-inspector/worker-handler.test.mjs
