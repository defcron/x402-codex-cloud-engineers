# JWKS cache and rotation policy validator (prototype)

Deterministic offline diagnostics for a caller's sampled JWKS responses. It checks `Cache-Control` freshness and stale-serving windows against caller policy, then checks whether sampled old/new key co-presence covers the combined cache lifetime, stale allowance, token lifetime, and safety margin. This JWKS-specific relationship is the main service behavior; it is distinct from general cache TTL auditing and one-document JWKS linting.

It does not fetch URLs, retain inputs, validate JWK material, verify JWT signatures, or prove continuous availability between samples. It uses `kid` labels only, so it will not detect changed key material that reuses an existing `kid`. Duplicate `kid` values within one snapshot are rejected as malformed comparison input, rather than reported as a static JWKS audit. The result is an operational diagnostic, not an authentication decision.

## Contract

Call `validateJwksCachePolicy(input)` from `validator.mjs`.

- `policy.max_age_seconds`: maximum permitted `max-age`/`s-maxage` (0–31,536,000).
- `policy.max_stale_seconds`: maximum `stale-while-revalidate` and `stale-if-error` (0–604,800).
- `policy.maximum_token_lifetime_seconds`: caller's maximum token lifetime (0–604,800).
- `policy.safety_margin_seconds`: extra caller-selected propagation margin (0–604,800).
- Required sampled overlap is derived as `max_age_seconds + max_stale_seconds + maximum_token_lifetime_seconds + safety_margin_seconds`.
- `snapshots`: 2–20 strictly time-ordered observations with valid ISO `observed_at`, integer `age_seconds`, raw `cache_control` (≤1,024 chars), and `jwks.keys` (≤100 keys, each with a bounded non-empty unique `kid`). Total JSON input is capped at 262,144 characters.
- Return: `ok`, summary counts, cache report per snapshot, old/new key-pair overlap reports, actionable findings, and a limitation note. Key material is not copied into output.

Malformed or out-of-bound input throws `TypeError`, including duplicate `kid` values within a snapshot because they make old/new key comparison ambiguous. Removing old keys without any replacement in the final snapshot is an error. A valid input with policy violations returns `ok:false` and finding codes; an observation whose `Age` exceeds its effective cache lifetime is a warning. `s-maxage` takes precedence over `max-age` for the shared-cache freshness check. It never performs network access.

## Example and focused checks

```sh
node --input-type=module -e 'import fs from "node:fs"; import {validateJwksCachePolicy} from "./workstream-10/validator.mjs"; const r=validateJwksCachePolicy(JSON.parse(fs.readFileSync("workstream-10/example.json", "utf8"))); console.log(JSON.stringify(r, null, 2));'
node --test workstream-10/validator.test.mjs
```

The example expects one sampled old/new overlap of 1,200 seconds against a derived 1,020-second minimum and an `ok:true` result. The tests cover passing rotation, cache limits, missing/no-store cache policy, insufficient overlap, malformed snapshots, timestamps, and bounds. This repository is a design/prototype workspace; it does not include the production Worker source or an assigned deployment workflow.
