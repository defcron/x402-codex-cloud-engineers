import test from 'node:test';
import assert from 'node:assert/strict';
import { compareOpenApi, OpenApiDiffError, OPENAPI_DIFF_MAX_TOTAL_CHARS, validateOpenApiDiffInput } from './openapi-diff.ts';
const doc = paths => JSON.stringify({ openapi: '3.1.0', info: { title: 'Orders', version: '1' }, paths });

test('detects removed operation and added required parameter', () => {
  const before = doc({ '/old': { get: { responses: { 200: { description: 'ok' } } } }, '/orders': { get: { responses: { 200: { description: 'ok' } } } } });
  const after = doc({ '/orders': { get: { parameters: [{ name: 'tenant', in: 'query', required: true }], responses: { 200: { description: 'ok' } } } } });
  const result = compareOpenApi(before, after);
  assert.equal(result.breaking_change_count, 2);
  assert.deepEqual(new Set(result.changes.map(c => c.category)), new Set(['operation_removed', 'parameter_required']));
});

test('checks request and response schema directions', () => {
  const before = doc({ '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: ['string', 'null'] } } } }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } } } } });
  const after = doc({ '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: 'string' } } } }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: ['string', 'null'] } } } } } } } });
  const result = compareOpenApi(before, after);
  assert.ok(result.changes.some(c => c.category === 'schema_type' && c.direction === 'backward'));
  assert.ok(result.changes.some(c => c.category === 'schema_type' && c.direction === 'backward' && c.path.includes('/responses/')));
});

test('identical documents report no changes', () => {
  const source = doc({ '/health': { get: { responses: { 200: { description: 'ok' } } } } });
  assert.equal(compareOpenApi(source, source).assessment, 'no_breaking_changes_detected');
});

test('malformed, empty, and OpenAPI 2 documents are rejected', () => {
  assert.throws(() => compareOpenApi('{', '{}'), OpenApiDiffError);
  assert.throws(() => compareOpenApi('', doc({})), OpenApiDiffError);
  assert.throws(() => compareOpenApi(doc({}), JSON.stringify({ openapi: '2.0', info: {}, paths: {} })), OpenApiDiffError);
});

test('document, combined-size, and path limits are enforced', () => {
  assert.throws(() => compareOpenApi(' '.repeat(262_145), doc({})), e => e instanceof OpenApiDiffError && e.status === 413);
  const valid = doc({});
  const exactDocumentLimit = valid + ' '.repeat(262_144 - valid.length);
  assert.equal(compareOpenApi(exactDocumentLimit, exactDocumentLimit).assessment, 'no_breaking_changes_detected');
  assert.throws(() => compareOpenApi(' '.repeat(OPENAPI_DIFF_MAX_TOTAL_CHARS), '{}'), e => e instanceof OpenApiDiffError && e.status === 413);
  const many = {}; for (let i = 0; i < 1_001; i++) many[`/${i}`] = {};
  assert.throws(() => compareOpenApi(doc(many), doc({})), e => e instanceof OpenApiDiffError && e.status === 413);
});

test('changed unsupported schema keywords stay inconclusive, not breaking', () => {
  const before = doc({ '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: 'string', pattern: 'a+' } } } }, responses: { 200: { description: 'ok' } } } } });
  const after = doc({ '/x': { post: { requestBody: { content: { 'application/json': { schema: { type: 'string', pattern: 'b+' } } } }, responses: { 200: { description: 'ok' } } } } });
  const result = compareOpenApi(before, after);
  assert.equal(result.assessment, 'inconclusive');
  assert.equal(result.breaking_change_count, 0);
  assert.ok(result.inconclusive_change_count > 0);
});

test('request validator rejects extra keys and overlong documents', () => {
  assert.throws(() => validateOpenApiDiffInput({ before_openapi_json: '{}', after_openapi_json: '{}', extra: true }), OpenApiDiffError);
  assert.throws(() => validateOpenApiDiffInput({ before_openapi_json: ' '.repeat(262_145), after_openapi_json: '{}' }), e => e instanceof OpenApiDiffError && e.status === 413);
  assert.deepEqual(validateOpenApiDiffInput({ before_openapi_json: '{}', after_openapi_json: '{}' }), { before_openapi_json: '{}', after_openapi_json: '{}' });
});

test('compares inherited path parameters', () => {
  const before = doc({ '/items': { parameters: [{ name: 'tenant', in: 'query' }], get: { responses: { 200: { description: 'ok' } } } } });
  const after = doc({ '/items': { get: { responses: { 200: { description: 'ok' } } } } });
  assert.ok(compareOpenApi(before, after).changes.some(c => c.category === 'parameter_removed'));
});

test('reports forward breaks when a request media type or body requirement changes', () => {
  const before = doc({ '/upload': { post: { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } }, responses: { 204: { description: 'done' } } } } });
  const after = doc({ '/upload': { post: { requestBody: { content: { 'application/xml': { schema: { type: 'object' } } } }, responses: { 204: { description: 'done' } } } } });
  const result = compareOpenApi(before, after);
  assert.ok(result.changes.some(c => c.direction === 'forward' && c.category === 'request_required'));
  assert.ok(result.changes.some(c => c.direction === 'backward' && c.category === 'request_media_type_removed'));
  assert.ok(result.changes.some(c => c.direction === 'forward' && c.category === 'request_media_type_added'));
});

test('reports response status/media and operationId changes', () => {
  const before = doc({
    '/orders': {
      get: {
        operationId: 'listOrders',
        responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'string' } } } } },
      },
    },
  });
  const after = doc({
    '/orders': {
      get: {
        operationId: 'getOrders',
        responses: { 202: { description: 'accepted', content: { 'application/xml': { schema: { type: 'string' } } } } },
      },
    },
  });
  const result = compareOpenApi(before, after);
  assert.ok(result.changes.some(c => c.direction === 'backward' && c.category === 'operation_id_changed'));
  assert.ok(result.changes.some(c => c.direction === 'backward' && c.category === 'response_removed'));
  assert.ok(result.changes.some(c => c.direction === 'forward' && c.category === 'response_added'));
});

test('reports enum narrowing and required response property removal', () => {
  const before = doc({
    '/x': {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { type: 'string', enum: ['a', 'b'] } } },
        },
        responses: {
          200: {
            description: 'ok',
            content: {
              'application/json': {
                schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  });
  const after = doc({
    '/x': {
      post: {
        requestBody: {
          content: { 'application/json': { schema: { type: 'string', enum: ['a'] } } },
        },
        responses: {
          200: { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: {} } } } },
        },
      },
    },
  });
  const result = compareOpenApi(before, after);
  assert.ok(result.changes.some(c => c.category === 'schema_enum' && c.direction === 'backward'));
  assert.ok(result.changes.some(c => c.category === 'response_property_removed'));
});

test('caps output while preserving full change count', () => {
  const many = {};
  for (let i = 0; i < 100; i++) many[`/r${i}`] = Object.fromEntries(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'].map(method => [method, { responses: { 200: { description: 'ok' } } }]));
  const result = compareOpenApi(doc(many), doc({}));
  assert.equal(result.breaking_change_count, 800);
  assert.equal(result.changes.length, 200);
  assert.equal(result.truncated, true);
});

test('reports forward break when a previously required parameter is removed', () => {
  const before = doc({ '/x': { get: { parameters: [{ name: 'tenant', in: 'query', required: true }], responses: { 200: { description: 'ok' } } } } });
  const after = doc({ '/x': { get: { responses: { 200: { description: 'ok' } } } } });
  assert.ok(compareOpenApi(before, after).changes.some(c => c.direction === 'forward' && c.category === 'parameter_required'));
});

test('reports added and removed request bodies in opposite directions', () => {
  const before = doc({
    '/x': { post: { responses: { 200: { description: 'ok' } } } },
  });
  const after = doc({
    '/x': {
      post: {
        requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'ok' } },
      },
    },
  });
  const forward = compareOpenApi(before, after);
  assert.ok(forward.changes.some(c => c.direction === 'forward' && c.category === 'request_body_added'));
  assert.ok(compareOpenApi(after, before).changes.some(c => c.direction === 'backward' && c.category === 'request_body_removed'));
});

test('Worker adapter returns HTTP-shaped success and bounded input errors', async () => {
  const { handleOpenApiDiffRequest, OPENAPI_DIFF_INPUT_SCHEMA, OPENAPI_DIFF_OUTPUT_SCHEMA } = await import('./openapi-diff.ts');
  const source = doc({ '/health': { get: { responses: { 200: { description: 'ok' } } } } });
  const ok = handleOpenApiDiffRequest({ before_openapi_json: source, after_openapi_json: source });
  assert.equal(ok.status, 200);
  assert.equal(ok.itemsProcessed, 2);
  assert.equal(OPENAPI_DIFF_INPUT_SCHEMA.properties.before_openapi_json.maxLength, 262_144);
  assert.equal(OPENAPI_DIFF_OUTPUT_SCHEMA.properties.changes.maxItems, 200);
  const bad = handleOpenApiDiffRequest({ before_openapi_json: '{', after_openapi_json: source });
  assert.equal(bad.status, 400);
  assert.equal(bad.itemsProcessed, 0);
  const tooLarge = handleOpenApiDiffRequest({ before_openapi_json: ' '.repeat(262_145), after_openapi_json: source });
  assert.equal(tooLarge.status, 413);
});

test('bounded Worker stream adapter handles valid, malformed, absent, and oversized bodies', async () => {
  const { handleOpenApiDiffRequestStream, OPENAPI_DIFF_MAX_HTTP_BODY_BYTES } = await import('./openapi-diff.ts');
  const source = doc({ '/health': { get: { responses: { 200: { description: 'ok' } } } } });
  const valid = await handleOpenApiDiffRequestStream(new Response(JSON.stringify({ before_openapi_json: source, after_openapi_json: source })).body);
  assert.equal(valid.status, 200);
  assert.equal((await handleOpenApiDiffRequestStream(null)).status, 400);
  const malformed = await handleOpenApiDiffRequestStream(new Response('{').body);
  assert.equal(malformed.status, 400);
  const atLimit = await handleOpenApiDiffRequestStream(new Response(' '.repeat(OPENAPI_DIFF_MAX_HTTP_BODY_BYTES)).body);
  assert.equal(atLimit.status, 400);
  const large = await handleOpenApiDiffRequestStream(new Response(' '.repeat(OPENAPI_DIFF_MAX_HTTP_BODY_BYTES + 1)).body);
  assert.equal(large.status, 413);
});

test('rejects invalid UTF-8 in the Worker body stream', async () => {
  const { handleOpenApiDiffRequestStream } = await import('./openapi-diff.ts');
  const invalidUtf8 = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xff, 0xfe));
      controller.close();
    },
  });
  assert.equal((await handleOpenApiDiffRequestStream(invalidUtf8)).status, 400);
});

test('marks unresolved components, servers, and security changes inconclusive', () => {
  const before = JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '1' }, servers: [{ url: 'https://api.example.test/v1' }], security: [{ bearer: [] }], components: { schemas: { Pet: { type: 'string' } } }, paths: { '/x': { get: { security: [{ bearer: [] }], responses: { 200: { description: 'ok' } } } } } });
  const after = JSON.stringify({ openapi: '3.1.0', info: { title: 'x', version: '2' }, servers: [{ url: 'https://api.example.test/v2' }], security: [], components: { schemas: { Pet: { type: 'number' } } }, paths: { '/x': { get: { security: [], responses: { 200: { description: 'ok' } } } } } });
  const result = compareOpenApi(before, after);
  assert.equal(result.breaking_change_count, 0);
  assert.ok(result.inconclusive_change_count >= 4);
  assert.ok(result.changes.some(c => c.path === '/components' && c.impact === 'inconclusive'));
});

test('marks changed unresolved path, parameter, request-body, and response refs inconclusive', () => {
  const before = JSON.stringify({
    openapi: '3.1.0', info: { title: 'x', version: '1' },
    paths: {
      '/ref-only': { $ref: '#/components/pathItems/A' },
      '/x': { get: {
        parameters: [{ $ref: '#/components/parameters/A' }],
        requestBody: { $ref: '#/components/requestBodies/A' },
        responses: { 200: { $ref: '#/components/responses/A' } },
      } },
    },
  });
  const after = before
    .replaceAll('pathItems/A', 'pathItems/B')
    .replaceAll('parameters/A', 'parameters/B')
    .replaceAll('requestBodies/A', 'requestBodies/B')
    .replaceAll('responses/A', 'responses/B');
  const result = compareOpenApi(before, after);
  assert.equal(result.breaking_change_count, 0);
  assert.deepEqual(new Set(result.changes.map(c => c.category)), new Set(['path_reference', 'parameter_reference', 'request_body_reference', 'response_reference']));
  assert.equal(result.assessment, 'inconclusive');
});
