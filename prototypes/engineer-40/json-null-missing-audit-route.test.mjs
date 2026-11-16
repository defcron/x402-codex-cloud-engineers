import test from 'node:test';
import assert from 'node:assert/strict';
import { handleJsonNullMissingAuditRequest } from './json-null-missing-audit-route.mjs';

const body = JSON.stringify({
  before_records: [{ email: null }, {}],
  after_records: [{ email: null }, { email: 'a@example.test' }],
  fields: ['/email'],
});
const request = (path, method = 'POST', payload = body, headers = { 'content-type': 'application/json' }) =>
  new Request(`https://worker.test${path}`, { method, headers, body: method === 'GET' || method === 'HEAD' ? undefined : payload });

test('serves cohort state counts on the documented route', async () => {
  const response = await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.fields[0].before.null_count, 1);
  assert.equal(result.fields[0].before.missing_count, 1);
  assert.equal(result.fields[0].after.value_count, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('does not claim other routes', async () => {
  assert.equal((await handleJsonNullMissingAuditRequest(request('/elsewhere'))).status, 404);
});

test('rejects wrong method, media type, and malformed JSON', async () => {
  assert.equal((await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit', 'GET'))).status, 405);
  assert.equal((await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit', 'POST', body, { 'content-type': 'text/plain' }))).status, 415);
  const bad = await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit', 'POST', '{'));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_json');
});

test('enforces byte limit and preserves audit validation status/code', async () => {
  const oversized = await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit', 'POST', ' '.repeat(262_145)));
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).error, 'input_too_large');
  const invalid = await handleJsonNullMissingAuditRequest(request('/v1/json-null-missing-audit', 'POST', '{}'));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, 'invalid_records');
});
