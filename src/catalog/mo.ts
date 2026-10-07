import type { DatasetCandidate } from "../types.js";
import registry from "../../registry/mo.json" with { type: "json" };

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
function normalizeQuery(s: string): string {
  return normalize(s).replace(/澳門|澳门|macao|macau/gu, "");
}

export async function searchMacao(query: string, keywords: string[] = [], limit = 10): Promise<DatasetCandidate[]> {
  const needles = [query, ...keywords].map(normalizeQuery).filter(Boolean);
  const rows = (registry.datasets as Array<any>).filter((d) => d.verificationStatus !== "deprecated");

  return rows
    .filter((d) => {
      const text = normalize([d.title,d.category,d.provider,d.description,...(d.aliases ?? []),...(d.exactAliases ?? [])].filter(Boolean).join(" "));
      return needles.some((n) => text.includes(n) || n.includes(normalize(d.title)));
    })
    .sort((a,b) => (a.verificationStatus === "verified" ? -1 : 1) - (b.verificationStatus === "verified" ? -1 : 1))
    .slice(0, limit)
    .map((d) => ({
      region: "MO" as const,id:d.id,title:d.title,category:d.category,description:d.description,provider:d.provider,
      formats:d.formats,detailUrl:d.detailUrl,resourceUrls:d.resourceUrls ?? [],exactAliases:d.exactAliases ?? [],
      updateFrequency:d.updateFrequency,dataType:d.dataType,accessMethod:d.accessMethod,requestMethod:d.requestMethod,
      openness:d.openness,accessNotes:d.accessNotes,apiVerification:d.apiVerification,evidenceUrls:d.evidenceUrls ?? [d.detailUrl],
      verificationStatus:d.verificationStatus ?? "manual_required",match:"candidate" as const,
      evidence:[`matched Macao registry entry (${d.verificationStatus ?? "manual_required"})`]
    }));
}
