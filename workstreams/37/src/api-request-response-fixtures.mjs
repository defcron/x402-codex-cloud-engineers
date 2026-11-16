export const MAX_INPUT_CHARS=131_072;
export const MAX_FIXTURES=50;
const MAX_EXAMPLES=10,MAX_DEPTH=8,MAX_NODES=5_000;
const METHODS=new Set(["get","put","post","delete","patch","head","options","trace"]);
const isObj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const obj=v=>isObj(v)?v:{};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
export class ApiFixtureError extends Error{constructor(message,status=400){super(message);this.name="ApiFixtureError";this.status=status;}}
function schemaFor(container){const c=obj(container?.content),type=Object.keys(c).find(k=>k==="application/json"||k.endsWith("+json"));return type?obj(c[type]).schema:undefined;}
function sample(schema,path,depth,state){
 if(!isObj(schema))return null;
 if(++state.nodes>MAX_NODES){state.caveats.add("Schema sampling stopped at 5,000 nodes.");return null;}
 if(depth>MAX_DEPTH){state.caveats.add(`Schema sampling stopped at depth ${MAX_DEPTH} at ${path}.`);return null;}
 if(schema.$ref!==undefined){state.caveats.add(`Unresolved $ref at ${path}; sample is null and must be supplied manually.`);return null;}
 for(const k of ["oneOf","anyOf","allOf","not","if","then","else"])if(schema[k]!==undefined)state.caveats.add(`Schema keyword ${k} at ${path} is not evaluated.`);
 for(const k of ["pattern","minLength","maxLength","maximum","exclusiveMinimum","exclusiveMaximum","maxItems","uniqueItems","format"])if(schema[k]!==undefined)state.caveats.add(`Constraint ${k} at ${path} was not enforced; sample may violate it.`);
 if(own(schema,"example"))return schema.example;
 if(Array.isArray(schema.examples)&&schema.examples.length)return schema.examples[0];
 if(own(schema,"default"))return schema.default;
 if(own(schema,"const"))return schema.const;
 if(Array.isArray(schema.enum)&&schema.enum.length)return schema.enum[0];
 const type=Array.isArray(schema.type)?schema.type.find(x=>x!=="null"):schema.type;
 if((type??(isObj(schema.properties)?"object":""))==="object"){
  const props=obj(schema.properties),required=Array.isArray(schema.required)?schema.required.filter(x=>typeof x==="string"):Object.keys(props),out={};
  for(const k of required.slice(0,50)){if(!own(props,k)){state.caveats.add(`Required property ${path}/${k} has no inline schema and was omitted.`);continue;}out[k]=sample(props[k],`${path}/${k}`,depth+1,state);}
  if(required.length>50||Object.keys(props).length>50)state.caveats.add(`Object at ${path} was capped at 50 properties; constraints may be unmet.`);
  return out;
 }
 if(type==="array"){
  if(!isObj(schema.items)){state.caveats.add(`Array items are unspecified at ${path}; emitted empty array.`);return [];}
  const min=Number.isInteger(schema.minItems)?schema.minItems:1,n=Math.min(Math.max(min,0),3);
  if(min>3)state.caveats.add(`Generated array at ${path} has 3 items and does not meet minItems=${min}.`);
  return Array.from({length:n},(_,i)=>sample(schema.items,`${path}/${i}`,depth+1,state));
 }
 if(type==="string")return({date:"2000-01-01","date-time":"2000-01-01T00:00:00Z",email:"user@example.test",uuid:"00000000-0000-4000-8000-000000000000"})[schema.format]??"example";
 if(type==="integer")return Number.isInteger(schema.minimum)?schema.minimum:1;
 if(type==="number")return typeof schema.minimum==="number"?schema.minimum:1;
 if(type==="boolean")return false;
 if(type==="null"||schema.nullable===true)return null;
 state.caveats.add(`No sampling rule at ${path}; emitted null.`);return null;
}
function merge(base,value){if(!isObj(base)||!isObj(value))return value;const out={...base};for(const[k,v]of Object.entries(value))out[k]=isObj(v)&&isObj(base[k])?merge(base[k],v):v;return out;}
function parameters(op,supplied,state){
 const out={path:{},query:{},header:{},cookie:{}};
 for(const p of(Array.isArray(op.parameters)?op.parameters.slice(0,100):[])){if(!isObj(p)||typeof p.name!=="string"||!own(out,p.in))continue;out[p.in][p.name]=own(p,"example")?p.example:sample(p.schema,`/parameters/${p.in}/${p.name}`,0,state);}
 for(const k of Object.keys(out))if(isObj(supplied[k]))Object.assign(out[k],supplied[k]);return out;
}
function validateExample(e,i){
 if(!isObj(e)||Object.keys(e).some(k=>!["name","request","response"].includes(k)))throw new ApiFixtureError(`examples[${i}] accepts only name, request, and response.`);
 for(const k of["request","response"])if(e[k]!==undefined&&!isObj(e[k]))throw new ApiFixtureError(`examples[${i}].${k} must be an object.`);
 if(e.request&&Object.keys(e.request).some(k=>!["path","query","headers","cookie","body"].includes(k)))throw new ApiFixtureError(`examples[${i}].request has an unsupported field.`);
 if(e.response&&Object.keys(e.response).some(k=>!["status","headers","body"].includes(k)))throw new ApiFixtureError(`examples[${i}].response has an unsupported field.`);
}
function firstStatus(op){const keys=Object.keys(obj(op.responses));return keys.find(x=>/^2\d\d$/.test(x))??keys[0]??null;}
/** Build local request/response fixtures from one OpenAPI operation and optional caller examples. */
export function buildApiRequestResponseFixtures(input){
 if(!isObj(input)||Object.keys(input).some(k=>!["method","path","operation","examples"].includes(k)))throw new ApiFixtureError("Body accepts method, path, operation, and optional examples.");
 let size;try{size=JSON.stringify(input).length;}catch{throw new ApiFixtureError("Body must be JSON-serializable.");}
 if(size>MAX_INPUT_CHARS)throw new ApiFixtureError(`Input exceeds ${MAX_INPUT_CHARS} characters.`,413);
 if(typeof input.method!=="string"||!METHODS.has(input.method.toLowerCase()))throw new ApiFixtureError("method must be a standard HTTP method.");
 if(typeof input.path!=="string"||!input.path.startsWith("/")||input.path.length>512)throw new ApiFixtureError("path must start with / and be at most 512 characters.");
 if(!isObj(input.operation))throw new ApiFixtureError("operation must be an OpenAPI Operation Object.");
 const examples=input.examples??[{}];if(!Array.isArray(examples)||examples.length<1||examples.length>MAX_EXAMPLES)throw new ApiFixtureError(`examples must contain 1 to ${MAX_EXAMPLES} entries.`);
 const caveats=new Set(["Generated values are illustrative and unvalidated; they may not satisfy every schema constraint.","No target API calls are made; external references are not resolved."]);
 const state={nodes:0,caveats},op=input.operation,requestSchema=schemaFor(obj(op.requestBody)),generatedBody=requestSchema?sample(requestSchema,"/requestBody",0,state):undefined;
 const fallbackStatus=firstStatus(op),fixtures=[];
 for(let i=0;i<examples.length;i++){
  if(fixtures.length>=MAX_FIXTURES){caveats.add(`Output capped at ${MAX_FIXTURES} fixtures.`);break;}
  const e=examples[i];validateExample(e,i);const req=obj(e.request),res=obj(e.response),status=res.status??fallbackStatus;
  if(status!==null&&!/^([1-5]\d\d|default)$/.test(String(status)))throw new ApiFixtureError(`examples[${i}].response.status must be an HTTP status or default.`);
  const responseMap=obj(op.responses),responseSchema=schemaFor(obj(responseMap[String(status)]??responseMap.default));
  const responseBody=res.body===undefined&&responseSchema?sample(responseSchema,`/responses/${status}`,0,state):res.body;
  const body=req.body===undefined?generatedBody:requestSchema?merge(generatedBody,req.body):req.body;
  const name=typeof e.name==="string"&&e.name.trim()?e.name.slice(0,100):`case-${i+1}`;
  fixtures.push({name,method:input.method.toUpperCase(),path:input.path,request:{parameters:parameters(op,req,state),headers:obj(req.headers),body},response:{status,headers:obj(res.headers),body:responseBody},response_contract_declared:status!==null&&own(responseMap,String(status)),sample_status:"illustrative_unvalidated"});
  const required=isObj(requestSchema)&&Array.isArray(requestSchema.required)?requestSchema.required.filter(k=>typeof k==="string"):[];
  for(const key of required){
   if(fixtures.length>=MAX_FIXTURES){caveats.add(`Output capped at ${MAX_FIXTURES} fixtures.`);break;}
   const negative=isObj(body)?{...body}:{};delete negative[key];
   fixtures.push({name:`${name}-missing-${key}`.slice(0,100),method:input.method.toUpperCase(),path:input.path,request:{parameters:parameters(op,req,state),headers:obj(req.headers),body:negative},response:{status:null,headers:{},body:null},response_contract_declared:false,sample_status:"synthetic_negative",validation_caveat:`Synthetic case omits required request property "${key}"; OpenAPI does not define expected error status or body.`});
  }
 }
 const bounded=fixtures.slice(0,MAX_FIXTURES),result={operation:{method:input.method.toUpperCase(),path:input.path},fixture_count:bounded.length,fixtures:bounded,validation_caveats:[...caveats]};
 if(JSON.stringify(result).length>1_048_576)throw new ApiFixtureError("Output exceeds 1,048,576 characters.",413);
 return result;
}
