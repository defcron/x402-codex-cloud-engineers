import { inspectApiVersionRouting, RoutingInspectorError } from "./inspect.mjs";

export const MAX_REQUEST_BYTES = 524288;

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function readBoundedJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new RoutingInspectorError("Request body exceeds 524288 bytes.", 413);
  if (!request.body) throw new RoutingInspectorError("Request body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RoutingInspectorError("Request body exceeds 524288 bytes.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new RoutingInspectorError("Request body must be valid UTF-8."); }
  try { return JSON.parse(text); }
  catch { throw new RoutingInspectorError("Request body must be valid JSON."); }
}

export async function handleApiVersionRoutingRequest(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return json({ error: "Content-Type must be application/json." }, 415);
  try {
    return json(inspectApiVersionRouting(await readBoundedJson(request)), 200);
  } catch (error) {
    if (error instanceof RoutingInspectorError) return json({ error: error.message }, error.status);
    return json({ error: "Request could not be processed." }, 500);
  }
}
