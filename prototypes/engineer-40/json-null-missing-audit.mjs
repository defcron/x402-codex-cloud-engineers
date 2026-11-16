const MAX_INPUT_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RECORDS_PER_BATCH = 500;
const MAX_FIELDS = 100;
const MAX_POINTER_CHARS = 256;
const MAX_NODES = 20_000;
const MAX_DEPTH = 32;

export class JsonNullMissingAuditError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'JsonNullMissingAuditError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, status = 400) {
  throw new JsonNullMissingAuditError(code, message, status);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function checkKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('unknown_field', `${label} contains an unsupported field`);
  }
}

function addRawSize(state, text) {
  if (text.length > MAX_INPUT_BYTES || state.rawCharacters + text.length > MAX_INPUT_BYTES) {
    fail('input_too_large', `input exceeds the ${MAX_INPUT_BYTES}-byte bound`, 413);
  }
  state.rawCharacters += text.length;
}

function validateJson(value, state, depth = 0) {
  if (depth > MAX_DEPTH) fail('depth_exceeded', `JSON depth exceeds ${MAX_DEPTH}`, 413);
  state.nodes += 1;
  if (state.nodes > MAX_NODES) fail('node_limit_exceeded', `input exceeds ${MAX_NODES} JSON nodes`, 413);

  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    addRawSize(state, value);
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_json_value', 'records must contain only finite JSON numbers');
    return;
  }
  if (Array.isArray(value)) {
    if (state.ancestors.has(value)) fail('cyclic_input', 'records must not contain cyclic values');
    state.ancestors.add(value);
    for (const item of value) validateJson(item, state, depth + 1);
    state.ancestors.delete(value);
    return;
  }
  if (isRecord(value)) {
    if (state.ancestors.has(value)) fail('cyclic_input', 'records must not contain cyclic values');
    state.ancestors.add(value);
    for (const key of Object.keys(value)) {
      addRawSize(state, key);
      validateJson(value[key], state, depth + 1);
    }
    state.ancestors.delete(value);
    return;
  }
  fail('invalid_json_value', 'records must contain only JSON-compatible values');
}

function decodePointer(pointer) {
  if (typeof pointer !== 'string' || pointer.length === 0 || pointer.length > MAX_POINTER_CHARS || pointer[0] !== '/') {
    fail('invalid_pointer', `each field path must be a non-empty RFC 6901 pointer of at most ${MAX_POINTER_CHARS} characters`);
  }
  return pointer.slice(1).split('/').map((part) => {
    if (/~(?:[^01]|$)/.test(part)) fail('invalid_pointer', 'field path contains an invalid RFC 6901 escape');
    return part.replace(/~1/g, '/').replace(/~0/g, '~');
  });
}

function readPointer(record, tokens) {
  let current = record;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { state: 'missing' };
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return { state: 'missing' };
      current = current[index];
    } else if (isRecord(current)) {
      if (!Object.hasOwn(current, token)) return { state: 'missing' };
      current = current[token];
    } else {
      return { state: 'missing' };
    }
  }
  return { state: current === null ? 'null' : 'value' };
}

function summarize(records, tokens) {
  const counts = { missing_count: 0, null_count: 0, value_count: 0 };
  for (const record of records) counts[`${readPointer(record, tokens).state}_count`] += 1;
  const missingRate = Math.round((counts.missing_count * 10_000) / records.length);
  const nullRate = Math.round((counts.null_count * 10_000) / records.length);
  return {
    record_count: records.length,
    ...counts,
    missing_rate_bps: missingRate,
    null_rate_bps: nullRate,
    value_rate_bps: 10_000 - missingRate - nullRate,
  };
}

/**
 * Compare null/missing/value distributions for selected JSON Pointer paths
 * across two independent batches of JSON object records. Rows are not matched.
 */
export function auditJsonNullMissingChanges(input) {
  if (!isRecord(input)) fail('invalid_input', 'input must be an object');
  checkKeys(input, new Set(['before_records', 'after_records', 'fields']), 'input');
  const { before_records: beforeRecords, after_records: afterRecords, fields } = input;
  if (!Array.isArray(beforeRecords) || !Array.isArray(afterRecords) || beforeRecords.length === 0 || afterRecords.length === 0) {
    fail('invalid_records', 'before_records and after_records must each contain at least one object');
  }
  if (beforeRecords.length > MAX_RECORDS_PER_BATCH || afterRecords.length > MAX_RECORDS_PER_BATCH) {
    fail('record_limit_exceeded', `each batch is limited to ${MAX_RECORDS_PER_BATCH} records`, 413);
  }
  if (!Array.isArray(fields) || fields.length === 0) fail('invalid_fields', 'fields must contain at least one JSON Pointer');
  if (fields.length > MAX_FIELDS) fail('field_limit_exceeded', `fields are limited to ${MAX_FIELDS} pointers`, 413);
  const decoded = [];
  const seenFields = new Set();
  for (const path of fields) {
    const tokens = decodePointer(path);
    if (seenFields.has(path)) fail('duplicate_pointer', 'fields must not contain duplicate pointers');
    seenFields.add(path);
    decoded.push(tokens);
  }

  const state = { nodes: 0, rawCharacters: 0, ancestors: new WeakSet() };
  for (const records of [beforeRecords, afterRecords]) {
    for (const record of records) {
      if (!isRecord(record)) fail('invalid_record', 'every batch item must be a JSON object');
      validateJson(record, state);
    }
  }
  let serialized;
  try { serialized = JSON.stringify(input); } catch { fail('invalid_json_value', 'input must be JSON-serializable'); }
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length > MAX_INPUT_BYTES) {
    fail('input_too_large', `serialized input exceeds ${MAX_INPUT_BYTES} bytes`, 413);
  }

  const results = fields.map((path, index) => {
    const before = summarize(beforeRecords, decoded[index]);
    const after = summarize(afterRecords, decoded[index]);
    const delta = {
      missing_count: after.missing_count - before.missing_count,
      null_count: after.null_count - before.null_count,
      value_count: after.value_count - before.value_count,
      missing_rate_bps: after.missing_rate_bps - before.missing_rate_bps,
      null_rate_bps: after.null_rate_bps - before.null_rate_bps,
      value_rate_bps: after.value_rate_bps - before.value_rate_bps,
    };
    const changed = delta.missing_rate_bps !== 0 || delta.null_rate_bps !== 0 || delta.value_rate_bps !== 0;
    return { path, before, after, delta, changed };
  });

  const result = {
    summary: {
      before_record_count: beforeRecords.length,
      after_record_count: afterRecords.length,
      fields_checked: fields.length,
      changed_fields: results.filter((field) => field.changed).length,
      record_json_nodes: state.nodes,
    },
    fields: results,
    note: 'Batches are summarized independently; rows are not matched. Missing means the pointer is absent or cannot be traversed. Values and record contents are not returned.',
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > MAX_OUTPUT_BYTES) {
    fail('output_too_large', `result exceeds ${MAX_OUTPUT_BYTES} bytes`, 413);
  }
  return result;
}
