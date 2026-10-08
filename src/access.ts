import hk from "../registry/hk.json" with { type:"json" };
import mo from "../registry/mo.json" with { type:"json" };
import type { Region } from "./types.js";
import { assertOfficialUrl, safeFetch } from "./http.js";
import { requireVerifiedMacaoDataset, resolveMacaoApiAccess } from "./macao-auth.js";

type Entry = {
 id:string;title:string;detailUrl:string;provider?:string;category?:string;
 description?:string;formats?:string[];updateFrequency?:string;dataType?:string;
 accessMethod?:string;requestMethod?:string;resourceUrls?:string[];
 verificationStatus?:string;
};
export type Resource = {id:number;url:string;format:string;method:"GET"|"POST";requiredPathParams:string[];allowedQueryParams:string[];source:"registry"|"official_metadata"};
export type ResolvedDataset = {region:Region;id:string;title:string;detailUrl:string;provider:string;category:string;description:string;updateFrequency:string;dataType:string;verificationStatus:"verified";resources:Resource[]};
const HK_CKAN="https://data.gov.hk/tc-data/api/3/action/package_show?id=";

// Only declared, documented query parameters. The MCP never invents API parameters.
const documentedKeys:Record<string,string[]>={
  "mtr-data2-nexttrain-data":["line","sta"],
  "hk-hko-rss-current-weather-report":["dataType","lang"],
  "hk-hko-rss-local-weather-forecast":["dataType","lang"]
};
function formatFromUrl(value:string,formats:string[]=[]):string {
 const p=new URL(value).pathname.toLowerCase();
 const ext=p.split(".").at(-1)??"";
 if(["json","xml","csv","xlsx","xls","zip","txt"].includes(ext)) return ext.toUpperCase();
 const valid=formats.filter(f=>["JSON","XML","CSV","XLSX"].includes(f.toUpperCase()));
 return valid.length===1?valid[0].toUpperCase():"AUTO";
}
function resourceRecord(url:string,id:number,entry:Entry,source:Resource["source"],method?:string):Resource {
 const validated=assertOfficialUrl(url.replace(/\{[a-zA-Z_][a-zA-Z_0-9]*\}/g,"TEMPLATE"));
 const required=[...url.matchAll(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g)].map(x=>x[1]);
 const queryKeys=[...new Set([...validated.searchParams.keys(),...(documentedKeys[entry.id]??[])])];
 const effective=String(method??entry.requestMethod??"GET").toUpperCase();
 if(effective!=="GET"&&effective!=="POST") throw new Error("Unsupported resource method");
 return {id,url,format:formatFromUrl(url,entry.formats),method:effective as "GET"|"POST",requiredPathParams:required,allowedQueryParams:queryKeys,source};
}
async function loadHkCkan(id:string):Promise<{entry:Entry;resources:Resource[]}> {
 if(!/^[a-z0-9][a-z0-9._-]{3,150}$/i.test(id)) throw new Error("Invalid HK dataset ID");
 const response=await safeFetch(HK_CKAN+encodeURIComponent(id),{},1_000_000);
 if(response.status!==200) throw new Error("HK dataset metadata unavailable");
 const result=JSON.parse(response.text);
 if(result.success!==true||result.result?.name!==id) throw new Error("HK dataset not found in official CKAN metadata");
 const p=result.result;
 const entry:Entry={id,title:String(p.title??id),detailUrl:`https://data.gov.hk/tc-data/dataset/${encodeURIComponent(id)}`,
   provider:String(p.organization?.title??""),description:String(p.notes??""),verificationStatus:"verified"};
 const resources:Resource[]=[];
 for(const item of p.resources??[]) {
   if(typeof item.url!=="string") continue;
   try {const r=resourceRecord(item.url,resources.length,{...entry,formats:[String(item.format??"")]}, "official_metadata"); resources.push(r);}
   catch{ /* Non-government resources are not forwarded to the model */ }
 }
 return {entry,resources};
}
export async function inspectDataset(region:Region,id:string):Promise<ResolvedDataset> {
 const reg=(region==="HK"?hk.datasets:mo.datasets) as Entry[];
 let entry=reg.find(d=>d.id===id);
 if(region==="MO") requireVerifiedMacaoDataset(id);
 if(entry&&entry.verificationStatus!=="verified") throw new Error("Dataset is not verified");
 if(!entry&&region==="MO") throw new Error("Macao dataset is not verified");

 let resources:Resource[]=[];
 if(region==="HK") {
   const localUrls=entry?.resourceUrls??[];
   for(const u of localUrls) {
     try{resources.push(resourceRecord(u,resources.length,entry!,"registry"));}
     catch{ /* invalid registry URL is ignored, not called */ }
   }
   if(!entry || resources.length===0) {
     const found=await loadHkCkan(id);
     if(!entry)entry=found.entry;
     resources=found.resources;
   }
 } else {
   if(entry!.accessMethod==="API") {
     const resolved=await resolveMacaoApiAccess(id);
     for(const api of resolved.apis) {
       try {resources.push(resourceRecord(api.apiPath,resources.length,entry!,"official_metadata",api.method??entry!.requestMethod));}
       catch{ /* fail closed */ }
     }
   } else {
     for(const u of entry!.resourceUrls??[]) {
       try{resources.push(resourceRecord(u,resources.length,entry!,"registry"));}
       catch{}
     }
   }
 }
 if(!entry) throw new Error("Official dataset metadata unavailable");
 return {region,id,title:entry.title,detailUrl:entry.detailUrl,provider:entry.provider??"",category:entry.category??"",
  description:entry.description??"",updateFrequency:entry.updateFrequency??"unknown",dataType:entry.dataType??"unknown",verificationStatus:"verified",resources};
}
function secureParam(value:string):string {
 if(!/^[A-Za-z0-9_.-]{1,100}$/.test(value)) throw new Error("Invalid API path/query parameter value");
 return value;
}
export function bindResource(resource:Resource,pathParams:Record<string,string>={},queryParams:Record<string,string>={}):string {
 let url=resource.url.replace(/\{([a-zA-Z_][a-zA-Z_0-9]*)\}/g,(_,key:string)=>{
   if(!Object.hasOwn(pathParams,key)) throw new Error(`Missing path parameter: ${key}`);
   return encodeURIComponent(secureParam(pathParams[key]));
 });
 if(url.includes("{")||url.includes("}"))throw new Error("Unresolved resource template");
 const parsed=assertOfficialUrl(url);
 for(const [key,value] of Object.entries(queryParams)) {
   if(!resource.allowedQueryParams.includes(key)) throw new Error(`Undocumented query parameter: ${key}`);
   parsed.searchParams.set(key,secureParam(value));
 }
 return parsed.toString();
}
export async function boundRequest(args:{region:Region;datasetId:string;resourceId:number;pathParams?:Record<string,string>;queryParams?:Record<string,string>;body?:string;maxBytes?:number}) {
 const dataset=await inspectDataset(args.region,args.datasetId);
 const resource=dataset.resources[args.resourceId];
 if(!resource)throw new Error("Resource ID missing or not verified");
 if(args.body && resource.method!=="POST")throw new Error("Body is forbidden on GET resources");
 // The current government metadata does not provide a verified POST body schema.
 // Fail closed rather than accepting arbitrary AI-created payloads.
 if(args.body)throw new Error("POST body schema is not verified; arbitrary POST bodies are forbidden");
 const url=bindResource(resource,args.pathParams,args.queryParams);
 const headers=new Headers();
 if(resource.method==="POST" && args.body) {
   try{JSON.parse(args.body);}catch{throw new Error("POST body must be JSON");}
   headers.set("content-type","application/json");
 }
 if(args.region==="MO" && new URL(url).hostname.endsWith(".apigateway.data.gov.mo")) {
   const auth=await resolveMacaoApiAccess(args.datasetId,url);
   if(resource.method!==(auth.selected?.method??resource.method)) throw new Error("Requested method differs from official API metadata");
   headers.set("authorization",`APPCODE ${auth.appCode}`);
 }
 const {safeFetchBytes}=await import("./http.js");
 const result=await safeFetchBytes(url,{method:resource.method,headers,body:args.body},Math.min(args.maxBytes??2_000_000,5_000_000));
 if([400,401,403].includes(result.status) && headers.has("authorization") && resource.method==="GET") {
   const refreshed=await resolveMacaoApiAccess(args.datasetId,url,true);
   headers.set("authorization",`APPCODE ${refreshed.appCode}`);
   return {dataset,resource,result:await safeFetchBytes(url,{method:resource.method,headers},Math.min(args.maxBytes??2_000_000,5_000_000))};
 }
 return {dataset,resource,result};
}
