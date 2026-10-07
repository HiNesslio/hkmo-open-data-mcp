import { safeFetch } from "../http.js";
import type { DatasetCandidate } from "../types.js";
import registry from "../../registry/hk.json" with { type: "json" };

const BASE = "https://data.gov.hk/tc-data/api/3/action";
const CACHE_TTL_MS = 15 * 60 * 1000;
type HkPackage = Record<string, any>;
let cache: { expiresAt: number; packages: HkPackage[] } | null = null;

function stripRegion(s: string): string {
  return s.replace(/香港|hong\s*kong|hongkong/giu," ").replace(/(^|[\s,，、/])hk(?=$|[\s,，、/])/giu," ");
}
function normalize(s:string):string { return s.toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu,""); }
function pushTerm(out:Set<string>,value:string):void { const s=value.trim().toLowerCase(); if(s.length>=2) out.add(s); }
export function extractHongKongTerms(query:string,keywords:string[]=[]):string[] {
  const out=new Set<string>();
  for(const raw of [query,...keywords]){
    const cleaned=stripRegion(raw).normalize("NFKC").toLowerCase();
    const chunks=cleaned.split(/[\s,，、/()（）]+/).map(x=>x.trim()).filter(Boolean);
    for(const chunk of chunks){
      pushTerm(out,chunk);
      if(/\p{Script=Han}/u.test(chunk)){
        const segmenter=new Intl.Segmenter("zh-Hant",{granularity:"word"});
        for(const part of segmenter.segment(chunk)) if(part.isWordLike) pushTerm(out,part.segment);
      }
    }
  }
  return [...out];
}
function packageText(p:HkPackage):string {
  const tags=Array.isArray(p.tags)?p.tags.map((x:any)=>String(x?.display_name??x?.name??"")).join(" "):"";
  const org=String(p.organization?.title??p.organization?.name??"");
  return [p.title,p.name,p.notes,p.author,p.maintainer,org,tags].filter(Boolean).join("\n").toLowerCase().normalize("NFKC");
}
export function scoreHongKongPackage(p:HkPackage,terms:string[]):number {
  const text=packageText(p),title=String(p.title??"").toLowerCase().normalize("NFKC");
  let score=0; for(const term of terms) score += title.includes(term)?4:(text.includes(term)?1:0); return score;
}

function searchCurated(query:string,keywords:string[],limit:number):DatasetCandidate[] {
  const needles=[query,...keywords].map(x=>normalize(stripRegion(x))).filter(Boolean);
  return (registry.datasets as Array<any>)
    .filter(d=>d.verificationStatus==="verified")
    .filter(d=>{
      const text=normalize([d.title,d.category,d.provider,d.description,...(d.aliases??[]),...(d.exactAliases??[])].filter(Boolean).join(" "));
      return needles.some(n=>text.includes(n)||n.includes(normalize(d.title)));
    })
    .slice(0,limit)
    .map(d=>({region:"HK" as const,id:d.id,title:d.title,category:d.category,description:d.description,provider:d.provider,
      formats:d.formats,detailUrl:d.detailUrl,resourceUrls:d.resourceUrls??[],exactAliases:d.exactAliases??[],
      updateFrequency:d.updateFrequency,dataType:d.dataType,accessMethod:d.accessMethod,requestMethod:d.requestMethod,
      evidenceUrls:d.evidenceUrls??[d.detailUrl],verificationStatus:"verified" as const,match:"candidate" as const,
      evidence:["matched verified Hong Kong curated registry entry"]}));
}

async function loadHongKongCatalog():Promise<HkPackage[]> {
  if(cache&&cache.expiresAt>Date.now()) return cache.packages;
  const groupsRes=await safeFetch(`${BASE}/group_list`);
  if(groupsRes.status!==200) throw new Error(`DATA.GOV.HK group_list returned ${groupsRes.status}`);
  const groupsParsed=JSON.parse(groupsRes.text) as {success:boolean;result:string[]};
  if(!groupsParsed.success||!Array.isArray(groupsParsed.result)) return [];
  const packages=new Map<string,HkPackage>();
  const groups=groupsParsed.result;
  for(let i=0;i<groups.length;i+=4){
    const batch=groups.slice(i,i+4);
    const results=await Promise.all(batch.map(async group=>{
      try{
        const res=await safeFetch(`${BASE}/group_show?id=${encodeURIComponent(group)}`);
        if(res.status!==200) return [];
        const parsed=JSON.parse(res.text) as {success:boolean;result?:{packages?:HkPackage[]}};
        return parsed.success&&Array.isArray(parsed.result?.packages)?parsed.result!.packages!:[];
      }catch{return [];}
    }));
    for(const rows of results) for(const p of rows){ const id=String(p.name??p.id??""); if(id) packages.set(id,p); }
  }
  const list=[...packages.values()]; cache={expiresAt:Date.now()+CACHE_TTL_MS,packages:list}; return list;
}

async function searchCkan(query:string,keywords:string[],limit:number,exclude:Set<string>):Promise<DatasetCandidate[]> {
  const terms=extractHongKongTerms(query,keywords); if(!terms.length) return [];
  const catalog=await loadHongKongCatalog();
  const shortlist=catalog.map(p=>({p,score:scoreHongKongPackage(p,terms)})).filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score).slice(0,Math.max(limit*3,20));
  const out:DatasetCandidate[]=[];
  for(const {p:summary} of shortlist){
    const id=String(summary.name??summary.id??""); if(!id||exclude.has(id)) continue;
    const res=await safeFetch(`${BASE}/package_show?id=${encodeURIComponent(id)}`); if(res.status!==200) continue;
    const parsed=JSON.parse(res.text) as any; if(!parsed.success||!parsed.result) continue;
    const r=parsed.result,title=String(r.title??r.name??id),notes=String(r.notes??""),haystack=packageText(r);
    const matched=terms.filter(t=>haystack.includes(t)); if(!matched.length) continue;
    const resources=Array.isArray(r.resources)?r.resources:[];
    out.push({region:"HK",id,title,description:notes,provider:String(r.organization?.title??r.maintainer??""),
      formats:[...new Set(resources.map((x:any)=>String(x.format??"")).filter(Boolean))] as string[],
      detailUrl:`https://data.gov.hk/tc-data/dataset/${encodeURIComponent(id)}`,
      resourceUrls:resources.map((x:any)=>x.url).filter((x:unknown):x is string=>typeof x==="string"),
      verificationStatus:"verified",match:"candidate",evidence:matched.map(x=>`official CKAN metadata contains: ${x}`)});
    if(out.length>=limit) break;
  }
  return out;
}

export async function searchHongKong(query:string,keywords:string[]=[],limit=10):Promise<DatasetCandidate[]> {
  const curated=searchCurated(query,keywords,limit);
  const ckan=await searchCkan(query,keywords,limit,new Set(curated.map(x=>x.id)));
  return [...curated,...ckan].slice(0,limit);
}
