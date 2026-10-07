import registry from "../registry/mo.json" with { type: "json" };
import { safeFetch } from "./http.js";

type ApiRecord = {
  apiId: string;
  apiPath: string;
  method?: string;
};

type ResolvedMacaoAccess = {
  datasetId: string;
  metadataUrl: string;
  appCode: string;
  apis: ApiRecord[];
  selected?: ApiRecord;
  fetchedAt: string;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: ResolvedMacaoAccess }>();

function normalizeEndpoint(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function pickMethod(data: any): string | undefined {
  const value = data?.method ?? data?.requestMethod ?? data?.apiMethod ?? data?.httpMethod;
  return typeof value === "string" && value ? value.toUpperCase() : undefined;
}

function validateAppCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    throw new Error("Official Macao dataset metadata did not return a valid appCode.");
  }
  return value;
}

export function datasetIdFromMacaoDetailUrl(raw: string): string | null {
  const url = new URL(raw);
  if (url.hostname.toLowerCase() !== "data.gov.mo") return null;
  if (url.pathname.toLowerCase() !== "/detail") return null;
  const id = url.searchParams.get("id");
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function findVerifiedMacaoDatasetIdByApiUrl(raw: string): string | null {
  const target = normalizeEndpoint(raw);
  for (const dataset of (registry.datasets as Array<any>)) {
    if (dataset.verificationStatus !== "verified" || dataset.accessMethod !== "API") continue;
    const urls = Array.isArray(dataset.resourceUrls) ? dataset.resourceUrls : [];
    if (urls.some((url: string) => {
      try { return normalizeEndpoint(url) === target; } catch { return false; }
    })) return dataset.id;
  }
  return null;
}

async function fetchResolved(datasetId: string, forceRefresh = false): Promise<ResolvedMacaoAccess> {
  if (!forceRefresh) {
    const hit = cache.get(datasetId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const metadataUrl = `https://api.data.gov.mo/datadir/detail/${encodeURIComponent(datasetId)}`;
  const detailResponse = await safeFetch(metadataUrl, {}, 1_000_000);
  if (detailResponse.status !== 200) {
    throw new Error(`Macao dataset detail API returned HTTP ${detailResponse.status}`);
  }

  let detail: any;
  try {
    detail = JSON.parse(detailResponse.text);
  } catch {
    throw new Error("Macao dataset detail API did not return JSON.");
  }

  if (Number(detail?.code) !== 0 || !detail?.data) {
    throw new Error(`Macao dataset detail API returned code ${String(detail?.code ?? "unknown")}`);
  }

  const appCode = validateAppCode(detail.data.appCode);
  const apiIds = asArray(detail.data.apis)
    .map((record: any) => String(record?.apiId ?? "").trim())
    .filter(Boolean);

  if (!apiIds.length) throw new Error("Official Macao dataset metadata did not expose any API IDs.");

  const apis: ApiRecord[] = [];
  for (const apiId of apiIds) {
    const infoUrl = `https://api.data.gov.mo/api/${encodeURIComponent(apiId)}`;
    const response = await safeFetch(infoUrl, {}, 1_000_000);
    if (response.status !== 200) continue;

    let info: any;
    try { info = JSON.parse(response.text); } catch { continue; }
    if (Number(info?.code) !== 0 || typeof info?.data?.apiPath !== "string") continue;

    apis.push({
      apiId,
      apiPath: info.data.apiPath,
      method: pickMethod(info.data)
    });
  }

  if (!apis.length) throw new Error("Official Macao API metadata did not expose a callable apiPath.");

  const value: ResolvedMacaoAccess = {
    datasetId,
    metadataUrl,
    appCode,
    apis,
    fetchedAt: new Date().toISOString()
  };
  cache.set(datasetId, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function resolveMacaoApiAccess(datasetId: string, targetUrl?: string, forceRefresh = false): Promise<ResolvedMacaoAccess> {
  const resolved = await fetchResolved(datasetId, forceRefresh);
  if (!targetUrl) {
    return resolved.apis.length === 1 ? { ...resolved, selected: resolved.apis[0] } : resolved;
  }

  const target = normalizeEndpoint(targetUrl);
  const selected = resolved.apis.find((api) => {
    try { return normalizeEndpoint(api.apiPath) === target; } catch { return false; }
  });

  if (!selected) {
    throw new Error("Requested Macao API URL does not match any apiPath currently published by the official dataset metadata.");
  }
  return { ...resolved, selected };
}

export async function inspectMacaoDatasetDetail(datasetId: string) {
  const resolved = await resolveMacaoApiAccess(datasetId);
  return {
    kind: "macao_dataset_detail",
    datasetId,
    metadataUrl: resolved.metadataUrl,
    authentication: {
      scheme: "APPCODE",
      resolved: true,
      value: "[redacted]",
      ephemeral: true,
      source: "official data.gov.mo runtime metadata"
    },
    apis: resolved.apis,
    fetchedAt: resolved.fetchedAt
  };
}
