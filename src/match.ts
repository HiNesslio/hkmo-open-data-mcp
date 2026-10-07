import type { DatasetCandidate, Region } from "./types.js";
function stripRegionWords(s:string,region:Region):string {
  if(region==="MO") return s.replace(/澳門|澳门|macao|macau/giu,"");
  return s.replace(/香港|hong\s*kong|hongkong|(^|[\s,，、/])hk(?=$|[\s,，、/])/giu," ");
}
function normalizeExact(s:string,region:Region):string { return stripRegionWords(s.toLowerCase().normalize("NFKC"),region).replace(/[\s\p{P}\p{S}]+/gu,""); }
function atoms(s:string,region:Region):string[] {
  const stripped=stripRegionWords(s.toLowerCase().normalize("NFKC"),region),out=new Set<string>();
  const chunks=stripped.split(/[\s,，、/()（）]+/).map(x=>x.trim()).filter(Boolean);
  for(const chunk of chunks){ if(chunk.length>=2) out.add(chunk); if(/\p{Script=Han}/u.test(chunk)){ const segmenter=new Intl.Segmenter("zh-Hant",{granularity:"word"}); for(const part of segmenter.segment(chunk)){ const token=part.segment.trim(); if(part.isWordLike&&token.length>=2) out.add(token); } } }
  return [...out];
}
export function strictMark(query:string,candidates:DatasetCandidate[]):DatasetCandidate[] {
  return candidates.map(c=>{
    const eligible=c.verificationStatus!=="manual_required"&&c.verificationStatus!=="deprecated";
    const normalizedQuery=normalizeExact(query,c.region);
    const exactTargets=[c.title,...(c.exactAliases??[])].map(x=>normalizeExact(x,c.region)).filter(Boolean);
    const curatedExact=normalizedQuery.length>0&&exactTargets.includes(normalizedQuery);
    const q=atoms(query,c.region),h=`${c.title} ${c.description??""}`.toLowerCase().normalize("NFKC");
    const covered=q.filter(x=>h.includes(x)),coverageExact=q.length>0&&covered.length===q.length;
    const exact=eligible&&(curatedExact||coverageExact);
    const reason=!eligible?`verification status blocks exact: ${c.verificationStatus}`:(curatedExact?"curated exact title/alias match":`strict coverage ${covered.length}/${q.length}`);
    return {...c,match:exact?"exact":"candidate",evidence:[...c.evidence,reason]};
  });
}
