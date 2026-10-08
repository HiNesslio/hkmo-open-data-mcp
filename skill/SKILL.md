---
name: hkmo-government-open-data
description: Find and use Hong Kong or Macao government open data through hkmo-open-data-mcp with strict region and exact-dataset rules.
---

# HK/MO Government Open Data Skill

Use this skill when a user asks to find, inspect, or retrieve Hong Kong or Macao government open data or API data.

## Non-negotiable rules

1. **Region must be explicit.** If the user has not clearly specified Hong Kong or Macao, ask: `你想查香港定澳門嘅資料？` Do not infer from topic, language, prior popularity, or a similar dataset.
2. **Exact data only.** A semantically related dataset is not a substitute. If the requested metric, time basis, granularity, geography, or real-time/static nature does not match, answer that the requested government open data was not found.
3. **Never silently substitute.** Candidates may be shown as related references only and must be labelled as different.
4. **Official-source boundary.** Dataset claims must be grounded in official `gov.hk` / `gov.mo` sources. Third-party mirrors, GitHub repos, blogs, and reverse-engineered endpoints are not authoritative replacements.
5. **Do not invent authentication.** Never guess API keys, bearer tokens, cookies, CSRF values, Referer headers, or request parameters. For Macao data.gov.mo APIs, allow the MCP to resolve the current public APPCODE at runtime from the official dataset metadata flow; never copy an old APPCODE from examples, GitHub, memory, or the registry.
6. **Secrets stay local.** User/private credentials must be provided via environment/client configuration, never written to this skill, registry, logs, or repository.
7. **Discovery synonyms are not matching rules.** English/Chinese/Portuguese synonyms may be used to find candidates, but the final dataset still has to satisfy the original request exactly.
8. **Verification status is binding.** A dataset marked `manual_required` is discovery-only and can never be treated as exact/FOUND or called. A `deprecated` dataset must not be used.

## Required workflow

1. Call `resolve_region` unless region is already explicit.
2. If clarification is required, ask the user and stop.
3. Call `search_datasets` with the original request and region. Add `discoveryKeywords` only as search aids.
4. If status is `FOUND`, confirm the selected dataset is `verified`, then call `inspect_dataset` and `list_resources`. Exact only means a complete official title or verified curated alias; keywords in descriptions can NEVER promote candidates.
5. If status is `NOT_FOUND`, say the requested dataset was not found. A `manual_required` or semantically similar candidate may be mentioned as unverified/related context only; do not call it.
6. If Macao returns `DISCOVERY_LIMITED`, search `data.gov.mo` using the host application's web capability if available, then pass only an official `data.gov.mo`/`api.data.gov.mo` URL to `inspect_official_url`. If no official exact match is found, return not found.
7. Prefer `query_dataset(region,datasetId,resourceId,...)`, allowing the MCP to validate the selected official resource, read bounded JSON/XML/CSV/XLSX, and attach provenance. Do not invent parameter names or values; list resources first.
8. The legacy `call_official_api` also requires region, datasetId and resourceId, and the supplied URL/method must match the bound resource exactly. NEVER supply custom Authorization for Macao: the MCP injects an ephemeral official APPCODE itself.
9. When XLS, generic ZIP, Shapefile or an unverifiable download is encountered, report an explicit unsupported/unavailable state; do not fabricate a parse result.
10. A network outage or authentication failure is not evidence that a dataset is nonexistent.

## Example

User: `幫我拎停車場空位資料`

Correct response: `你想查香港定澳門嘅資料？`

User: `澳門，實時空位`

Then search specifically for Macao **real-time parking vacancy**. A dataset containing only car-park locations, tariffs or opening hours is not acceptable.
