import { safeFetch } from "./http.js";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { geoBounds, renderGeoArtifacts, type GeoOutputMode, type MapEngine } from "./geo.js";

export const HK_CSDI_SOURCES = {
  road_centreline: {
    datasetId: "landsd_rcd_1637310758814_80061",
    title: "Road Centreline / 道路中線",
    purpose: "Road shapes for map display / location reference; NOT proof of a bus route or routing topology."
  },
  road_network: {
    datasetId: "td_rcd_1638949160594_2844",
    title: "Road Network / 道路網絡",
    purpose: "Transport Department road network and traffic restrictions; verify layer schema and road identifiers before joining."
  }
} as const;

export type CsdiSource = keyof typeof HK_CSDI_SOURCES;
type Bounds = [number,number,number,number];
type Layer = {id:number;name:string;type?:string;geometryType?:string;defaultVisibility?:boolean};
type GeoFeature = {type:"Feature";geometry:{type:string;coordinates?:any;geometries?:unknown[]}|null;properties:Record<string,unknown>|null};
type GeoFeatureCollection = {type:"FeatureCollection";fileName:string;features:GeoFeature[]};

const ROOT="https://portal.csdi.gov.hk/server/rest/services/common/";
const HK_LIMITS:Bounds=[113.7,22.1,114.6,22.7];
const MAX_BYTES=5_000_000;

export function validateHkBounds(input:number[]):Bounds {
 if(!Array.isArray(input)||input.length!==4||!input.every(Number.isFinite))throw new Error("CSDI_BBOX_INVALID: provide [minLon,minLat,maxLon,maxLat]");
 const [west,south,east,north]=input;
 if(west>=east||south>=north||west<HK_LIMITS[0]||east>HK_LIMITS[2]||south<HK_LIMITS[1]||north>HK_LIMITS[3]) {
   throw new Error("CSDI_BBOX_INVALID: request must be a positive-size bounds within Hong Kong");
 }
 if(east-west>0.08||north-south>0.08)throw new Error("CSDI_BBOX_TOO_LARGE: use a smaller area (up to 0.08 degrees per dimension)");
 return input as Bounds;
}
export function csdiServiceUrl(source:CsdiSource):string {
 const entry=HK_CSDI_SOURCES[source];
 if(!entry)throw new Error("CSDI_SOURCE_UNKNOWN: only verified government sources can be used");
 return ROOT+entry.datasetId+"/FeatureServer";
}
async function jsonFromOfficial(url:string) {
 const response=await safeFetch(url,{},MAX_BYTES);
 if(response.status!==200)throw new Error(`CSDI_SOURCE_UNAVAILABLE: official service returned HTTP ${response.status}`);
 let data:any;try{data=JSON.parse(response.text);}catch{throw new Error("CSDI_INVALID_RESPONSE: expected JSON");}
 if(!data||typeof data!=="object"||data.error)throw new Error("CSDI_SERVICE_ERROR: "+String(data?.error?.message??"invalid service data"));
 return data;
}
export function parseLayerCatalog(raw:unknown):Layer[] {
 const obj=raw as any;
 if(!obj||!Array.isArray(obj.layers))throw new Error("CSDI_INVALID_RESPONSE: no layers found");
 return obj.layers.filter((layer:any)=>Number.isSafeInteger(layer?.id)&&layer.id>=0&&typeof layer.name==="string")
   .map((layer:any)=>({id:layer.id,name:layer.name,type:layer.type,geometryType:layer.geometryType,defaultVisibility:layer.defaultVisibility}));
}
export async function inspectCsdiLayers(source:CsdiSource) {
 const url=csdiServiceUrl(source);
 const result=await jsonFromOfficial(url+"?f=pjson");
 const layers=parseLayerCatalog(result);
 return {
   status:"OK",source,officialDataset:HK_CSDI_SOURCES[source],
   datasetUrl:`https://portal.csdi.gov.hk/csdi-webpage/dataset/${HK_CSDI_SOURCES[source].datasetId}`,
   serviceUrl:url,layers,
   note:"Use a published layer ID; Road Centreline is for approximate location and labelling. Do not infer bus paths from straight-line route points."
 };
}
export function validateCsdiGeojson(data:unknown,maxFeatures:number):GeoFeatureCollection {
 const body=data as any;
 if(!body||body.type!=="FeatureCollection"||!Array.isArray(body.features))throw new Error("CSDI_INVALID_GEOJSON: expected FeatureCollection");
 if(body.features.length>maxFeatures)throw new Error("CSDI_FEATURE_LIMIT: service returned more features than requested");
 const features=body.features as GeoFeature[];
 if(features.some(f=>f?.type!=="Feature"||!f.geometry||!["LineString","MultiLineString"].includes(f.geometry.type))) {
   throw new Error("CSDI_UNEXPECTED_GEOMETRY: requested a road line layer, but non-line geometry was returned");
 }
 // Reject invalid WGS84 or a result silently returned in HK1980 grid.
 if(features.length)geoBounds([{type:"FeatureCollection",features}] as any);
 return {type:"FeatureCollection",fileName:"hk-csdi-road-geometry",features};
}
export async function fetchCsdiGeometry(args:{source:CsdiSource;layerId:number;bbox:number[];limit?:number;offset?:number}) {
 const bbox=validateHkBounds(args.bbox);
 if(!Number.isSafeInteger(args.layerId)||args.layerId<0)throw new Error("CSDI_LAYER_INVALID");
 const limit=Math.min(200,Math.max(1,args.limit??100));
 const offset=args.offset??0;
 if(!Number.isSafeInteger(offset)||offset<0||offset>100_000)throw new Error("CSDI_OFFSET_INVALID");
 const service=csdiServiceUrl(args.source);
 const catalog=parseLayerCatalog(await jsonFromOfficial(service+"?f=pjson"));
 const layer=catalog.find(l=>l.id===args.layerId);
 if(!layer)throw new Error("CSDI_LAYER_UNKNOWN: layer ID was not found in official service metadata");
 const layerInfo=await jsonFromOfficial(`${service}/${layer.id}?f=pjson`);
 if(layerInfo.geometryType!=="esriGeometryPolyline") {
   throw new Error("CSDI_NOT_ROAD_LINES: selected layer is not polyline geometry");
 }
 const pointBounds={xmin:bbox[0],ymin:bbox[1],xmax:bbox[2],ymax:bbox[3],spatialReference:{wkid:4326}};
 const url=new URL(`${service}/${layer.id}/query`);
 url.searchParams.set("f","geojson");
 url.searchParams.set("where","1=1");
 url.searchParams.set("geometry",JSON.stringify(pointBounds));
 url.searchParams.set("geometryType","esriGeometryEnvelope");
 url.searchParams.set("spatialRel","esriSpatialRelIntersects");
 url.searchParams.set("inSR","4326");
 url.searchParams.set("outSR","4326");
 url.searchParams.set("returnGeometry","true");
 url.searchParams.set("outFields","*");
 url.searchParams.set("resultOffset",String(offset));
 url.searchParams.set("resultRecordCount",String(limit));
 const json=await jsonFromOfficial(url.toString());
 const fc=validateCsdiGeojson(json,limit);
 const count=fc.features.length;
 return {
   status:"OK" as const,source:args.source,layerId:layer.id,layerName:layer.name,
   datasetUrl:`https://portal.csdi.gov.hk/csdi-webpage/dataset/${HK_CSDI_SOURCES[args.source].datasetId}`,
   requestUrl:url.toString(),bbox,
   featureCount:count,offset,limit,
   mayHaveMore:count===limit||Boolean(json.exceededTransferLimit),
   nextOffset:count===limit?offset+count:null,
   collection:fc,
   warning:"This is an official CSDI road-geometry layer, not an automatically matched bus route. Never infer route direction, navigation or road connections from proximity alone."
 };
}
export async function exportCsdiGeometry(args:{
 source:CsdiSource;layerId:number;bbox:number[];limit?:number;offset?:number;
 outputMode?:GeoOutputMode;mapEngine?:MapEngine
}) {
 if(!args.outputMode)return {
   status:"NEEDS_OUTPUT_CHOICE" as const,
   question:"你想輸出 GeoJSON 原始資料、可互動地圖，還是 Python 地圖圖片？",
   choices:["geojson","interactive_map","python_image"],
   note:"CSDI geometry is a separate official road layer; a bus path requires verified mapping, not nearest-line guesses."
 };
 const query=await fetchCsdiGeometry(args);
 if(!query.featureCount)throw new Error("CSDI_EMPTY_GEOMETRY: no road line features found inside this bounding box");
 const art=await renderGeoArtifacts({layers:[query.collection],bounds:geoBounds([query.collection] as any),
   outputMode:args.outputMode,mapEngine:args.mapEngine});
 // Every exported file gets durable source metadata; visual similarity never implies a verified join.
 const provenanceFile=join(dirname(art.artifactPath),"source.json");
 await writeFile(provenanceFile,JSON.stringify({
   source:"Hong Kong CSDI",datasetUrl:query.datasetUrl,requestUrl:query.requestUrl,
   sourceId:query.source,layerId:query.layerId,layerName:query.layerName,
   crs:"EPSG:4326",bounds:query.bbox,featureCount:query.featureCount,
   mayHaveMore:query.mayHaveMore,warning:query.warning
 },null,2),{mode:0o600});
 return {
   status:art.status,source:query.source,layerId:query.layerId,layerName:query.layerName,
   officialSource:query.datasetUrl,requestUrl:query.requestUrl,
   featureCount:query.featureCount,mayHaveMore:query.mayHaveMore,nextOffset:query.nextOffset,provenanceFile,
   warning:query.warning,...art
 };
}
