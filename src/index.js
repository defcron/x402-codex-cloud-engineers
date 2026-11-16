const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_BODY_BYTES = 16_384;
const MAX_ACCEPT_LENGTH = 4_096;
const MAX_MEDIA_TYPE_LENGTH = 256;
const MAX_OFFERS = 32;
class BodyTooLargeError extends Error {}
async function readBodyBounded(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError("Request body exceeds 16384 bytes");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function splitOutsideQuotes(value, delimiter) {
  const parts = [];
  let start = 0, quoted = false, escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (escaped) escaped = false;
    else if (quoted && ch === "\\") escaped = true;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) { parts.push(value.slice(start, i).trim()); start = i + 1; }
  }
  if (quoted || escaped) throw new TypeError("Unclosed quoted parameter");
  parts.push(value.slice(start).trim());
  return parts;
}
function parseMediaType(input, { allowWildcard = false } = {}) {
  if (typeof input !== "string") throw new TypeError("Media types must be strings");
  if (input.length > MAX_MEDIA_TYPE_LENGTH || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(input)) {
    throw new TypeError("Media type is too long or contains control characters");
  }
  const [essence, ...rawParams] = splitOutsideQuotes(input, ";");
  const slash = essence.indexOf("/");
  if (slash < 1 || essence.indexOf("/", slash + 1) !== -1) throw new TypeError(`Invalid media type: ${input}`);
  const type = essence.slice(0, slash).trim().toLowerCase();
  const subtype = essence.slice(slash + 1).trim().toLowerCase();
  const validWildcard = (type === "*" && subtype === "*") ||
    (TOKEN.test(type) && subtype === "*");
  if (!(allowWildcard && validWildcard) &&
      (!TOKEN.test(type) || !TOKEN.test(subtype) || type === "*" || subtype === "*")) {
    throw new TypeError(`Invalid media type: ${input}`);
  }
  const params = new Map();
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (!raw || equals < 1) throw new TypeError(`Invalid media type parameter: ${input}`);
    const name = raw.slice(0, equals).trim().toLowerCase();
    let value = raw.slice(equals + 1).trim();
    if (!TOKEN.test(name) || !value) throw new TypeError(`Invalid media type parameter: ${input}`);
    if (value.startsWith('"')) {
      if (!value.endsWith('"') || value.length < 2) throw new TypeError(`Invalid quoted parameter: ${input}`);
      let unquoted = "";
      for (let i = 1; i < value.length - 1; i += 1) {
        if (value[i] === '"') throw new TypeError(`Invalid quoted parameter: ${input}`);
        if (value[i] === "\\") {
          i += 1;
          if (i >= value.length - 1) throw new TypeError(`Invalid quoted parameter: ${input}`);
        }
        unquoted += value[i];
      }
      value = unquoted;
    } else if (!TOKEN.test(value)) throw new TypeError(`Invalid media type parameter: ${input}`);
    if (params.has(name)) throw new TypeError(`Duplicate media type parameter: ${name}`);
    params.set(name, value);
  }
  return { type, subtype, params };
}
function parseAccept(value) {
  if (value == null || (typeof value === "string" && value.trim() === "")) value = "*/*";
  if (typeof value !== "string") throw new TypeError("Accept must be a string");
  if (value.length > MAX_ACCEPT_LENGTH || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)) {
    throw new TypeError("Accept is too long or contains control characters");
  }
  return splitOutsideQuotes(value, ",").map((entry, index) => {
    if (!entry) throw new TypeError("Accept contains an empty media range");
    const parsed = parseMediaType(entry, { allowWildcard: true });
    let quality = 1;
    const params = new Map();
    for (const [name, paramValue] of parsed.params) {
      if (name === "q") {
        if (!/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(paramValue)) {
          throw new TypeError("Accept q values must be between 0 and 1 with at most 3 decimals");
        }
        quality = Number(paramValue);
      } else params.set(name, paramValue);
    }
    return { ...parsed, params, quality, index };
  });
}
function rangeSpecificity(range, offered) {
  if (range.type !== "*" && range.type !== offered.type) return null;
  if (range.subtype !== "*" && range.subtype !== offered.subtype) return null;
  for (const [key, value] of range.params) {
    const offeredValue = offered.params.get(key);
    const equal = key === "charset"
      ? offeredValue?.toLowerCase() === value.toLowerCase()
      : offeredValue === value;
    if (!equal) return null;
  }
  return {
    type: range.type === "*" ? 0 : 1,
    subtype: range.subtype === "*" ? 0 : 1,
    parameters: range.params.size,
  };
}
function compareSpecificity(a, b) {
  return a.type - b.type || a.subtype - b.subtype || a.parameters - b.parameters;
}
export function auditNegotiation(accept, contentType) {
  const content = parseMediaType(contentType);
  if (accept == null) {
    return { content_type: contentType, acceptable: true, quality: 1, matched_range: null, reason: "accept_header_absent" };
  }
  const ranges = parseAccept(accept);
  const matches = ranges
    .map((range) => ({ range, specificity: rangeSpecificity(range, content) }))
    .filter(({ specificity }) => specificity !== null)
    .sort((a, b) => compareSpecificity(b.specificity, a.specificity) || a.range.index - b.range.index);
  const governing = matches[0];
  if (!governing) {
    return { content_type: contentType, acceptable: false, quality: 0, matched_range: null, reason: "no_matching_range" };
  }
  const { range, specificity } = governing;
  return {
    content_type: contentType,
    acceptable: range.quality > 0,
    quality: range.quality,
    matched_range: {
      type: range.type,
      subtype: range.subtype,
      parameters: Object.fromEntries(range.params),
      specificity,
    },
    reason: range.quality > 0 ? "acceptable" : "quality_zero",
  };
}
export function negotiate(accept, available) {
  if (!Array.isArray(available) || available.length === 0 || available.length > MAX_OFFERS) {
    throw new TypeError("available must contain 1 to 32 media types");
  }
  const ranges = parseAccept(accept);
  const offers = available.map((value, index) => ({ value, parsed: parseMediaType(value), index }));
  const candidates = [];
  for (const offer of offers) {
    const matches = ranges.map((range) => ({ range, specificity: rangeSpecificity(range, offer.parsed) }))
      .filter(({ specificity }) => specificity !== null)
      .sort((a, b) => compareSpecificity(b.specificity, a.specificity) || a.range.index - b.range.index);
    const governing = matches[0];
    if (governing && governing.range.quality > 0) candidates.push({
      mediaType: offer.value, quality: governing.range.quality,
      specificity: governing.specificity, acceptIndex: governing.range.index, offerIndex: offer.index,
    });
  }
  candidates.sort((a, b) => b.quality - a.quality || compareSpecificity(b.specificity, a.specificity) ||
    a.acceptIndex - b.acceptIndex || a.offerIndex - b.offerIndex);
  return { selected: candidates[0]?.mediaType ?? null,
    candidates: candidates.map(({ mediaType, quality }) => ({ mediaType, quality })) };
}
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") return Response.json({
      name: "http-media-type-negotiation-audit", endpoint: "POST /audit",
      input: { accept: "string (optional)", content_type: "media/type" },
    });
    if (url.pathname !== "/audit") return Response.json({ error: "Not found" }, { status: 404 });
    if (request.method !== "POST") return Response.json({ error: "Method not allowed" },
      { status: 405, headers: { Allow: "POST" } });
    try {
      const bytes = await readBodyBounded(request);
      const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Body must be a JSON object");
      return Response.json(auditNegotiation(input.accept, input.content_type));
    } catch (error) {
      return Response.json({ error: error.message }, { status: error instanceof BodyTooLargeError ? 413 : 400 });
    }
  },
};
