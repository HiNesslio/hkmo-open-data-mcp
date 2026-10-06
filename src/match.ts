import type { DatasetCandidate } from "./types.js";

function atoms(s: string): string[] {
  return s.toLowerCase().split(/[\s,，、/]+/).map((x) => x.trim()).filter((x) => x.length >= 2);
}

export function strictMark(query: string, candidates: DatasetCandidate[]): DatasetCandidate[] {
  const q = atoms(query);
  return candidates.map((c) => {
    const h = `${c.title} ${c.description ?? ""}`.toLowerCase();
    const covered = q.filter((x) => h.includes(x));
    const exact = q.length > 0 && covered.length === q.length;
    return {
      ...c,
      match: exact ? "exact" : "candidate",
      evidence: [...c.evidence, `strict coverage ${covered.length}/${q.length}`]
    };
  });
}
