const MAX_URL_LENGTH = 8192;

const PRIVATE_IPV4_RANGES = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

function ipv4Number(parts) {
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function isInIpv4Range(parts, network, prefix) {
  if (prefix === 0) return true;
  const shift = 32 - prefix;
  return (ipv4Number(parts) >>> shift) === (ipv4Number(network) >>> shift);
}

function parseCanonicalIpv4(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every((part) => part <= 255) ? bytes : null;
}

function isPrivateIpv4(hostname) {
  const parts = parseCanonicalIpv4(hostname);
  return parts !== null && PRIVATE_IPV4_RANGES.some(([network, prefix]) => isInIpv4Range(parts, network, prefix));
}

function expandIpv6(hostname) {
  const address = hostname.slice(1, -1).toLowerCase();
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  let right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const dotted = right.at(-1)?.includes(".") ? right.pop() : null;
  if (dotted) {
    const v4 = dotted.split(".").map(Number);
    if (v4.length !== 4 || v4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    right.push(((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16));
  }
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[\da-f]{1,4}$/i.test(part))) return null;
  return groups.map((part) => Number.parseInt(part, 16));
}

function ipv4MappedV6Finding(hostname) {
  const groups = expandIpv6(hostname);
  if (!groups || groups.slice(0, 5).some((part) => part !== 0)) return null;
  const isMapped = groups[5] === 0xffff;
  const isCompatible = groups[5] === 0;
  if (!isMapped && !isCompatible) return null;
  const parts = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255];
  return PRIVATE_IPV4_RANGES.some(([network, prefix]) => isInIpv4Range(parts, network, prefix))
    ? isMapped ? "ipv4_mapped_private_ipv6" : "ipv4_compatible_private_ipv6"
    : null;
}

function ipv6Finding(hostname) {
  const host = hostname.toLowerCase();
  if (host === "[::]" || host === "[::1]") return "ipv6_loopback_or_unspecified";
  if (/^\[(?:fc|fd)/.test(host)) return "ipv6_unique_local";
  if (/^\[fe[89ab]/.test(host)) return "ipv6_link_local";
  if (/^\[fec[0-9a-f]:/i.test(host)) return "ipv6_site_local_deprecated";
  if (/^\[ff/.test(host)) return "ipv6_multicast";
  const mapped = ipv4MappedV6Finding(host);
  if (mapped) return mapped;
  if (host.startsWith("[2001:db8:")) return "ipv6_documentation_range";
  return null;
}

function hostnameFinding(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (isPrivateIpv4(host)) return "non_public_ipv4_literal";
  const ipv6 = ipv6Finding(hostname);
  if (ipv6) return ipv6;
  if (host === "localhost" || host.endsWith(".localhost")) return "localhost_name";
  if (host.endsWith(".local") || host.endsWith(".internal") || host === "internal") return "private_or_local_name";
  if (host.endsWith(".home.arpa")) return "home_network_name";
  if (!host.includes(".")) return "single_label_hostname";
  return null;
}

/**
 * Canonicalize and statically lint one absolute HTTP(S) URL. This does not
 * resolve DNS, connect, or inspect redirects; non-blocked results always need
 * the caller's own fetch-time destination checks.
 *
 * @param {unknown} input
 * @returns {{ok: true, verdict: "block"|"review", normalized_url: string|null, hostname: string, findings: string[], checks: {dns_resolved: false, fetched: false, redirects_checked: false}} | {ok: false, error: string}}
 */
export function safeUrlPreflight(input) {
  if (typeof input !== "string") return { ok: false, error: "url_must_be_a_string" };
  if (input.length === 0) return { ok: false, error: "url_required" };
  if (input.length > MAX_URL_LENGTH) return { ok: false, error: "url_too_long" };
  if (/[\u0000-\u0020\u007f]/u.test(input)) return { ok: false, error: "url_contains_whitespace_or_control" };
  if (input.includes("\\")) return { ok: false, error: "url_contains_backslash" };

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "url_invalid_or_not_absolute" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, error: "scheme_not_http_or_https" };
  if (!parsed.hostname) return { ok: false, error: "hostname_required" };
  const hasUserinfo = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(input);
  if (hasUserinfo || parsed.username || parsed.password) return { ok: false, error: "userinfo_not_allowed" };

  const findings = [];
  const hostFinding = hostnameFinding(parsed.hostname);
  if (hostFinding) findings.push(hostFinding);
  if (parsed.protocol === "http:") findings.push("unencrypted_http");
  if (parsed.port) findings.push("non_default_port");
  if (parsed.hash) findings.push("fragment_removed");

  const blocked = findings.some((finding) => !["unencrypted_http", "non_default_port", "fragment_removed"].includes(finding));
  parsed.hash = "";

  return {
    ok: true,
    verdict: blocked ? "block" : "review",
    normalized_url: blocked ? null : parsed.href,
    hostname: parsed.hostname,
    findings,
    checks: { dns_resolved: false, fetched: false, redirects_checked: false },
  };
}

export const SAFE_URL_PREFLIGHT_MAX_LENGTH = MAX_URL_LENGTH;
