import type { DatasetCandidate, Region } from "./types.js";

function normalize(s: string, region: Region): string {
  const withoutRegion = region === "MO"
    ? s.replace(/澳門|澳门|macau|macao/giu, " ")
    : s.replace(/香港|hong\s*kong|hongkong/giu, " ");
  return withoutRegion.toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}

/** Removes only conversational framing; never removes dates, "live", period or metric qualifiers. */
function normalizeRequest(query: string, region: Region): string {
  let q = query.trim().replace(/^(?:請|麻煩|可否|可以|唔該|please\s*)*/iu, "");
  q = q.replace(/^(?:幫我|幫手|替我|為我)?(?:查詢|查找|搜尋|搜索|搵下|搵|查下|查|找出|找|取得|提供|fetch|find|show\s*me)\s*/iu, "");
  q = q.replace(/(?:嘅|的)?(?:官方)?(?:資料集|數據集|資料|數據|dataset)\s*$/iu, "");
  return normalize(q, region);
}

/**
 * No fuzzy/word coverage promotion: semantic similarity, keywords and descriptions
 * are discovery hints, NOT evidence that the requested metric/time/granularity exists.
 * Only human-curated exact aliases or the complete official title can be exact.
 */
export function strictMark(query: string, candidates: DatasetCandidate[]): DatasetCandidate[] {
  return candidates.map((candidate) => {
    const verified = candidate.verificationStatus === "verified";
    const q = normalizeRequest(query, candidate.region);
    const names = [candidate.title, ...(candidate.exactAliases ?? [])]
      .map((name) => normalize(name, candidate.region)).filter(Boolean);
    const matched = verified && Boolean(q) && names.includes(q);
    const evidence = matched ? "exact official title / curated alias"
      : !verified ? `verification status blocks exact: ${candidate.verificationStatus ?? "unknown"}`
      : "related metadata only; exact title/alias and requested dimensions not verified";
    return { ...candidate, match: matched ? "exact" as const : "candidate" as const, evidence: [...candidate.evidence, evidence] };
  });
}
