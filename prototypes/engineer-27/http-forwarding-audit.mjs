const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MAX_BODY_BYTES = 65_536;
const MAX_HOPS = 8;
const MAX_HEADERS_PER_MAP = 64;
const MAX_VALUES_PER_HEADER = 8;
const MAX_HEADER_VALUE_LENGTH = 2_048;
const MAX_FINDINGS = 256;

class InputError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireExactKeys(value, allowed, label) {
  if (!isRecord(value)) throw new InputError(`${label} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new InputError(`${label} contains unsupported field: ${key}`);
  }
}

function normalizeHeaderName(name, label) {
  if (typeof name !== "string" || name.length > 128 || !HEADER_NAME.test(name)) {
    throw new InputError(`${label} must be a valid HTTP field name of at most 128 characters`);
  }
  return name.toLowerCase();
}

function normalizeHeaderList(value, label, optional = true) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > MAX_HEADERS_PER_MAP) {
    throw new InputError(`${label} must be an array with at most ${MAX_HEADERS_PER_MAP} names`);
  }
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const name = normalizeHeaderName(item, label);
    if (seen.has(name)) throw new InputError(`${label} contains a duplicate name (case-insensitive)`);
    seen.add(name);
    result.push(name);
  }
  return result;
}

function normalizeHeaderMap(value, label) {
  if (!isRecord(value)) throw new InputError(`${label} must be an object mapping names to value arrays`);
  const entries = Object.entries(value);
  if (entries.length > MAX_HEADERS_PER_MAP) {
    throw new InputError(`${label} may contain at most ${MAX_HEADERS_PER_MAP} names`);
  }
  const result = new Map();
  for (const [rawName, values] of entries) {
    const name = normalizeHeaderName(rawName, label);
    if (result.has(name)) throw new InputError(`${label} contains a duplicate name (case-insensitive)`);
    if (!Array.isArray(values) || values.length < 1 || values.length > MAX_VALUES_PER_HEADER) {
      throw new InputError(`${label}.${rawName} must contain 1 to ${MAX_VALUES_PER_HEADER} values`);
    }
    for (const item of values) {
      if (typeof item !== "string" || item.length > MAX_HEADER_VALUE_LENGTH) {
        throw new InputError(`${label}.${rawName} values must be strings up to ${MAX_HEADER_VALUE_LENGTH} characters`);
      }
      for (let i = 0; i < item.length; i += 1) {
        const code = item.charCodeAt(i);
        if ((code < 0x20 && code !== 0x09) || code === 0x7f) {
          throw new InputError(`${label}.${rawName} contains a prohibited control character`);
        }
      }
    }
    result.set(name, values);
  }
  return result;
}

function normalizePolicy(value) {
  requireExactKeys(value, new Set(["allowed_headers", "required_headers", "never_forward", "trusted_proxy_headers"]), "policy");
  const allowed = normalizeHeaderList(value.allowed_headers, "policy.allowed_headers", false);
  const required = normalizeHeaderList(value.required_headers, "policy.required_headers");
  const neverForward = normalizeHeaderList(value.never_forward, "policy.never_forward");
  const trustedProxy = normalizeHeaderList(value.trusted_proxy_headers, "policy.trusted_proxy_headers");
  const allowedSet = new Set(allowed);
  for (const name of required) {
    if (!allowedSet.has(name)) throw new InputError(`required header ${name} must also be allowed`);
  }
  for (const name of neverForward) {
    if (allowedSet.has(name)) throw new InputError(`never_forward header ${name} cannot also be allowed`);
  }
  return { allowedSet, required, neverForwardSet: new Set(neverForward), trustedProxySet: new Set(trustedProxy) };
}

function normalizeHops(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOPS) {
    throw new InputError(`hops must contain 1 to ${MAX_HOPS} proxy observations`);
  }
  return value.map((hop, index) => {
    requireExactKeys(hop, new Set(["name", "received", "forwarded"]), `hops[${index}]`);
    if (typeof hop.name !== "string" || hop.name.trim().length < 1 || hop.name.length > 80) {
      throw new InputError(`hops[${index}].name must be 1 to 80 characters`);
    }
    return {
      name: hop.name.trim(),
      received: normalizeHeaderMap(hop.received, `hops[${index}].received`),
      forwarded: normalizeHeaderMap(hop.forwarded, `hops[${index}].forwarded`),
    };
  });
}

/** Audit caller-supplied header observations against an explicit proxy policy. */
export function auditForwardingPolicy(input) {
  requireExactKeys(input, new Set(["policy", "hops"]), "request");
  const policy = normalizePolicy(input.policy);
  const hops = normalizeHops(input.hops);
  const findings = [];
  let findingCount = 0;
  const addFinding = (finding) => {
    findingCount += 1;
    if (findings.length < MAX_FINDINGS) findings.push(finding);
  };

  for (const hop of hops) {
    for (const name of hop.forwarded.keys()) {
      if (!policy.allowedSet.has(name)) {
        addFinding({ code: "forward_not_allowlisted", severity: "high", hop: hop.name, header: name });
      }
      if (policy.neverForwardSet.has(name)) {
        addFinding({ code: "never_forward_header_forwarded", severity: "high", hop: hop.name, header: name });
      }
    }
    for (const name of policy.required) {
      if (!hop.forwarded.has(name)) {
        addFinding({ code: "required_header_missing", severity: "medium", hop: hop.name, header: name });
      }
    }
  }

  const firstHop = hops[0];
  for (const name of policy.trustedProxySet) {
    const clientValues = firstHop.received.get(name);
    const forwardedValues = firstHop.forwarded.get(name);
    if (clientValues && forwardedValues && clientValues.some((value) => forwardedValues.includes(value))) {
      addFinding({ code: "client_asserted_proxy_header_forwarded", severity: "high", hop: firstHop.name, header: name });
    }
  }

  const checkedHeaders = hops.reduce((sum, hop) => sum + hop.forwarded.size, 0);
  return {
    ok: findingCount === 0,
    hop_count: hops.length,
    checked_forwarded_header_count: checkedHeaders,
    finding_count: findingCount,
    findings_truncated: findingCount > findings.length,
    findings,
    note: "Findings are based only on supplied observations and policy; header values are not returned and no live proxy is contacted.",
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function readBodyBounded(stream) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Minimal local Worker adapter; production payment middleware is not included. */
export async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/http-forwarding-audit") return jsonResponse({ error: "not_found" }, 404);
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405, { allow: "POST" });
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get("content-type") || "")) {
    return jsonResponse({ error: "content_type_must_be_application_json" }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: "request_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  }
  let body;
  try {
    body = await readBodyBounded(request.body);
  } catch {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  if (body === null) return jsonResponse({ error: "request_too_large", max_bytes: MAX_BODY_BYTES }, 413);
  let input;
  try {
    input = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  try {
    return jsonResponse(auditForwardingPolicy(input));
  } catch (error) {
    if (error instanceof InputError) return jsonResponse({ error: "invalid_input", message: error.message }, 400);
    return jsonResponse({ error: "internal_error" }, 500);
  }
}

export const limits = Object.freeze({
  maxBodyBytes: MAX_BODY_BYTES,
  maxHops: MAX_HOPS,
  maxHeaderNamesPerMap: MAX_HEADERS_PER_MAP,
  maxValuesPerHeader: MAX_VALUES_PER_HEADER,
  maxHeaderValueLength: MAX_HEADER_VALUE_LENGTH,
  maxFindings: MAX_FINDINGS,
});

export default { fetch: handleRequest };
