import { safeFetch } from "../http.js";
import type { DatasetCandidate } from "../types.js";

const BASE = "https://data.gov.hk/tc-data/api/3/action";

function terms(query: string, keywords: string[] = []): string[] {
  return [...new Set([query, ...keywords]
    .flatMap((x) => x.toLowerCase().split(/[\s,，、/]+/))
    .map((x) => x.trim())
    .filter((x) => x.length >= 2))];
}

export async function searchHongKong(query: string, keywords: string[] = [], limit = 10): Promise<DatasetCandidate[]> {
  const list = await safeFetch(`${BASE}/package_list?limit=10000`);
  if (list.status !== 200) throw new Error(`DATA.GOV.HK package_list returned ${list.status}`);
  const parsed = JSON.parse(list.text) as { success: boolean; result: string[] };
  if (!parsed.success || !Array.isArray(parsed.result)) return [];

  const ts = terms(query, keywords);
  const ids = parsed.result.filter((id) => ts.some((t) => id.toLowerCase().includes(t))).slice(0, Math.max(limit * 3, 20));
  const out: DatasetCandidate[] = [];
  for (const id of ids) {
    const res = await safeFetch(`${BASE}/package_show?id=${encodeURIComponent(id)}`);
    if (res.status !== 200) continue;
    const p = JSON.parse(res.text) as any;
    if (!p.success || !p.result) continue;
    const r = p.result;
    const title = String(r.title ?? r.name ?? id);
    const notes = String(r.notes ?? "");
    const haystack = `${title}\n${notes}\n${r.name ?? ""}`.toLowerCase();
    const matched = ts.filter((t) => haystack.includes(t));
    if (!matched.length) continue;
    const resources = Array.isArray(r.resources) ? r.resources : [];
    out.push({
      region: "HK",
      id,
      title,
      description: notes,
      provider: String(r.organization?.title ?? r.maintainer ?? ""),
      formats: [...new Set(resources.map((x: any) => String(x.format ?? "")).filter(Boolean))] as string[],
      detailUrl: `https://data.gov.hk/tc-data/dataset/${encodeURIComponent(id)}`,
      resourceUrls: resources.map((x: any) => x.url).filter((x: unknown): x is string => typeof x === "string"),
      match: "candidate",
      evidence: matched.map((x) => `metadata contains: ${x}`)
    });
    if (out.length >= limit) break;
  }
  return out;
}
