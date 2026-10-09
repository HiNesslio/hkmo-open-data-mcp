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
9. JSON, XML, CSV and XLSX use query_dataset. Shapefile ZIP requires the dedicated inspect_shapefile_zip / export_shapefile tools. Generic ZIP and legacy XLS remain unsupported. Do not fabricate a parse result.
10. A network outage or authentication failure is not evidence that a dataset is nonexistent.

## Example

User: `幫我拎停車場空位資料`

Correct response: `你想查香港定澳門嘅資料？`

User: `澳門，實時空位`

Then search specifically for Macao **real-time parking vacancy**. A dataset containing only car-park locations, tariffs or opening hours is not acceptable.

## Geospatial/Shapefile ZIP workflow (v0.3)

When a user wants to use a HK/MO government Shapefile ZIP, first verify region and the exact official dataset as usual.

**Before generating the deliverable, ask a single question if the user has not already specified their preferred output:**

「你需要邊種輸出？① GeoJSON 原始檔案；② 可互動地圖（MapLibre HTML 或 React／Mapbox）；③ Python GeoPandas 靜態圖片（PNG）？」

The MCP tool `export_shapefile` without `outputMode` returns `NEEDS_OUTPUT_CHOICE`; ask the user using its choices and stop. Do NOT choose an arbitrary output type based on popularity. Do not render an image as a substitute for GeoJSON or a real interactive map.

- `inspect_shapefile_zip` inspects safe ZIP metadata, layers, required .shp/.dbf and CRS status.
- `export_shapefile`: pass `outputMode: "geojson" | "interactive_map" | "python_image"` only after the user has chosen.
- For an interactive map, `mapEngine: "maplibre_html"` outputs a standalone HTML file and bundled geometry data; `"react_mapbox"` outputs React/Mapbox component source code plus GeoJSON files. React output is NOT a hosted website. Mapbox requires the user's own token.
- For a Python image, generate the GeoPandas Python script; only claim that a PNG exists when the tool reports successful execution.
- ZIP source: use official verified resource ID, or the user can first manually download the official ZIP to `HKMO_GEO_INPUT_DIR` and provide its file name (`inputFile`). NEVER invent a government download URL or token.
- Projection: require .prj. Without .prj, require the user to explicitly confirm EPSG:4326; do not assume or guess Macao Grid, HK1980 Grid or GCJ-02. A declared non-WGS84 CRS without a proper .prj must fail.
- Respect safety limits, feature bounds and official attribution; clearly state that artifacts live on the local MCP host. Do not claim the host client has automatically attached those files.

## Macao Grid datum shift verification (v0.3.1)

Macao government Shapefile ZIPs may use `Macau_Grid / D_Macau` WKT without datum transformation parameters. **Never treat a successful Shapefile read or plausible longitude/latitude as evidence of a correct WGS84 transformation.**

For a verified matching Macao 1920 / Macao Grid source, the local geo conversion helper uses Python `pyproj` and `pyshp`, replacing that incomplete source datum with **EPSG:8433**, and requires the **Macao 1920 to WGS 84 (1)** transformation **EPSG:8438** (Molodensky-Badekas, accuracy approximately 1m). It selects with `always_xy=True`, `allow_ballpark=False` and checks the actual operation description and accuracy before exporting.

**Always inspect `transformations[]` in the tool result** and cite both source and target CRS. If `DATUM_TRANSFORM_UNAVAILABLE` or `PYTHON_DEPENDENCY_REQUIRED` appears, stop; do not output shifted GeoJSON or maps. A nonmatching or unfamiliar projection may NEVER be coerced to EPSG:8433 merely because the dataset is from Macao.

Install the optional local Python runtime: `python3 -m pip install pyproj pyshp`. GeoPandas and matplotlib remain additional dependencies only for generating a PNG image.

## Hong Kong official road geometry (CSDI)

When users request Hong Kong road geometry, road networks, or non-straight spatial lines for a map, do not fabricate road curves by connecting point endpoints. Discover **Hong Kong CSDI** official spatial data separately from DATA.GOV.HK dataset data:
- `inspect_csdi_layers` without a source lists the supported official CSDI sources.
- `inspect_csdi_layers(source:"road_centreline")`: Lands Department Road Centreline, for visually accurate street centre lines **only** (source explicitly says approximate location/map labelling).
- `inspect_csdi_layers(source:"road_network")`: Transport Department Road Network, for network geometry and direction/restriction attributes. Review selected layer fields and geometry type before relying on road topology.
- Select the **published layer ID** found by inspect; never hard-code or guess its number.
- Use `query_csdi_geometry` for a small GeoJSON line preview, or `export_csdi_geometry` with a Hong Kong WGS84 bounding box for a local GeoJSON, MapLibre/React-Mapbox interactive map, or Python GeoPandas image. If output is unspecified, ask the user which of those three formats they want.
- CSDI is requested through its official ArcGIS REST FeatureServer, not its discontinued Data Query Service (DQS). Do not confuse a WMS raster map image with actual line geometry.
- Every CSDI request is spatially bounded and returns a **limited page**, not the whole Hong Kong road network. `mayHaveMore` and `nextOffset` must be disclosed. Never claim that a single page is exhaustive.
- The source GeoJSON from DATA.GOV.HK and the CSDI road geometry are **separate datasets**. Overlaying CSDI road lines is supported, but automatically matching bus routes to roads is NOT. Only join by verified shared IDs or a separately validated, quality-checked routing/map-matching process. Never choose a nearby road solely because it is nearest or looks plausible.
- Both source and CSDI dataset links must appear in results. Preserve all original coordinates rather than replacing user data silently.
- Hong Kong CSDI GeoJSON results are WGS84 longitude/latitude; reject metre-scale projected coordinates in GeoJSON.
Official sources: https://portal.csdi.gov.hk/csdi-webpage/dataset/landsd_rcd_1637310758814_80061 and https://portal.csdi.gov.hk/csdi-webpage/dataset/td_rcd_1638949160594_2844
