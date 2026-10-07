import { safeFetch } from "../http.js";
import type { DatasetCandidate } from "../types.js";

const BASE = "https://data.gov.hk/tc-data/api/3/action";
const CACHE_TTL_MS = 15 * 60 * 1000;

type HkPackage = Record<string, any>;
let cache: { expiresAt: number; packages: HkPackage[] } | null = null;

function stripRegion(s: string): string {
  return s
    .replace(/香港|hong\s*kong|hongkong/giu, " ")
    .replace(/(^|[\s,，、/])hk(?=$|[\s,，、/])/giu, " ");
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
        for (const part of segmenter.segment(chunk)) {
          if (part.isWordLike) pushTerm(out, part.segment);
        }
      }
    }
  }
  return [...out];
}

function packageText(p: HkPackage): string {
  const tags = Array.isArray(p.tags) ? p.tags.map((x: any) => String(x?.display_name ?? x?.name ?? "")).join(" ") : "";
  const org = String(p.organization?.title ?? p.organization?.name ?? "");
  return [
    p.title,
    p.name,
    p.notes,
    p.author,
    p.maintainer,
    org,
    tags
  ].filter(Boolean).join("\n").toLowerCase().normalize("NFKC");
}

export function scoreHongKongPackage(p: HkPackage, terms: string[]): number {
  const text = packageText(p);
  const title = String(p.title ?? "").toLowerCase().normalize("NFKC");
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 4;
    else if (text.includes(term)) score += 1;
  }
  return score;
}

async function loadHongKongCatalog(): Promise<HkPackage[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.packages;

  const groupsRes = await safeFetch(`${BASE}/group_list`);
  if (groupsRes.status !== 200) throw new Error(`DATA.GOV.HK group_list returned ${groupsRes.status}`);
  const groupsParsed = JSON.parse(groupsRes.text) as { success: boolean; result: string[] };
  if (!groupsParsed.success || !Array.isArray(groupsParsed.result)) return [];

  const packages = new Map<string, HkPackage>();
  const groups = groupsParsed.result;

  for (let i = 0; i < groups.length; i += 4) {
    const batch = groups.slice(i, i + 4);
    const results = await Promise.all(batch.map(async (group) => {
      try {
        const res = await safeFetch(`${BASE}/group_show?id=${encodeURIComponent(group)}`);
        if (res.status !== 200) return [];
        const parsed = JSON.parse(res.text) as { success: boolean; result?: { packages?: HkPackage[] } };
        return parsed.success && Array.isArray(parsed.result?.packages) ? parsed.result!.packages! : [];
      } catch {
        return [];
      }
    }));
    for (const rows of results) {
      for (const p of rows) {
        const id = String(p.name ?? p.id ?? "");
        if (id) packages.set(id, p);
      }
    }
  }

  const list = [...packages.values()];
  cache = { expiresAt: Date.now() + CACHE_TTL_MS, packages: list };
  return list;
}

export async function searchHongKong(query: string, keywords: string[] = [], limit = 10): Promise<DatasetCandidate[]> {
  const terms = extractHongKongTerms(query, keywords);
  if (!terms.length) return [];

  const catalog = await loadHongKongCatalog();
  const shortlist = catalog
    .map((p) => ({ p, score: scoreHongKongPackage(p, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(limit * 3, 20));

  const out: DatasetCandidate[] = [];
  for (const { p: summary } of shortlist) {
    const id = String(summary.name ?? summary.id ?? "");
    if (!id) continue;

    const res = await safeFetch(`${BASE}/package_show?id=${encodeURIComponent(id)}`);
    if (res.status !== 200) continue;
    const parsed = JSON.parse(res.text) as any;
    if (!parsed.success || !parsed.result) continue;

    const r = parsed.result;
    const title = String(r.title ?? r.name ?? id);
    const notes = String(r.notes ?? "");
    const haystack = packageText(r);
    const matched = terms.filter((t) => haystack.includes(t));
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
      evidence: matched.map((x) => `official metadata contains: ${x}`)
    });
    if (out.length >= limit) break;
  }
  return out;
}
