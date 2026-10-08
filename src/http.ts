const ALLOWED_SUFFIXES = [".gov.hk", ".gov.mo"];
const ALLOWED_EXACT = new Set(["data.gov.hk","api.data.gov.hk","app.data.gov.hk","data.gov.mo","api.data.gov.mo"]);
const REDIRECT_STATUSES = new Set([301,302,303,307,308]);
const MAX_REDIRECTS = 4;

export function assertOfficialUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) {
    throw new Error("Only HTTPS government URLs without embedded credentials or non-standard ports are allowed");
  }
  const host=u.hostname.toLowerCase();
  if (!(ALLOWED_EXACT.has(host) || ALLOWED_SUFFIXES.some(s=>host.endsWith(s)))) {
    throw new Error(`Not an allowlisted HK/MO government domain: ${host}`);
  }
  return u;
}
function sanitizedHeaders(input?: HeadersInit): Headers {
  const h = new Headers(input ?? {});
  if (!h.has("user-agent")) h.set("user-agent","hkmo-open-data-mcp/0.2");
  if (!h.has("accept")) h.set("accept","application/json,text/plain,application/xml,text/xml,text/csv,*/*;q=0.3");
  return h;
}
export type FetchedBytes = {url:string; status:number; contentType:string; bytes:Uint8Array};
export async function safeFetchBytes(raw:string, init:RequestInit={},maxBytes=2_000_000):Promise<FetchedBytes> {
  let current=assertOfficialUrl(raw),method=String(init.method??"GET").toUpperCase();
  let body=init.body,headers=sanitizedHeaders(init.headers);
  if (method!=="GET" && method!=="POST") throw new Error("Only GET/POST requests are allowed");
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),12_000);
  try {
    for (let redirects=0; redirects<=MAX_REDIRECTS; redirects++) {
      const res=await fetch(current,{method,body,headers,redirect:"manual",signal:controller.signal});
      if (REDIRECT_STATUSES.has(res.status)) {
        if (redirects===MAX_REDIRECTS) throw new Error("Too many redirects");
        const location=res.headers.get("location");
        if (!location) throw new Error("Redirect missing Location");
        const next=assertOfficialUrl(new URL(location,current).toString());
        if (next.origin!==current.origin) {
          headers=new Headers(headers);
          for (const k of ["authorization","cookie","proxy-authorization","x-api-key"]) headers.delete(k);
          // Do not forward any auth-bearing POST body across origins.
          if (body) throw new Error("Cross-origin redirects with a request body are forbidden");
        }
        if (res.status===303 || ((res.status===301||res.status===302) && method==="POST")) {
          method="GET";body=undefined;headers.delete("content-length");headers.delete("content-type");
        }
        current=next;continue;
      }
      assertOfficialUrl(res.url||current.toString());
      const chunks:Uint8Array[]=[];let total=0;
      const reader=res.body?.getReader();
      if (reader) while(true) {
        const {done,value}=await reader.read();if(done) break;
        total+=value.byteLength;
        if(total>maxBytes){await reader.cancel();throw new Error(`Response too large (max ${maxBytes} bytes)`);}
        chunks.push(value);
      }
      return {url:current.toString(),status:res.status,contentType:res.headers.get("content-type")??"",bytes:Buffer.concat(chunks.map(c=>Buffer.from(c)))};
    }
    throw new Error("Redirect loop");
  } finally { clearTimeout(timer); }
}
export async function safeFetch(raw:string,init:RequestInit={},maxBytes=2_000_000) {
  const res=await safeFetchBytes(raw,init,maxBytes);
  return {url:res.url,status:res.status,contentType:res.contentType,text:Buffer.from(res.bytes).toString("utf8")};
}
