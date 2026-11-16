# Safe URL preflight (Engineer 03)

## Contract

An agent that is about to pass a URL to another fetch-capable tool needs a consistent canonical form and a static check for obvious parser and destination hazards. This utility accepts one absolute URL up to 8,192 characters, normalizes it with the standard WHATWG `URL` parser, removes the fragment, and reports structured findings. It never resolves DNS, opens a connection, follows redirects, or claims a `review` result is safe.

Example:

```js
safeUrlPreflight("https://Example.COM:443/a/../b?q=1#section")
// {
//   ok: true,
//   verdict: "review",
//   normalized_url: "https://example.com/b?q=1",
//   hostname: "example.com",
//   findings: ["fragment_removed"],
//   checks: { dns_resolved: false, fetched: false, redirects_checked: false }
// }
```

Recognizable localhost names, local/private/reserved IP literals, unsupported schemes, userinfo, backslashes, whitespace/control characters, malformed URLs, and oversized input are blocked or rejected. Plain HTTP and non-default ports are findings that require caller review. A caller that later fetches must independently resolve and validate every address, defend against DNS rebinding, disable or revalidate redirects, and enforce connection timeouts and response-size limits.

The live Agent Evidence Utility has URL query parse/serialize operations but no full-URL static preflight in OpenAPI v0.8.206. PayAPI already lists fetch-oriented SSRF defenses (Safe web reader, CrawlSafe), URL status checks, and a robots preflight. This work is narrower: canonicalization and static linting without a fetch. Its distinct value is therefore limited to callers composing other fetch services; it must not be marketed as an SSRF defense by itself.

## Focused checks

Run with Node.js 20 or later:

```sh
node --test workstreams/safe-url-preflight.test.mjs
```

Expected coverage: canonicalization; public-looking review result; loopback/private and short-form IPv4 blocking; local names and IPv6; credentials and unsupported schemes; empty, malformed, whitespace/backslash, non-string, and length boundary inputs.

## Integration boundary

Artifact only. No production Worker, route catalog, payment middleware, secrets, deployment, or PayAPI submission is changed. Before integration, compare the current catalog and shared service reservations again. Proposed route key: `eng03.safe-url-preflight`; suggested request `{ "url": "https://example.com/path" }`; successful response schema mirrors `safeUrlPreflight`; intended price must be assigned by the integration owner and remain at or below USD 0.10.
