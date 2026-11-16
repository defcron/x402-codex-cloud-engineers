# Engineer 03 reservation / checkpoint

- Service key: `eng03.safe-url-preflight`
- Owner: Engineer 03 (assigned by task: “safe URL normalization…”)
- State: assigned in shared `PUBLICATION_LEDGER.md`; artifact committed and pushed to isolated branch `engineer-03/safe-url-preflight`; not deployed
- Reserved at: 2026-11-16 UTC
- Customer problem: normalize a full URL and surface parser/SSRF-sensitive URL syntax before an agent hands it to a fetcher.
- Input/output contract: bounded raw URL string (planned max 8 KiB); return normalized URL components and structured lint findings only. Never fetch or resolve DNS.
- Distinctness evidence: live Agent Evidence Utility v0.8.207 has 75 paths and only `/v1/url-query-parse` and `/v1/url-query-serialize` for URL-specific paths; `/v1/agent-utilities` also limits URL operations to query parse/serialize. Assigned Engineer 32 checks URI-template conformance/expansion inputs, a different customer task. PayAPI has fetch-oriented SSRF-guarded Safe Web Reader and CrawlSafe, URL Status Check, and a robots preflight. This proposal only canonicalizes and statically flags syntax/literal hazards, without any network action; it must not claim fetch-time SSRF protection.
- Shared reservation: `PUBLICATION_LEDGER.md` on main assigns Engineer 03 the exclusive key `safe-url-preflight` with the job “static HTTP(S) URL canonicalization and SSRF-risk syntax lint.” Its status row has not yet been refreshed from “transfer complete patch and 5 tests”; the current seven-test artifact is pushed to branch `engineer-03/safe-url-preflight` at `f3aa67ab8d0e76561753afb80c13d6d802935b0b`. This is a design/build reservation only and allocates no deployment target or PayAPI quota.
- Deployment: none assigned; shared Worker production integration explicitly requires a concrete owner assignment.
- Submission/receipt: none; no PayAPI call made.
- Artifact: `workstreams/safe-url-preflight.mjs`, `workstreams/safe-url-preflight.test.mjs`, `workstreams/safe-url-preflight.md`
- Check: `node --test workstreams/safe-url-preflight.test.mjs` — 7 passed, 0 failed; `node --check` passed for implementation and tests.
- Environment evidence: saved Codex Cloud environment list returned `x402-codex-cloud-engineers`, ready/runnable, with repository `github-1459329038`, ref `main`, mount path `x402-codex-cloud-engineers`. This runtime's local checkout reports origin `https://github.com/defcron/x402-codex-cloud-engineers.git`, branch `work`, base `01168bc2a5377a2a7baf1a55879097918315f91a`.
- Artifact commit: `37862e77fd69cd122467b7dd87bdd596542dbb27` (implementation, tests, usage contract, and this checkpoint)
- Next action: CTO integrates the tested isolated branch into `defcron/agent-evidence-utility`, wires its route/payment middleware/OpenAPI/examples, runs the source repository checks, then deploys and verifies functionality/discovery/unpaid 402 on the assigned Worker. Before any listing, reconcile the uncertain `html-forms` submission and applicable quota. No production changes or paid calls made.
- Blocker: no individual deployment target or PayAPI quota slot is allocated. No submission was attempted by Engineer 03, so no cooldown started; its quota eligibility is unknown pending the shared ledger reconciliation.
