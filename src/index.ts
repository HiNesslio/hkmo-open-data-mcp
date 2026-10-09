#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { resolveRegion } from "./region.js";
import { searchHongKong } from "./catalog/hk.js";
import { searchMacao } from "./catalog/mo.js";
import { strictMark } from "./match.js";
import { assertOfficialUrl, safeFetch } from "./http.js";
import { datasetIdFromMacaoDetailUrl, inspectMacaoDatasetDetail, requireVerifiedMacaoDataset } from "./macao-auth.js";
import { inspectDataset, boundRequest, bindResource } from "./access.js";
import { parseData } from "./data-reader.js";
import { inspectGeoZip, exportShapefile } from "./geo.js";
import { HK_CSDI_SOURCES, inspectCsdiLayers, fetchCsdiGeometry, exportCsdiGeometry, fetchCsdiBusRoute, exportCsdiBusRoute } from "./csdi.js";
import type { Region, SearchResult } from "./types.js";

const regionSchema=z.enum(["HK","MO"]);
const paramsSchema=z.record(z.string(),z.string().max(100)).optional();
const genericOutput=z.object({status:z.string()}).passthrough();
function result(data:Record<string,unknown>,isError=false) {
  const encoded=JSON.stringify(data);
  return {content:[{type:"text" as const,text:encoded.length>50_000?encoded.slice(0,50_000)+"…":encoded}],structuredContent:data,isError};
}
function error(e:unknown) {
  const message=e instanceof Error?e.message:String(e);
  const code=/not verified|manual_required|deprecated/i.test(message)?"UNVERIFIED_DATASET"
    :/Missing|Invalid|Undocumented|forbidden|does not match|not allowed|Unsupported/i.test(message)?"INVALID_REQUEST"
    :/HTTP 429/.test(message)?"RATE_LIMITED"
    :/HTTP [45]\d\d|fetch failed|timed out|abort/i.test(message)?"SOURCE_UNAVAILABLE":"QUERY_FAILED";
  return result({status:"ERROR",code,message},true);
}
const protect=async(f:()=>Promise<Record<string,unknown>>) => {
  try{return result(await f());}catch(e){return error(e);}
};

serveStdio(()=>{
  const server=new McpServer({name:"hkmo-open-data-mcp",version:"0.5.1",description:"Verified HK/MO government open data, secure API access, structured reading and Shapefile ZIP exports."});

  server.registerTool("resolve_region",{
    description:"Determine Hong Kong or Macao; when ambiguous ask instead of guessing.",
    inputSchema:z.object({query:z.string().min(1),region:regionSchema.optional()})
  },async({query,region})=>result({status:"OK",...resolveRegion(query,region)}));

  server.registerTool("search_datasets",{
    description:"Discover official metadata. Only an exact verified title/curated alias can be FOUND; description token matches are never proof.",
    inputSchema:z.object({query:z.string().min(1),region:regionSchema,discoveryKeywords:z.array(z.string()).max(12).optional(),limit:z.number().int().min(1).max(20).default(10)}),
    outputSchema:genericOutput
  },async({query,region,discoveryKeywords=[],limit})=>protect(async()=>{
    const raw=region==="HK"?await searchHongKong(query,discoveryKeywords,limit):await searchMacao(query,discoveryKeywords,limit);
    const marked=strictMark(query,raw);
    const exact=marked.filter(x=>x.match==="exact");
    const found:SearchResult=exact.length?{status:"FOUND",region,query,candidates:exact,message:"Exact verified dataset metadata match; resource access remains separately verified."}:
      marked.length?{status:"NOT_FOUND",region,query,candidates:marked,message:"只找到相關／未驗證候選，不能代替原要求。"}:
      {status:region==="MO"?"DISCOVERY_LIMITED":"NOT_FOUND",region,query,candidates:[],message:"未找到完全相符的官方資料；搜尋目錄未必完整。"};
    return found as unknown as Record<string,unknown>;
  }));

  server.registerTool("inspect_official_url",{
    description:"Inspect HTTPS government URL; Macao SPA Detail uses official metadata without exposing APPCODE.",
    inputSchema:z.object({url:z.string().url(),maxBytes:z.number().int().min(1024).max(2_000_000).default(200_000)}),
    outputSchema:genericOutput
  },async({url,maxBytes})=>protect(async()=>{
    const id=datasetIdFromMacaoDetailUrl(url);
    if(id) {
      requireVerifiedMacaoDataset(id);
      return {status:"OK",...(await inspectMacaoDatasetDetail(id))};
    }
    assertOfficialUrl(url);
    const r=await safeFetch(url,{},maxBytes);
    return {status:r.status===200?"OK":"SOURCE_UNAVAILABLE",url:r.url,httpStatus:r.status,contentType:r.contentType,text:r.text.slice(0,maxBytes)};
  }));

  server.registerTool("inspect_dataset",{
    description:"Inspect a verified dataset: title, publisher, frequency, available formats and resources. No data download required.",
    inputSchema:z.object({region:regionSchema,datasetId:z.string().min(1).max(160)}),
    outputSchema:genericOutput
  },async({region,datasetId})=>protect(async()=>({status:"OK",dataset:await inspectDataset(region,datasetId)})));

  server.registerTool("list_resources",{
    description:"List approved official resources and required path/query parameter names for a verified dataset.",
    inputSchema:z.object({region:regionSchema,datasetId:z.string().min(1).max(160)}),
    outputSchema:genericOutput
  },async({region,datasetId})=>protect(async()=>{
    const dataset=await inspectDataset(region,datasetId);
    return {status:"OK",datasetId,region,detailUrl:dataset.detailUrl,resources:dataset.resources};
  }));

  server.registerTool("query_dataset",{
    description:"Read only a verified official resource. Structured JSON/XML/CSV/XLSX output with row limits, columns, provenance. No guessed endpoints or parameters.",
    inputSchema:z.object({
      region:regionSchema,datasetId:z.string().min(1).max(160),
      resourceId:z.number().int().min(0).default(0),
      pathParams:paramsSchema,queryParams:paramsSchema,
      body:z.string().max(32768).optional(),
      limit:z.number().int().min(1).max(50).default(20),offset:z.number().int().min(0).max(10000).default(0),
      fields:z.array(z.string()).max(30).optional()
    }),
    outputSchema:genericOutput
  },async(args)=>protect(async()=>{
    const {dataset,resource,result:r}=await boundRequest(args);
    const data=await parseData(r,{limit:args.limit,offset:args.offset,fields:args.fields,format:resource.format});
    return {status:"OK",datasetId:dataset.id,datasetTitle:dataset.title,officialSource:dataset.detailUrl,updateFrequency:dataset.updateFrequency,resourceId:resource.id,...data};
  }));


  server.registerTool("inspect_shapefile_zip",{
    description:"Inspect a verified government Shapefile ZIP: validate archive safety, layers, .dbf/.prj presence, projection declaration and sizes. For local ZIP, set HKMO_GEO_INPUT_DIR and pass inputFile (filename only).",
    inputSchema:z.object({
      region:regionSchema,datasetId:z.string().min(1).max(160),
      resourceId:z.number().int().min(0).default(0),
      inputFile:z.string().max(180).optional(),
      declaredCrs:z.enum(["EPSG:4326"]).optional()
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>await inspectGeoZip(args)));

  server.registerTool("export_shapefile",{
    description:"Convert a verified Shapefile ZIP to real local artifacts. IMPORTANT: if the user has not chosen output, call without outputMode and ASK the user to choose raw GeoJSON, interactive map (MapLibre HTML or React Mapbox), or Python GeoPandas PNG. Output paths are local to the MCP host. Requires .prj, or explicit EPSG:4326 for missing .prj. React Mapbox needs user token. No invented government download URLs.",
    inputSchema:z.object({
      region:regionSchema,datasetId:z.string().min(1).max(160),
      resourceId:z.number().int().min(0).default(0),
      inputFile:z.string().max(180).optional(),
      declaredCrs:z.enum(["EPSG:4326"]).optional(),
      outputMode:z.enum(["geojson","interactive_map","python_image"]).optional(),
      mapEngine:z.enum(["maplibre_html","react_mapbox"]).optional()
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>await exportShapefile(args)));


  const csdiSource=z.enum(["road_centreline","road_network","bus_route"]);
  const csdiRoadSource=z.enum(["road_centreline","road_network"]);
  const bboxSchema=z.tuple([z.number(),z.number(),z.number(),z.number()]);
  server.registerTool("inspect_csdi_layers",{
    description:"Inspect official Hong Kong CSDI layers, including TD Bus Route polylines (for real bus-route bends), Road Centreline (roads), and Road Network (roads). Always discover the layer ID and fields before querying.",
    inputSchema:z.object({source:csdiSource.optional()}),outputSchema:genericOutput
  },async({source})=>protect(async()=>source
    ? (await inspectCsdiLayers(source) as unknown as Record<string,unknown>)
    : {status:"OK",sources:HK_CSDI_SOURCES,
       note:"Choose one official source, then inspect its published layer IDs. Never guess a layer ID."}));

  server.registerTool("query_csdi_geometry",{
    description:"Preview a SMALL bounded page of official CSDI line features as WGS84 GeoJSON. Hong Kong only. For a full local GeoJSON/interactive map/Python PNG use export_csdi_geometry. This is an independent road layer, not a bus-route snap.",
    inputSchema:z.object({
      source:csdiRoadSource,layerId:z.number().int().min(0),bbox:bboxSchema,
      limit:z.number().int().min(1).max(10).default(5),offset:z.number().int().min(0).max(100000).default(0)
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>{
    const {collection,...meta}=await fetchCsdiGeometry(args);
    return {...meta,features:collection.features};
  }));

  server.registerTool("export_csdi_geometry",{
    description:"Export verified Hong Kong CSDI road LINE geometries from an inspected FeatureServer layer to GeoJSON, interactive MapLibre/React Mapbox, or Python GeoPandas image. Ask for outputMode first if unspecified. Bound queries avoid pretending to download the entire network. Never auto-join bus-stop lines to roads by proximity.",
    inputSchema:z.object({
      source:csdiSource,layerId:z.number().int().min(0),bbox:bboxSchema,
      limit:z.number().int().min(1).max(200).default(100),
      offset:z.number().int().min(0).max(100000).default(0),
      outputMode:z.enum(["geojson","interactive_map","python_image"]).optional(),
      mapEngine:z.enum(["maplibre_html","react_mapbox"]).optional()
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>await exportCsdiGeometry(args)));


  server.registerTool("query_csdi_bus_route",{
    description:"Read the actual Transport Department CSDI Bus Route polyline for a specified official ROUTE_ID or bus route name. This is NOT a road-centreline snap or straight stop-to-stop segments. Preserve ROUTE_SEQ; do NOT assume 1=outbound or 2=inbound. Inspect bus_route layer first to get its published layer ID.",
    inputSchema:z.object({
      layerId:z.number().int().min(0),routeId:z.string().min(1).max(48).optional(),
      routeNumber:z.string().min(1).max(48).optional(),
      routeSeq:z.number().int().min(1).max(99).optional(),
      limit:z.number().int().min(1).max(5).default(5),
      offset:z.number().int().min(0).max(10000).default(0)
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>{
    const {collection,...meta}=await fetchCsdiBusRoute(args);
    return {...meta,features:collection.features};
  }));

  server.registerTool("export_csdi_bus_route",{
    description:"Export actual TD CSDI franchised bus route polyline bends in GeoJSON, MapLibre/React Mapbox, or GeoPandas PNG. Select route by official routeId or routeNumber; preserve ROUTE_SEQ, never guess outward/inward directions. Ask for outputMode when absent.",
    inputSchema:z.object({
      layerId:z.number().int().min(0),routeId:z.string().min(1).max(48).optional(),
      routeNumber:z.string().min(1).max(48).optional(),
      routeSeq:z.number().int().min(1).max(99).optional(),
      limit:z.number().int().min(1).max(20).default(10),
      offset:z.number().int().min(0).max(10000).default(0),
      outputMode:z.enum(["geojson","interactive_map","python_image"]).optional(),
      mapEngine:z.enum(["maplibre_html","react_mapbox"]).optional()
    }),outputSchema:genericOutput
  },async(args)=>protect(async()=>await exportCsdiBusRoute(args)));

  server.registerTool("call_official_api",{
    description:"Legacy compatibility. Only registered resources of a verified dataset can be called; user Authorization, arbitrary URLs, methods and unverified datasets are blocked. Prefer query_dataset.",
    inputSchema:z.object({
      url:z.string().url(),datasetId:z.string().min(1).max(160),
      region:regionSchema,
      method:z.enum(["GET","POST"]).default("GET"),
      resourceId:z.number().int().min(0).default(0),
      pathParams:paramsSchema,queryParams:paramsSchema,
      headers:z.record(z.string(),z.string()).optional(),body:z.string().max(32768).optional(),
      maxBytes:z.number().int().min(1024).max(2_000_000).default(1_000_000)
    }),
    outputSchema:genericOutput
  },async(args)=>protect(async()=>{
    if(Object.keys(args.headers??{}).some(k=>k.toLowerCase()!=="accept"))throw new Error("Manual authentication/headers forbidden; the MCP resolves approved credentials itself.");
    // Validate the legacy URL and HTTP method BEFORE issuing any request.
    const meta=await inspectDataset(args.region,args.datasetId);
    const declared=meta.resources[args.resourceId];
    if(!declared)throw new Error("Resource ID not found");
    const expected=bindResource(declared,args.pathParams,args.queryParams);
    if(new URL(expected).toString()!==new URL(args.url).toString())throw new Error("URL does not match the verified dataset resource");
    if(args.method!==declared.method)throw new Error("Method does not match the verified dataset resource");
    const bound=await boundRequest(args);
    if(bound.result.status<200||bound.result.status>=300)throw new Error(`Upstream HTTP ${bound.result.status}`);
    const text=Buffer.from(bound.result.bytes).toString("utf8");
    return {status:"OK",url:bound.result.url,contentType:bound.result.contentType,httpStatus:bound.result.status,
      datasetId:args.datasetId,officialSource:bound.dataset.detailUrl,text:text.slice(0,args.maxBytes)};
  }));
  return server;
});
