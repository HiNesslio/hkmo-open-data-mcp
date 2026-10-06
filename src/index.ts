#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { resolveRegion } from "./region.js";
import { searchHongKong } from "./catalog/hk.js";
import { searchMacao } from "./catalog/mo.js";
import { strictMark } from "./match.js";
import { safeFetch } from "./http.js";
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
        ? "澳門 v0.1 本機 registry 未找到相符資料。請使用官方 data.gov.mo 搜尋並將官方 Detail URL 交給 inspect_official_url；不得用相似資料代替。"
        : "未找到完全符合要求的政府公開數據。"
    };
    return textResult(result);
  });

  server.registerTool("inspect_official_url", {
    description: "Fetch and inspect an official HK/MO government HTTPS URL only. Useful after discovery of an official dataset/detail/API URL.",
    inputSchema: z.object({
      url: z.string().url(),
      maxBytes: z.number().int().min(1024).max(2_000_000).default(500_000)
    })
  }, async ({ url, maxBytes }) => {
    const res = await safeFetch(url, {}, maxBytes);
    return textResult({ ...res, text: res.text.slice(0, maxBytes) });
  });

  server.registerTool("call_official_api", {
    description: "Call a verified official HK/MO government API. Only allowlisted government HTTPS domains are accepted. Do not invent tokens, headers, or parameters.",
    inputSchema: z.object({
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).default("GET"),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
      maxBytes: z.number().int().min(1024).max(2_000_000).default(1_000_000)
    })
  }, async ({ url, method, headers, body, maxBytes }) => {
    const res = await safeFetch(url, { method, headers, body }, maxBytes);
    return textResult({ ...res, text: res.text.slice(0, maxBytes) });
  });

  return server;
});
