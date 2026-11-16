import { auditJsonNullMissingChanges } from './json-null-missing-audit.mjs';

const ROUTE = '/v1/json-null-missing-audit';
const MAX_BODY_BYTES = 256 * 1024;

/** Worker-compatible route adapter; central integration supplies x402 middleware. */
export async function handleJsonNullMissingAuditRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== ROUTE) return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') ?? '')) {
    return json({ error: 'unsupported_media_type' }, 415);
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json({ error: 'input_too_large' }, 413);

  let input;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return json({ error: 'input_too_large' }, 413);
    input = JSON.parse(text);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  try {
    return json(auditJsonNullMissingChanges(input), 200);
  } catch (error) {
    return json({ error: error.code ?? 'invalid_input', message: error.message }, error.status ?? 400);
  }
}

function json(value, status, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}
