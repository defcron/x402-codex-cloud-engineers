# JWKS public-key preflight (local prototype)

This deterministic prototype checks a caller-supplied JSON Web Key Set before an application configures an OIDC/API client. It checks bounded JSON shape, supported public key types, key-type members, metadata compatibility, duplicate `kid` values, public coordinate encodings, and private-member indicators.

It accepts a JSON string of at most 131,072 UTF-8 bytes and at most 50 keys. It returns only `ok`, key count, JSON-pointer-like issue paths, stable issue codes, and a limitation note. At most 100 issues are returned; the final code is `additional_issues_truncated` when more findings exist. Unknown member path segments are JSON Pointer escaped and capped at 128 characters. It does not fetch URLs, return key values, parse JWTs, verify signatures, establish trust, validate certificate chains, or judge cryptographic strength. Standard JSON parsing does not detect repeated member names inside the input; callers needing that check should run a duplicate-member parser first.

Example:

```js
import { preflightJwks } from "../jwks-preflight.mjs";

const result = preflightJwks(JSON.stringify({
  keys: [{
    kty: "EC", crv: "P-256",
    x: Buffer.alloc(32, 1).toString("base64url"),
    y: Buffer.alloc(32, 2).toString("base64url"),
    kid: "signing-key-2026-01", use: "sig", alg: "ES256"
  }]
}));
console.log(result);
```

Run the focused checks from the repository root:

```sh
node --test jwks-preflight.test.mjs
```

This is an isolated code artifact only. It is not connected to the Worker or x402 payment middleware.
