import { ApiFixtureError, MAX_INPUT_CHARS, buildApiRequestResponseFixtures } from "./api-request-response-fixtures.mjs";
const MAX_BODY_BYTES=MAX_INPUT_CHARS*4;
function json(body,status,extra={}){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}});}
/** Fetch-compatible POST handler; production payment middleware belongs in the router. */
export async function handleApiFixtureRequest(request){
 if(request.method!=="POST")return json({error:"method_not_allowed"},405,{allow:"POST"});
 const type=request.headers.get("content-type")??"";
 if(!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))return json({error:"content_type_must_be_json"},415);
 if(!request.body)return json({error:"invalid_json"},400);
 const reader=request.body.getReader(),chunks=[];let size=0;
 try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();return json({error:"request_too_large"},413);}chunks.push(value);}}
 catch{return json({error:"request_body_unreadable"},400);}
 let body;
 try{const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
 catch{return json({error:"invalid_json"},400);}
 try{return json(buildApiRequestResponseFixtures(body),200);}
 catch(error){if(error instanceof ApiFixtureError)return json({error:"invalid_fixture_request",message:error.message},error.status);return json({error:"internal_error"},500);}
}
