import type { DatasetCandidate, Region } from "./types.js";

function stripRegionWords(s: string, region: Region): string {
  if (region === "MO") {
    return s.replace(/澳門|澳门|macao|macau/giu, "");
  }
  return s.replace(/香港|hong\s*kong|hongkong|hk/giu, "");
}

function normalizeExact(s: string, region: Region): string {
  return stripRegionWords(s.toLowerCase().normalize("NFKC"), region)
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function atoms(s: string, region: Region): string[] {
  return stripRegionWords(s.toLowerCase().normalize("NFKC"), region)
    .split(/[\s,，、/]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

export function strictMark(query: string, candidates: DatasetCandidate[]): DatasetCandidate[] {
  return candidates.map((c) => {
    const normalizedQuery = normalizeExact(query, c.region);
    const exactTargets = [c.title, ...(c.exactAliases ?? [])]
      .map((x) => normalizeExact(x, c.region))
      .filter(Boolean);

    const curatedExact = normalizedQuery.length > 0 && exactTargets.includes(normalizedQuery);

    const q = atoms(query, c.region);
    const h = `${c.title} ${c.description ?? ""}`.toLowerCase();
    const covered = q.filter((x) => h.includes(x));
    const coverageExact = q.length > 0 && covered.length === q.length;

    const exact = curatedExact || coverageExact;
    const reason = curatedExact
      ? "curated exact title/alias match"
      : `strict coverage ${covered.length}/${q.length}`;

    return {
      ...c,
      match: exact ? "exact" : "candidate",
      evidence: [...c.evidence, reason]
    };
  });
}
