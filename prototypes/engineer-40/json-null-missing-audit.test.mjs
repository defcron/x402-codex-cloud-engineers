import test from 'node:test';
import assert from 'node:assert/strict';
import { auditJsonNullMissingChanges, JsonNullMissingAuditError } from './json-null-missing-audit.mjs';

const audit = (before_records, after_records, fields = ['/email']) =>
  auditJsonNullMissingChanges({ before_records, after_records, fields });
const failCode = (fn, code) => assert.throws(fn, (error) => error instanceof JsonNullMissingAuditError && error.code === code);

test('aggregates missing, null, and value states across two batches', () => {
  const result = audit(
    [{ email: null }, { email: 'a@example.test' }, {}],
    [{ email: null }, { email: null }, { email: 'b@example.test' }],
  );
  assert.deepEqual(result.fields[0].before, {
    record_count: 3, missing_count: 1, null_count: 1, value_count: 1,
    missing_rate_bps: 3333, null_rate_bps: 3333, value_rate_bps: 3334,
  });
  assert.deepEqual(result.fields[0].after, {
    record_count: 3, missing_count: 0, null_count: 2, value_count: 1,
    missing_rate_bps: 0, null_rate_bps: 6667, value_rate_bps: 3333,
  });
  assert.deepEqual(result.fields[0].delta, {
    missing_count: -1, null_count: 1, value_count: 0,
    missing_rate_bps: -3333, null_rate_bps: 3334, value_rate_bps: -1,
  });
  assert.equal(result.fields[0].changed, true);
  assert.equal(result.summary.changed_fields, 1);
});

test('reports selected nested object paths and array indexes', () => {
  const result = audit(
    [{ profile: { email: null }, tags: ['a'] }, { profile: {}, tags: [] }],
    [{ profile: { email: 'x' }, tags: [null] }, { profile: null, tags: ['b'] }],
    ['/profile/email', '/tags/0'],
  );
  assert.deepEqual(result.fields.map((field) => [field.before.missing_count, field.before.null_count, field.after.missing_count, field.after.null_count]), [
    [1, 1, 1, 0],
    [1, 0, 0, 1],
  ]);
});

test('supports RFC 6901 escaping and empty object-property names', () => {
  const result = audit(
    [{ 'a/b': { '~key': null }, '': 'present' }],
    [{ 'a/b': { '~key': 'secret' } }],
    ['/a~1b/~0key', '/'],
  );
  assert.equal(result.fields[0].before.null_count, 1);
  assert.equal(result.fields[0].after.value_count, 1);
  assert.equal(result.fields[1].before.value_count, 1);
  assert.equal(result.fields[1].after.missing_count, 1);
});

test('treats an absent parent or non-object parent as an unresolved field path', () => {
  const result = audit([{}, { profile: null }, { profile: 2 }], [{ profile: { name: null } }], ['/profile/name']);
  assert.equal(result.fields[0].before.missing_count, 3);
  assert.equal(result.fields[0].after.null_count, 1);
});

test('does not match rows and never echoes record values', () => {
  const result = audit([{ email: 'secret-before@example.test' }], [{ email: 'secret-after@example.test' }]);
  assert.match(result.note, /rows are not matched/);
  assert.equal(JSON.stringify(result).includes('secret-before'), false);
  assert.equal(JSON.stringify(result).includes('secret-after'), false);
});

test('marks unchanged field distributions', () => {
  const rows = [{ x: null }, { x: 1 }, {}];
  const result = audit(rows, rows.map((row) => ({ ...row })), ['/x']);
  assert.equal(result.fields[0].changed, false);
  assert.equal(result.summary.changed_fields, 0);
});

test('rejects empty batches and non-object rows', () => {
  failCode(() => audit([], [{}]), 'invalid_records');
  failCode(() => audit([null], [{}]), 'invalid_record');
  failCode(() => audit([[]], [{}]), 'invalid_record');
});

test('rejects empty, invalid, duplicate, and overlong pointers', () => {
  failCode(() => audit([{}], [{}], ['']), 'invalid_pointer');
  failCode(() => audit([{}], [{}], ['email']), 'invalid_pointer');
  failCode(() => audit([{}], [{}], ['/a~2b']), 'invalid_pointer');
  failCode(() => audit([{}], [{}], ['/x', '/x']), 'duplicate_pointer');
  failCode(() => audit([{}], [{}], [`/${'x'.repeat(256)}`]), 'invalid_pointer');
  const sparse = [];
  sparse.length = 1;
  failCode(() => audit([{}], [{}], sparse), 'invalid_pointer');
});

test('rejects arrays as top-level batches but supports valid array indexes', () => {
  const result = audit([{ values: [null] }, { values: [] }], [{ values: ['v'] }], ['/values/0']);
  assert.equal(result.fields[0].before.null_count, 1);
  assert.equal(result.fields[0].before.missing_count, 1);
  const nonCanonicalIndex = audit([{ values: [null] }], [{}], ['/values/01']);
  assert.equal(nonCanonicalIndex.fields[0].before.missing_count, 1);
});

test('enforces batch, field, and JSON-node limits', () => {
  failCode(() => audit(Array.from({ length: 501 }, () => ({})), [{}]), 'record_limit_exceeded');
  failCode(() => audit([{}], [{}], Array.from({ length: 101 }, (_, i) => `/f${i}`)), 'field_limit_exceeded');
  const manyKeys = Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`k${i}`, null]));
  failCode(() => audit([manyKeys], [{}]), 'node_limit_exceeded');
});

test('enforces depth and serialized byte limits', () => {
  let atLimit = null;
  for (let i = 0; i < 32; i += 1) atLimit = { x: atLimit };
  assert.equal(audit([atLimit], [atLimit]).summary.changed_fields, 0);
  let deep = null;
  for (let i = 0; i < 33; i += 1) deep = { x: deep };
  failCode(() => audit([deep], [{}]), 'depth_exceeded');
  failCode(() => audit([{ x: 'z'.repeat(262_145) }], [{}]), 'input_too_large');
});

test('rejects non-JSON values and cycles', () => {
  failCode(() => audit([{ x: undefined }], [{}]), 'invalid_json_value');
  const cyclic = {};
  cyclic.self = cyclic;
  failCode(() => audit([cyclic], [{}]), 'cyclic_input');
});

test('accepts the configured maximum record and pointer counts', () => {
  const rows = Array.from({ length: 500 }, () => ({}));
  const fields = Array.from({ length: 100 }, (_, i) => `/f${i}`);
  const result = audit(rows, rows.map((row) => ({ ...row })), fields);
  assert.equal(result.summary.before_record_count, 500);
  assert.equal(result.summary.fields_checked, 100);
  assert.equal(result.fields.length, 100);
});
