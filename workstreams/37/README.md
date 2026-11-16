# Engineer 37: API request/response fixture builder

Builds bounded local request/expected-response cases from one OpenAPI operation and up to 10 caller-provided pairs. Missing request values are sampled from inline JSON schemas; each top-level required body property also gets a synthetic negative case. Samples are explicitly marked `illustrative_unvalidated`; unresolved references and unenforced constraints appear as caveats.

The Fetch-compatible handler returns JSON errors and no-store responses. It makes no target API calls and is not payment middleware. Production Hono integration:

```ts
app.post("/v1/api-request-response-fixtures", (c) => handleApiFixtureRequest(c.req.raw));
```

Route it through central payment middleware and add OpenAPI/discovery and example entries. Verify middleware ordering before deployment.

Example: `workstreams/37/examples/api-request-response-fixtures.json`

After applying this diff, run `node --test workstreams/37/test/api-request-response-fixtures.test.mjs`.
