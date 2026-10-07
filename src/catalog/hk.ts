import { safeFetch } from "../http.js";
import type { DatasetCandidate } from "../types.js";
import registry from "../../registry/hk.json" with { type: "json" };

const BASE = "https://data.gov.hk/tc-data/api/3/action";
const DATASET_INDEX_URL = "https://resource.data.one.gov.hk/opendata/open-data-list/open-data-dataset-list-zh-hant.json";
const CACHE_TTL_MS = 15 * 60 * 1000;

type HkPackage = Record<string, any>;
type HkIndexRecord = { id: string; text: string };

let groupCache: { expiresAt: number; packages: HkPackage[] } | null = null;
let indexCache: { expiresAt: number; records: HkIndexRecord[] } | null = null;

function stripRegion(s: string): string {
  return s.replace(/香港|hong\s*kong|hongkong/giu, " ").replace(/(^|[\s,，、/])hk(?=$|[\s,，、/])/giu, " ");
}
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
function pushTerm(out: Set<string>, value: string): void {
  const s = value.trim().toLowerCase();
  if (s.length >= 2) out.add(s);
}
export function extractHongKongTerms(query: string, keywords: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of [query, ...keywords]) {
    const cleaned = stripRegion(raw).normalize("NFKC").toLowerCase();
    const chunks = cleaned.split(/[\s,，、/()（）]+/).map((x) => x.trim()).filter(Boolean);
    for (const chunk of chunks) {
      pushTerm(out, chunk);
      if (/\p{Script=Han}/u.test(chunk)) {
        const segmenter = new Intl.Segmenter("zh-Hant", { granularity: "word" });
        for (const part of segmenter.segment(chunk)) if (part.isWordLike) pushTerm(out, part.segment);
      }
    }
  }
  return [...out];
}

function packageText(p: HkPackage): string {
  const tags = Array.isArray(p.tags) ? p.tags.map((x: any) => String(x?.display_name ?? x?.name ?? "")).join(" ") : "";
  const org = String(p.organization?.title ?? p.organization?.name ?? "");
  return [p.title,p.name,p.notes,p.author,p.maintainer,org,tags].filter(Boolean).join("\n").toLowerCase().normalize("NFKC");
}
export function scoreHongKongPackage(p: HkPackage, terms: string[]): number {
  const text = packageText(p);
  const title = String(p.title ?? "").toLowerCase().normalize("NFKC");
  let score = 0;
  for (const term of terms) score += title.includes(term) ? 4 : (text.includes(term) ? 1 : 0);
  return score;
}

function datasetIdFromString(value: string): string | null {
  const urlMatch = value.match(/https?:\/\/data\.gov\.hk\/(?:tc-data|en-data|sc-data)\/dataset\/([^/?#]+)/i);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]);
  const trimmed = value.trim();
  if (/^[a-z0-9][a-z0-9._-]{5,}$/i.test(trimmed) && /^(hk-|mtr-|ctb-|nlb-)/i.test(trimmed)) return trimmed;
  return null;
}

export function extractHongKongIndexRecords(value: unknown): HkIndexRecord[] {
  const found = new Map<string, HkIndexRecord>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const directStrings = Object.values(obj).filter((v): v is string => typeof v === "string");
    const ids = directStrings.map(datasetIdFromString).filter((x): x is string => Boolean(x));
    if (ids.length) {
      const text = JSON.stringify(obj).toLowerCase().normalize("NFKC");
      for (const id of ids) found.set(id, { id, text });
      return;
    }
    for (const child of Object.values(obj)) walk(child);
  };
  walk(value);
  return [...found.values()];
}

async function loadHongKongIndex(): Promise<HkIndexRecord[]> {
  if (indexCache && indexCache.expiresAt > Date.now()) return indexCache.records;
  try {
    const res = await safeFetch(DATASET_INDEX_URL, {}, 12_000_000);
    if (res.status !== 200) return [];
    const records = extractHongKongIndexRecords(JSON.parse(res.text));
    indexCache = { expiresAt: Date.now() + CACHE_TTL_MS, records };
    return records;
  } catch {
    return [];
  }
}

function searchCurated(query: string, keywords: string[], limit: number): DatasetCandidate[] {
  const needles = [query, ...keywords].map((x) => normalize(stripRegion(x))).filter(Boolean);
  return (registry.datasets as Array<any>)
    .filter((d) => d.verificationStatus === "verified")
    .filter((d) => {
      const text = normalize([d.title,d.category,d.provider,d.description,...(d.aliases ?? []),...(d.exactAliases ?? [])].filter(Boolean).join(" "));
      return needles.some((n) => text.includes(n) || n.includes(normalize(d.title)));
    })
    .slice(0, limit)
    .map((d) => ({
      region:"HK" as const,id:d.id,title:d.title,category:d.category,description:d.description,provider:d.provider,
      formats:d.formats,detailUrl:d.detailUrl,resourceUrls:d.resourceUrls ?? [],exactAliases:d.exactAliases ?? [],
      updateFrequency:d.updateFrequency,dataType:d.dataType,accessMethod:d.accessMethod,requestMethod:d.requestMethod,
      evidenceUrls:d.evidenceUrls ?? [d.detailUrl],verificationStatus:"verified" as const,match:"candidate" as const,
      evidence:["matched verified Hong Kong curated registry entry"]
    }));
}

async function loadHongKongGroupCatalog(): Promise<HkPackage[]> {
  if (groupCache && groupCache.expiresAt > Date.now()) return groupCache.packages;
  const groupsRes = await safeFetch(`${BASE}/group_list`);
  if (groupsRes.status !== 200) return [];
  const groupsParsed = JSON.parse(groupsRes.text) as { success:boolean; result:string[] };
  if (!groupsParsed.success || !Array.isArray(groupsParsed.result)) return [];
  const packages = new Map<string,HkPackage>();
  for (let i=0;i<groupsParsed.result.length;i+=4) {
    const batch = groupsParsed.result.slice(i,i+4);
    const results = await Promise.all(batch.map(async (group) => {
      try {
        const res = await safeFetch(`${BASE}/group_show?id=${encodeURIComponent(group)}`);
        if (res.status !== 200) return [];
        const parsed = JSON.parse(res.text) as { success:boolean; result?:{ packages?:HkPackage[] } };
        return parsed.success && Array.isArray(parsed.result?.packages) ? parsed.result!.packages! : [];
      } catch { return []; }
    }));
    for (const rows of results) for (const p of rows) {
      const id = String(p.name ?? p.id ?? "");
      if (id) packages.set(id,p);
    }
  }
  const list=[...packages.values()];
  groupCache={expiresAt:Date.now()+CACHE_TTL_MS,packages:list};
  return list;
}

async function candidateIds(query:string,keywords:string[],limit:number):Promise<string[]> {
  const terms=extractHongKongTerms(query,keywords);
  if(!terms.length) return [];

  const index=await loadHongKongIndex();
  if(index.length){
    return index
      .map((r)=>({id:r.id,score:terms.reduce((s,t)=>s+(r.text.includes(t)?1:0),0)}))
      .filter((x)=>x.score>0)
      .sort((a,b)=>b.score-a.score)
      .slice(0,Math.max(limit*4,30))
      .map((x)=>x.id);
  }

  const catalog=await loadHongKongGroupCatalog();
  return catalog
    .map((p)=>({id:String(p.name??p.id??""),score:scoreHongKongPackage(p,terms)}))
    .filter((x)=>x.id&&x.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,Math.max(limit*4,30))
    .map((x)=>x.id);
}

async function searchCkan(query:string,keywords:string[],limit:number,exclude:Set<string>):Promise<DatasetCandidate[]> {
  const terms=extractHongKongTerms(query,keywords);
  const ids=await candidateIds(query,keywords,limit);
  const out:DatasetCandidate[]=[];
  for(const id of ids){
    if(exclude.has(id)) continue;
    const res=await safeFetch(`${BASE}/package_show?id=${encodeURIComponent(id)}`);
    if(res.status!==200) continue;
    const parsed=JSON.parse(res.text) as any;
    if(!parsed.success||!parsed.result) continue;
    const r=parsed.result;
    const title=String(r.title??r.name??id),notes=String(r.notes??""),haystack=packageText(r);
    const matched=terms.filter((t)=>haystack.includes(t));
    if(!matched.length) continue;
    const resources=Array.isArray(r.resources)?r.resources:[];
    out.push({
      region:"HK",id,title,description:notes,provider:String(r.organization?.title??r.maintainer??""),
      formats:[...new Set(resources.map((x:any)=>String(x.format??"")).filter(Boolean))] as string[],
      detailUrl:`https://data.gov.hk/tc-data/dataset/${encodeURIComponent(id)}`,
      resourceUrls:resources.map((x:any)=>x.url).filter((x:unknown):x is string=>typeof x==="string"),
      verificationStatus:"verified",match:"candidate",
      evidence:matched.map((x)=>`official CKAN metadata contains: ${x}`)
    });
    if(out.length>=limit) break;
  }
  return out;
}

export async function searchHongKong(query:string,keywords:string[]=[],limit=10):Promise<DatasetCandidate[]> {
  const curated=searchCurated(query,keywords,limit);
  const ckan=await searchCkan(query,keywords,limit,new Set(curated.map((x)=>x.id)));
  return [...curated,...ckan].slice(0,limit);
}
