import test from "node:test";
import assert from "node:assert/strict";
import { safeUrlPreflight, SAFE_URL_PREFLIGHT_MAX_LENGTH } from "./safe-url-preflight.mjs";

test("canonicalizes host casing, default port, dot segments and strips fragments", () => {
  const result = safeUrlPreflight("https://Example.COM:443/a/../b?q=1#section");
  assert.equal(result.ok, true);
  assert.equal(result.verdict, "review");
  assert.equal(result.normalized_url, "https://example.com/b?q=1");
  assert.deepEqual(result.findings, ["fragment_removed"]);
  assert.deepEqual(result.checks, { dns_resolved: false, fetched: false, redirects_checked: false });
});

test("returns review for an ordinary public-looking URL without claiming it is safe", () => {
  const result = safeUrlPreflight("https://example.com/");
  assert.equal(result.ok, true);
  assert.equal(result.verdict, "review");
  assert.equal(result.normalized_url, "https://example.com/");
});

test("canonicalizes IDNs and blocks alternate numeric IPv4 plus reserved local names", () => {
  const idn = safeUrlPreflight("https://bücher.com/path");
  assert.equal(idn.ok, true);
  assert.equal(idn.normalized_url, "https://xn--bcher-kva.com/path");
  assert.equal(idn.verdict, "review");
  for (const url of ["http://0x7f000001/", "http://0177.0.0.1/", "https://service.example/"]) {
    assert.equal(safeUrlPreflight(url).verdict, "block", url);
  }
});

test("flags HTTP and non-default ports for review while preserving normalized URL", () => {
  const http = safeUrlPreflight("http://example.com/path");
  assert.equal(http.verdict, "review");
  assert.deepEqual(http.findings, ["unencrypted_http"]);
  const port = safeUrlPreflight("https://example.com:8443/path");
  assert.equal(port.verdict, "review");
  assert.equal(port.normalized_url, "https://example.com:8443/path");
  assert.deepEqual(port.findings, ["non_default_port"]);
});

test("blocks loopback and private IPv4 literals including WHATWG short-form aliases", () => {
  for (const url of ["http://127.0.0.1/", "http://127.1/", "http://10.4.5.6/", "http://169.254.169.254/", "http://0.12.34.56/"]) {
    const result = safeUrlPreflight(url);
    assert.equal(result.ok, true);
    assert.equal(result.verdict, "block", url);
    assert.equal(result.normalized_url, null);
  }
});

test("blocks local names, local IPv6 literals, userinfo and non-web schemes", () => {
  assert.ok(safeUrlPreflight("https://printer.local/").findings.includes("private_or_local_name"));
  assert.ok(safeUrlPreflight("http://[::1]/").findings.includes("ipv6_loopback_or_unspecified"));
  assert.ok(safeUrlPreflight("http://[::ffff:127.0.0.1]/").findings.includes("ipv4_mapped_private_ipv6"));
  assert.ok(safeUrlPreflight("http://[::127.0.0.1]/").findings.includes("ipv4_compatible_private_ipv6"));
  assert.ok(safeUrlPreflight("http://[fec0::1]/").findings.includes("ipv6_site_local_deprecated"));
  assert.deepEqual(safeUrlPreflight("https://user:secret@example.com/"), { ok: false, error: "userinfo_not_allowed" });
  assert.deepEqual(safeUrlPreflight("https://@example.com/"), { ok: false, error: "userinfo_not_allowed" });
  assert.deepEqual(safeUrlPreflight("file:///etc/passwd"), { ok: false, error: "scheme_not_http_or_https" });
});

test("rejects empty, malformed, whitespace, backslash, non-string and oversized input", () => {
  assert.deepEqual(safeUrlPreflight(""), { ok: false, error: "url_required" });
  assert.deepEqual(safeUrlPreflight("example.com"), { ok: false, error: "url_invalid_or_not_absolute" });
  assert.deepEqual(safeUrlPreflight("https://example.com/a b"), { ok: false, error: "url_contains_whitespace_or_control" });
  assert.deepEqual(safeUrlPreflight("https://example.com/ path"), { ok: false, error: "url_contains_whitespace_or_control" });
  assert.deepEqual(safeUrlPreflight("https://example.com/\u200bpath"), { ok: false, error: "url_contains_whitespace_or_control" });
  assert.deepEqual(safeUrlPreflight("https://example.com\\@127.0.0.1"), { ok: false, error: "url_contains_backslash" });
  assert.deepEqual(safeUrlPreflight(null), { ok: false, error: "url_must_be_a_string" });
  const maximumLengthUrl = `https://example.com/${"a".repeat(SAFE_URL_PREFLIGHT_MAX_LENGTH - "https://example.com/".length)}`;
  assert.equal(maximumLengthUrl.length, SAFE_URL_PREFLIGHT_MAX_LENGTH);
  assert.equal(safeUrlPreflight(maximumLengthUrl).verdict, "review");
  assert.deepEqual(safeUrlPreflight("x".repeat(SAFE_URL_PREFLIGHT_MAX_LENGTH + 1)), { ok: false, error: "url_too_long" });
});
