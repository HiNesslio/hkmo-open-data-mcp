#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { resolveRegion } from "./region.js";
import { searchHongKong } from "./catalog/hk.js";
import { searchMacao } from "./catalog/mo.js";
import { strictMark } from "./match.js";
import { safeFetch } from "./http.js";
import { datasetIdFromMacaoDetailUrl, findVerifiedMacaoDatasetIdByApiUrl, inspectMacaoDatasetDetail, resolveMacaoApiAccess } from "./macao-auth.js";
import type { SearchResult } from "./types.js";

const RegionSchema = z.enum(["HK", "MO"]);

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

serveStdio(() => {
  const server = new McpServer({
    name: "hkmo-open-data-mcp",
    version: "0.1.0",
    description: "Strict Hong Kong and Macao government open-data discovery and access. Never substitute similar data."
  });

  server.registerTool("resolve_region", {
    description: "Resolve whether a request is for Hong Kong or Macao. If not explicit, return a clarification question instead of guessing.",
    inputSchema: z.object({ query: z.string().min(1), region: RegionSchema.optional() })
  }, async ({ query, region }) => textResult(resolveRegion(query, region)));

  server.registerTool("search_datasets", {
    description: "Search official HK/MO government open-data metadata. Region is mandatory. Similar datasets are candidates only; they must never be silently substituted for the requested dataset.",
    inputSchema: z.object({
      query: z.string().min(1),
      region: RegionSchema,
      discoveryKeywords: z.array(z.string()).max(12).optional().describe("Optional multilingual synonyms used only to discover candidates, never to relax final matching."),
      limit: z.number().int().min(1).max(20).default(10)
    })
  }, async ({ query, region, discoveryKeywords = [], limit }) => {
    const raw = region === "HK"
      ? await searchHongKong(query, discoveryKeywords, limit)
      : await searchMacao(query, discoveryKeywords, limit);
    const marked = strictMark(query, raw);
    const exact = marked.filter((x) => x.match === "exact");
    const result: SearchResult = exact.length ? {
      status: "FOUND",
      region,
      query,
      candidates: exact,
      message: "Exact metadata match found. Verify the official detail/resource before use."
    } : marked.length ? {
      status: "NOT_FOUND",
      region,
      query,
      candidates: marked,
      message: "未找到完全符合要求的政府公開數據。以下只係候選相關資料，不得代替使用。"
    } : {
      status: region === "MO" ? "DISCOVERY_LIMITED" : "NOT_FOUND",
      region,
      query,
      candidates: [],
      message: region === "MO"
        ? "澳門本機 registry 未找到相符資料。請使用官方 data.gov.mo 搜尋並將官方 Detail URL 交給 inspect_official_url；不得用相似資料代替。"
        : "未找到完全符合要求的政府公開數據。"
    };
    return textResult(result);
  });

  server.registerTool("inspect_official_url", {
    description: "Inspect an official HK/MO government HTTPS URL. For data.gov.mo Detail URLs, resolve the SPA's official runtime metadata, current APPCODE availability, and published apiPath without exposing the APPCODE value.",
    inputSchema: z.object({
      url: z.string().url(),
      maxBytes: z.number().int().min(1024).max(2_000_000).default(500_000)
    })
  }, async ({ url, maxBytes }) => {
    const datasetId = datasetIdFromMacaoDetailUrl(url);
    if (datasetId) return textResult(await inspectMacaoDatasetDetail(datasetId));

    const res = await safeFetch(url, {}, maxBytes);
    return textResult({ ...res, text: res.text.slice(0, maxBytes) });
  });

  server.registerTool("call_official_api", {
    description: "Call a verified official HK/MO government API. For verified Macao data.gov.mo API-gateway datasets, if Authorization is omitted the MCP resolves the current public APPCODE from official runtime metadata and injects it ephemerally. Never invent tokens, headers, or parameters.",
    inputSchema: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).default("GET"),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
      datasetId: z.string().uuid().optional().describe("Optional data.gov.mo dataset UUID used to resolve the official runtime APPCODE. If omitted, the MCP may infer it only from a verified registry resource URL."),
      maxBytes: z.number().int().min(1024).max(2_000_000).default(1_000_000)
    })
  }, async ({ url, method, headers, body, datasetId, maxBytes }) => {
    const outgoing = new Headers(headers ?? {});
    let autoAuth = false;
    let resolvedDatasetId = datasetId;

    const host = new URL(url).hostname.toLowerCase();
    const isMacaoGateway = host.endsWith(".apigateway.data.gov.mo");
    if (isMacaoGateway && !outgoing.has("authorization")) {
      resolvedDatasetId ??= findVerifiedMacaoDatasetIdByApiUrl(url) ?? undefined;
      if (!resolvedDatasetId) {
        throw new Error("Missing Authorization and no verified data.gov.mo dataset could be mapped to this API URL. Inspect the official Detail URL and pass datasetId.");
      }

      const access = await resolveMacaoApiAccess(resolvedDatasetId, url);
      outgoing.set("authorization", `APPCODE ${access.appCode}`);
      autoAuth = true;
    }

    let res = await safeFetch(url, { method, headers: outgoing, body }, maxBytes);

    if (autoAuth && method === "GET" && [400, 401, 403].includes(res.status) && resolvedDatasetId) {
      const refreshed = await resolveMacaoApiAccess(resolvedDatasetId, url, true);
      outgoing.set("authorization", `APPCODE ${refreshed.appCode}`);
      res = await safeFetch(url, { method, headers: outgoing, body }, maxBytes);
    }

    return textResult({
      ...res,
      auth: autoAuth ? {
        scheme: "APPCODE",
        source: "official data.gov.mo runtime metadata",
        injected: true,
        value: "[redacted]",
        datasetId: resolvedDatasetId
      } : { injected: false },
      text: res.text.slice(0, maxBytes)
    });
  });

  return server;
});
