const MAX_SNAPSHOTS = 20;
const MAX_KEYS_PER_SNAPSHOT = 100;
const MAX_CACHE_CONTROL_LENGTH = 1024;
const MAX_INPUT_CHARS = 262_144;
const MAX_AGE_SECONDS = 31_536_000;
const MAX_POLICY_SECONDS = 604_800;

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function timestamp(value, name) {
  const match = typeof value === "string" && value.length <= 40
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value)
    : null;
  if (!match) {
    throw new TypeError(`${name} must be an ISO timestamp`);
  }
  const [, year, month, day, hour, minute, second, zone] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const daysInMonth = [31, (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth[m - 1] || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) {
    throw new TypeError(`${name} must be a valid ISO timestamp`);
  }
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) {
    throw new TypeError(`${name} must have a valid ISO time-zone offset`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${name} must be a valid ISO timestamp`);
  return ms;
}

function splitDirectives(value, snapshotIndex, findings) {
  const parts = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  if (quoted || escaped) {
    findings.push({code: "invalid_cache_quote", severity: "error", snapshot_index: snapshotIndex, message: "Cache-Control contains an unterminated quoted value."});
  }
  parts.push(value.slice(start));
  return parts;
}

function equalsOutsideQuotes(value) {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (ch === "=" && !quoted) return i;
  }
  return -1;
}

function parseCacheControl(value, snapshotIndex, findings) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CACHE_CONTROL_LENGTH) {
    throw new TypeError(`snapshots[${snapshotIndex}].cache_control must be a non-empty string up to ${MAX_CACHE_CONTROL_LENGTH} characters`);
  }

  const directives = new Map();
  for (const rawPart of splitDirectives(value, snapshotIndex, findings)) {
    const part = rawPart.trim();
    if (!part) continue;
    const equals = equalsOutsideQuotes(part);
    const name = (equals < 0 ? part : part.slice(0, equals)).trim().toLowerCase();
    const raw = equals < 0 ? null : part.slice(equals + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name)) {
      findings.push({code: "invalid_cache_directive", severity: "error", snapshot_index: snapshotIndex, message: "Cache-Control contains an invalid directive name."});
      continue;
    }
    if (directives.has(name)) {
      findings.push({code: "duplicate_cache_directive", severity: "error", snapshot_index: snapshotIndex, message: `Cache-Control repeats ${name}.`});
      continue;
    }
    directives.set(name, raw?.replace(/^"(.*)"$/, "$1") ?? null);
  }

  const numeric = new Map();
  for (const name of ["max-age", "s-maxage", "stale-while-revalidate", "stale-if-error"]) {
    if (!directives.has(name)) continue;
    const raw = directives.get(name);
    if (raw === null || !/^\d{1,8}$/.test(raw)) {
      findings.push({code: "invalid_cache_age", severity: "error", snapshot_index: snapshotIndex, message: `Cache-Control ${name} must be a non-negative integer.`});
      continue;
    }
    const seconds = Number(raw);
    if (seconds > MAX_AGE_SECONDS) {
      findings.push({code: "cache_age_out_of_range", severity: "error", snapshot_index: snapshotIndex, message: `Cache-Control ${name} exceeds the supported bound.`});
      continue;
    }
    numeric.set(name, seconds);
  }
  return {directives, numeric};
}

function readSnapshot(snapshot, index, findings) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new TypeError(`snapshots[${index}] must be an object`);
  }
  const observedAt = timestamp(snapshot.observed_at, `snapshots[${index}].observed_at`);
  const age = integer(snapshot.age_seconds, `snapshots[${index}].age_seconds`, 0, MAX_AGE_SECONDS);
  if (!snapshot.jwks || typeof snapshot.jwks !== "object" || Array.isArray(snapshot.jwks) || !Array.isArray(snapshot.jwks.keys)) {
    throw new TypeError(`snapshots[${index}].jwks.keys must be an array`);
  }
  if (snapshot.jwks.keys.length > MAX_KEYS_PER_SNAPSHOT) {
    throw new TypeError(`snapshots[${index}].jwks.keys may contain at most ${MAX_KEYS_PER_SNAPSHOT} keys`);
  }

  const kids = [];
  for (const [keyIndex, key] of snapshot.jwks.keys.entries()) {
    if (!key || typeof key !== "object" || Array.isArray(key) || typeof key.kid !== "string" || key.kid.length === 0 || key.kid.length > 256) {
      throw new TypeError(`snapshots[${index}].jwks.keys[${keyIndex}].kid must be a non-empty string up to 256 characters`);
    }
    if (kids.includes(key.kid)) throw new TypeError(`snapshots[${index}].jwks.keys contains duplicate kid values`);
    kids.push(key.kid);
  }

  const cache = parseCacheControl(snapshot.cache_control, index, findings);
  const cacheAge = cache.numeric.has("s-maxage") ? cache.numeric.get("s-maxage") : cache.numeric.get("max-age");
  if (cache.directives.has("no-store")) {
    findings.push({code: "no_store", severity: "error", snapshot_index: index, message: "Cache-Control no-store prevents the configured reusable JWKS cache policy."});
  }
  if (cacheAge === undefined) {
    findings.push({code: "missing_max_age", severity: "error", snapshot_index: index, message: "Cache-Control must provide max-age or s-maxage."});
  }

  return {observedAt, age, kids: new Set(kids), cacheAge, staleWhileRevalidate: cache.numeric.get("stale-while-revalidate") ?? 0, staleIfError: cache.numeric.get("stale-if-error") ?? 0};
}

function addRunLength(a, b, snapshots) {
  let best = 0;
  let runStart = -1;
  let runEnd = -1;
  for (let i = 0; i < snapshots.length; i++) {
    if (snapshots[i].kids.has(a) && snapshots[i].kids.has(b)) {
      if (runStart < 0) runStart = i;
      runEnd = i;
    } else if (runStart >= 0) {
      best = Math.max(best, (snapshots[runEnd].observedAt - snapshots[runStart].observedAt) / 1000);
      runStart = -1;
    }
  }
  if (runStart >= 0) best = Math.max(best, (snapshots[runEnd].observedAt - snapshots[runStart].observedAt) / 1000);
  return best;
}

/**
 * Validate supplied JWKS/cache observations against explicit caller policy.
 * This is a deterministic offline diagnostic: it never fetches URLs, verifies
 * JWTs or keys, or claims that sampled overlap proves continuous availability.
 */
export function validateJwksCachePolicy(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("input must be an object");
  let serialized;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new TypeError("input must be JSON-serializable");
  }
  if (serialized.length > MAX_INPUT_CHARS) throw new TypeError(`input must be at most ${MAX_INPUT_CHARS} characters`);
  const {policy, snapshots} = input;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new TypeError("policy must be an object");
  const maxAge = integer(policy.max_age_seconds, "policy.max_age_seconds", 0, MAX_AGE_SECONDS);
  const maxStale = integer(policy.max_stale_seconds, "policy.max_stale_seconds", 0, MAX_POLICY_SECONDS);
  const tokenLifetime = integer(policy.maximum_token_lifetime_seconds, "policy.maximum_token_lifetime_seconds", 0, MAX_POLICY_SECONDS);
  const safetyMargin = integer(policy.safety_margin_seconds, "policy.safety_margin_seconds", 0, MAX_POLICY_SECONDS);
  const requiredOverlap = maxAge + maxStale + tokenLifetime + safetyMargin;
  if (!Array.isArray(snapshots) || snapshots.length < 2 || snapshots.length > MAX_SNAPSHOTS) {
    throw new TypeError(`snapshots must contain 2 to ${MAX_SNAPSHOTS} observations`);
  }

  const findings = [];
  const parsed = snapshots.map((s, i) => readSnapshot(s, i, findings));
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].observedAt <= parsed[i - 1].observedAt) {
      throw new TypeError("snapshots must be ordered by strictly increasing observed_at timestamps");
    }
  }

  const cacheReport = parsed.map((s, index) => {
    if (s.cacheAge !== undefined && s.cacheAge > maxAge) {
      findings.push({code: "max_age_exceeded", severity: "error", snapshot_index: index, message: `Advertised cache lifetime ${s.cacheAge}s exceeds policy maximum ${maxAge}s.`});
    }
    if (s.cacheAge !== undefined && s.age > s.cacheAge) {
      findings.push({code: "stale_snapshot", severity: "warning", snapshot_index: index, message: "Age exceeds the effective max-age; this observation may be stale."});
    }
    if (s.staleWhileRevalidate > maxStale || s.staleIfError > maxStale) {
      findings.push({code: "stale_window_exceeded", severity: "error", snapshot_index: index, message: `A stale serving window exceeds policy maximum ${maxStale}s.`});
    }
    return {
      observed_at: snapshots[index].observed_at,
      advertised_max_age_seconds: s.cacheAge ?? null,
      age_seconds: s.age,
      remaining_freshness_seconds: s.cacheAge === undefined ? null : Math.max(0, s.cacheAge - s.age),
      stale_while_revalidate_seconds: s.staleWhileRevalidate,
      stale_if_error_seconds: s.staleIfError
    };
  });

  const first = parsed[0].kids;
  const last = parsed.at(-1).kids;
  const oldKids = [...first].filter(kid => !last.has(kid));
  const newKids = [...last].filter(kid => !first.has(kid));
  const rotations = [];
  if (oldKids.length > 0 && newKids.length === 0) {
    findings.push({code: "removed_keys_without_replacement", severity: "error", message: "One or more previously published keys were removed without any replacement key in the final snapshot."});
  }
  for (const oldKid of oldKids) {
    for (const newKid of newKids) {
      const observed = addRunLength(oldKid, newKid, parsed);
      const passes = observed >= requiredOverlap;
      rotations.push({old_kid: oldKid, new_kid: newKid, sampled_overlap_seconds: observed, required_sampled_overlap_seconds: requiredOverlap, passes});
      if (!passes) findings.push({code: "insufficient_sampled_overlap", severity: "error", message: `An old/new key pair was co-present in snapshots for ${observed}s; derived policy requires ${requiredOverlap}s of sampled overlap.`});
    }
  }
  const errors = findings.filter(f => f.severity === "error").length;
  const warnings = findings.filter(f => f.severity === "warning").length;
  return {
    ok: errors === 0,
    summary: {snapshots_analyzed: snapshots.length, old_keys_removed: oldKids.length, new_keys_added: newKids.length, errors, warnings},
    rotation_policy: {max_age_seconds: maxAge, max_stale_seconds: maxStale, maximum_token_lifetime_seconds: tokenLifetime, safety_margin_seconds: safetyMargin, required_sampled_overlap_seconds: requiredOverlap},
    cache_policy: cacheReport,
    rotations,
    findings,
    note: "Offline snapshot diagnostic only. It does not fetch endpoints, verify JWT signatures or JWK material, or prove continuous key availability between samples."
  };
}
