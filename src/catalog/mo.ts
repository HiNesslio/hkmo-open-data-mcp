import type { DatasetCandidate } from "../types.js";
import registry from "../../registry/mo.json" with { type: "json" };

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export async function searchMacao(query: string, keywords: string[] = [], limit = 10): Promise<DatasetCandidate[]> {
  const needles = [query, ...keywords].map(normalize).filter(Boolean);
  const rows = registry.datasets as Array<any>;
  return rows
    .filter((d) => {
      const text = normalize([d.title, d.description, ...(d.aliases ?? [])].join(" "));
      return needles.some((n) => text.includes(n) || n.includes(normalize(d.title)));
    })
    .slice(0, limit)
    .map((d) => ({
      region: "MO" as const,
      id: d.id,
      title: d.title,
      description: d.description,
      provider: d.provider,
      formats: d.formats,
      detailUrl: d.detailUrl,
      resourceUrls: d.resourceUrls ?? [],
      match: "candidate" as const,
      evidence: ["matched local registry entry sourced from data.gov.mo"]
    }));
}
