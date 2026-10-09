import { readFile, realpath, mkdir, mkdtemp, writeFile, stat } from "node:fs/promises";
import { join, resolve, basename, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDataset, boundRequest } from "./access.js";
import type { Region } from "./types.js";

export type GeoOutputMode="geojson"|"interactive_map"|"python_image";
export type MapEngine="maplibre_html"|"react_mapbox";
type Feature={type:"Feature";geometry:any;properties:Record<string,unknown>|null;id?:string|number};
type FeatureCollection={type:"FeatureCollection";features:Feature[];fileName?:string};
const MAX_ZIP=12_000_000,MAX_EXPANDED=64_000_000,MAX_FEATURES=100_000;
function reject(code:string,detail:string):never {throw new Error(`${code}: ${detail}`);}
function layerStem(name:string){return name.replace(/\\/g,"/").replace(/\.(shp|shx|dbf|prj|cpg)$/i,"").toLowerCase();}
function ext(name:string):string {return name.split(".").at(-1)?.toLowerCase()??"";}
export function inspectShapefileArchive(data:Uint8Array,declaredCrs?:string) {
 const b=Buffer.from(data);
 if(b.length<22||b.length>MAX_ZIP)reject("ZIP_SIZE_LIMIT","The ZIP must be no larger than 12 MB");
 let eocd=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65_557);i--)if(b.readUInt32LE(i)===0x06054b50){eocd=i;break;}
 if(eocd<0)reject("INVALID_ZIP","End-of-central-directory record missing");
 if(b.readUInt16LE(eocd+4)!==0||b.readUInt16LE(eocd+6)!==0)reject("UNSUPPORTED_ZIP","Multi-disk ZIP not supported");
 const count=b.readUInt16LE(eocd+10),offset=b.readUInt32LE(eocd+16),dirSize=b.readUInt32LE(eocd+12);
 if(count===0||count===65535||count>128||offset===0xffffffff||dirSize===0xffffffff)reject("UNSUPPORTED_ZIP","Empty/ZIP64/too many ZIP entries");
 if(offset+dirSize>eocd)reject("INVALID_ZIP","Central directory outside archive");
 let position=offset,total=0;
 const layers=new Map<string,Set<string>>();
 for(let i=0;i<count;i++){
   if(position+46>b.length||b.readUInt32LE(position)!==0x02014b50)reject("INVALID_ZIP","Broken central directory");
   const flags=b.readUInt16LE(position+8),method=b.readUInt16LE(position+10);
   const compressed=b.readUInt32LE(position+20),uncompressed=b.readUInt32LE(position+24);
   const nameLen=b.readUInt16LE(position+28),extraLen=b.readUInt16LE(position+30),commentLen=b.readUInt16LE(position+32);
   const name=b.subarray(position+46,position+46+nameLen).toString("utf8");
   if(!nameLen||position+46+nameLen+extraLen+commentLen>b.length)reject("INVALID_ZIP","Truncated ZIP entry");
   if(flags&1||![0,8].includes(method))reject("UNSUPPORTED_ZIP","Encrypted or unsupported ZIP compression");
   if(name.startsWith("/")||name.includes("..")||name.includes("\\")||name.includes("\0")||/^[A-Za-z]:/.test(name))reject("INVALID_ZIP","Unsafe ZIP filename");
   if(uncompressed===0xffffffff||compressed===0xffffffff)reject("UNSUPPORTED_ZIP","ZIP64 entries not supported");
   if(uncompressed>32_000_000|| (compressed>0&&uncompressed>1_000_000&&uncompressed/compressed>200))reject("ZIP_BOMB","Entry size/compression ratio is unsafe");
   total+=uncompressed;
   if(total>MAX_EXPANDED)reject("ZIP_BOMB","Total uncompressed ZIP size exceeds 64 MB");
   const extension=ext(name);
   if(["shp","shx","dbf","prj","cpg"].includes(extension)){
     const stem=layerStem(name); if(!layers.has(stem))layers.set(stem,new Set());
     layers.get(stem)!.add(extension);
   }
   position+=46+nameLen+extraLen+commentLen;
 }
 const valid=[...layers].filter(([,files])=>files.has("shp")&&files.has("dbf"));
 if(valid.length===0)reject("INVALID_SHAPEFILE","ZIP must include paired .shp and .dbf files");
 for(const [name,files] of valid){
   if(!files.has("prj") && declaredCrs!=="EPSG:4326")reject("CRS_REQUIRED",`${name} has no .prj: confirm EPSG:4326 explicitly, or supply an archive with a valid .prj`);
 }
 if(declaredCrs&&declaredCrs!=="EPSG:4326")reject("UNSUPPORTED_CRS","Only explicit EPSG:4326 is accepted for archives without .prj; other CRS require .prj");
 return {layers:valid.map(([name,files])=>({name,files:[...files].sort(),hasPrj:files.has("prj")})),entries:count,compressedBytes:b.length,uncompressedBytes:total,crs:valid.every(([,f])=>f.has("prj"))?"embedded .prj":declaredCrs};
}
function walkGeometry(value:any,visit:(point:number[])=>void,depth=0):void {
 if(depth>16)reject("INVALID_GEOMETRY","Coordinates nested too deeply");
 if(!Array.isArray(value))reject("INVALID_GEOMETRY","Malformed coordinate array");
 if(typeof value[0]==="number"){
   if(value.length<2||!Number.isFinite(value[0])||!Number.isFinite(value[1]))reject("INVALID_GEOMETRY","Invalid coordinates");
   visit(value as number[]);return;
 }
 for(const item of value)walkGeometry(item,visit,depth+1);
}
function geometries(value:any,visit:(point:number[])=>void):void {
 if(!value)return;
 if(value.type==="GeometryCollection"){for(const g of value.geometries??[])geometries(g,visit);return;}
 if(!value.coordinates)return;
 walkGeometry(value.coordinates,visit);
}
export function geoBounds(collections:FeatureCollection[]) {
 const bbox=[Infinity,Infinity,-Infinity,-Infinity];
 for(const layer of collections)for(const feature of layer.features)geometries(feature.geometry,p=>{
   const [x,y]=p;
   if(x< -180||x>180||y< -90||y>90)reject("PROJECTION_INVALID","Coordinates are not WGS84 longitude/latitude. Do not guess projection; supply a valid .prj");
   bbox[0]=Math.min(bbox[0],x);bbox[1]=Math.min(bbox[1],y);bbox[2]=Math.max(bbox[2],x);bbox[3]=Math.max(bbox[3],y);
 });
 if(!Number.isFinite(bbox[0]))reject("EMPTY_GEOMETRY","No valid geometries found");
 return bbox as [number,number,number,number];
}
type TransformInfo={layer:string;sourceCrs:string;targetCrs:string;operation:string;operationEpsg:string|null;accuracyMeters:number;ballpark:boolean};
async function transformZipWithPyproj(zip:Uint8Array,declaredCrs?:string):Promise<{layers:FeatureCollection[];transformations:TransformInfo[]}> {
 const python=process.env.HKMO_PYTHON_BIN??"python3";
 const script=join(dirname(fileURLToPath(import.meta.url)),"geo-transform.py");
 return new Promise((resolve,reject)=>{
   const child=spawn(python,[script,declaredCrs??""],{stdio:["pipe","pipe","pipe"]});
   const chunks:Buffer[]=[];let received=0,errors="";
   let completed=false;
   const finish=(err?:Error,result?:{layers:FeatureCollection[];transformations:TransformInfo[]})=>{
     if(completed)return;completed=true;clearTimeout(timer);
     if(err)reject(err);else resolve(result!);
   };
   const timer=setTimeout(()=>{child.kill("SIGKILL");finish(new Error("GEO_TRANSFORM_TIMEOUT: Python CRS conversion exceeded 40 seconds"));},40_000);
   child.on("error",(e)=>finish(new Error("PYTHON_DEPENDENCY_REQUIRED: Python 3 with pyproj and pyshp is required ("+e.message+")")));
   child.stdout.on("data",(part:Buffer)=>{
     received+=part.byteLength;
     if(received>40_000_000){child.kill("SIGKILL");finish(new Error("GEO_OUTPUT_LIMIT: GeoJSON conversion exceeds 40 MB"));return;}
     chunks.push(Buffer.from(part));
   });
   child.stderr.on("data",(part:Buffer)=>{errors+=part.toString("utf8").slice(0,2000);errors=errors.slice(-2500);});
   child.stdin.on("error",()=>{/* child exit is handled by close */});
   child.stdin.end(Buffer.from(zip));
   child.on("close",(code)=>{
     if(completed)return;
     if(code!==0){finish(new Error("GEO_TRANSFORM_FAILED: "+(errors.trim()||"pyproj conversion exited "+code)));return;}
     try{
       const parsed=JSON.parse(Buffer.concat(chunks).toString("utf8"));
       if(!Array.isArray(parsed.layers)||!Array.isArray(parsed.transformations)||parsed.layers.length!==parsed.transformations.length)throw new Error("Malformed pyproj result");
       if(parsed.transformations.some((x:TransformInfo)=>x.ballpark))throw new Error("Ballpark datum shift is forbidden");
       finish(undefined,parsed);
     }catch(e){finish(new Error("GEO_TRANSFORM_INVALID: "+(e instanceof Error?e.message:String(e))));}
   });
 });
}

export async function parseShapefileZip(zip:Uint8Array,declaredCrs?:string) {
 const info=inspectShapefileArchive(zip,declaredCrs);
 const converted=await transformZipWithPyproj(zip,declaredCrs);
 const layers=converted.layers;
 let total=0;
 for(const layer of layers){
   total+=layer.features.length;
   if(total>MAX_FEATURES)reject("FEATURE_LIMIT","Archive exceeds 100000 features");
   for(const feature of layer.features){
     if(feature.type!=="Feature"||feature.properties && typeof feature.properties!=="object")reject("INVALID_GEOMETRY","Invalid GeoJSON feature");
   }
 }
 if(!total)reject("EMPTY_GEOMETRY","No Shapefile features found");
 return {info,layers,transformations:converted.transformations,bounds:geoBounds(layers),featureCount:total};
}
async function sourceZip(args:{region:Region;datasetId:string;resourceId?:number;inputFile?:string}) {
 if(args.inputFile){
   if(!/\.zip$/i.test(args.inputFile)||args.inputFile.includes("..")||args.inputFile.includes("/")||args.inputFile.includes(String.fromCharCode(92))||[...args.inputFile].some(ch=>ch.charCodeAt(0)<32))reject("INVALID_FILE","Provide a ZIP filename only, no path");
   const inputRoot=process.env.HKMO_GEO_INPUT_DIR;
   if(!inputRoot)reject("INPUT_DIR_REQUIRED","Set HKMO_GEO_INPUT_DIR to the directory containing your government ZIP");
   const base=await realpath(inputRoot),path=await realpath(join(base,args.inputFile));
   if(!path.startsWith(base+sep))reject("INVALID_FILE","File must be inside configured input directory");
   const dataset=await inspectDataset(args.region,args.datasetId);
   const fileStat=await stat(path);
   if(fileStat.size>MAX_ZIP)reject("ZIP_SIZE_LIMIT","File must be <= 12MB");
   return {bytes:await readFile(path),dataset,source:`user-supplied local ZIP: ${basename(path)} (contents not independently authenticated)`};
 }
 const bound=await boundRequest({region:args.region,datasetId:args.datasetId,resourceId:args.resourceId??0,maxBytes:MAX_ZIP});
 if(bound.result.status!==200)reject("SOURCE_UNAVAILABLE",`Official resource returned HTTP ${bound.result.status}`);
 if(!/zip|octet-stream/i.test(bound.result.contentType)&&!bound.result.url.toLowerCase().endsWith(".zip")&&
    !Buffer.from(bound.result.bytes).subarray(0,2).equals(Buffer.from("PK")))reject("INVALID_ZIP","Official resource is not a ZIP");
 return {bytes:bound.result.bytes,dataset:bound.dataset,source:bound.result.url};
}
export async function inspectGeoZip(args:{region:Region;datasetId:string;resourceId?:number;inputFile?:string;declaredCrs?:string}) {
 const {bytes,dataset,source}=await sourceZip(args);
 const parsed=await parseShapefileZip(bytes,args.declaredCrs);
 return {status:"OK",datasetId:dataset.id,officialSource:dataset.detailUrl,zipSource:source,...parsed.info,
  transformations:parsed.transformations,featureCount:parsed.featureCount,bounds:parsed.bounds};
}
const pythonScript=`#!/usr/bin/env python3
"""Render generated WGS84 GeoJSON with GeoPandas. Requires geopandas, matplotlib."""
import argparse
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import geopandas as gpd

p = argparse.ArgumentParser()
p.add_argument("--output", default="map.png")
p.add_argument("geojson", nargs="+")
args = p.parse_args()
fig, ax = plt.subplots(figsize=(11, 8))
for filename in args.geojson:
    gdf = gpd.read_file(filename)
    if not gdf.empty:
        gdf.plot(ax=ax, alpha=0.7, edgecolor="#24475e", linewidth=0.6, label=Path(filename).stem)
ax.set_aspect("equal")
ax.set_xlabel("Longitude (WGS84)")
ax.set_ylabel("Latitude (WGS84)")
ax.set_title("Government Open Data · Shapefile")
fig.tight_layout()
fig.savefig(args.output, dpi=180)
plt.close(fig)
`;
function htmlMap(layers:FeatureCollection[],bounds:number[]):string {
 const safe=JSON.stringify(layers).replace(/</g,"\\u003c").replace(/\u2028|\u2029/g," ");
 return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HK/MO Open Data Map</title><link href="https://unpkg.com/maplibre-gl@5.7.3/dist/maplibre-gl.css" rel="stylesheet">
<style>html,body,#map{height:100%;margin:0}#info{position:absolute;z-index:2;top:16px;left:16px;background:#fff;padding:12px 16px;border-radius:12px;font:14px system-ui;box-shadow:0 2px 14px #0002}</style></head><body>
<div id="map"></div><div id="info">Government Open Data · ${layers.length} layer(s)<br><small>MapLibre · GeoJSON · WGS84</small></div>
<script src="https://unpkg.com/maplibre-gl@5.7.3/dist/maplibre-gl.js"></script>
<script>const data=${safe};const bounds=${JSON.stringify(bounds)};
const map=new maplibregl.Map({container:"map",style:{version:8,sources:{osm:{type:"raster",tiles:["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],tileSize:256,attribution:"© OpenStreetMap contributors"}},layers:[{id:"osm",type:"raster",source:"osm"}]},center:[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],zoom:11});
map.addControl(new maplibregl.NavigationControl());map.on("load",()=>{data.forEach((fc,i)=>{const id="shape-"+i;map.addSource(id,{type:"geojson",data:fc});
map.addLayer({id:id+"-fill",type:"fill",source:id,filter:["==",["geometry-type"],"Polygon"],paint:{"fill-color":"#2476a8","fill-opacity":0.35}});
map.addLayer({id:id+"-line",type:"line",source:id,filter:["in",["geometry-type"],["literal",["LineString","Polygon"]]],paint:{"line-color":"#164b76","line-width":2}});
map.addLayer({id:id+"-point",type:"circle",source:id,filter:["==",["geometry-type"],"Point"],paint:{"circle-radius":5,"circle-color":"#1a75ab","circle-stroke-color":"#fff","circle-stroke-width":1}});
for(const layer of [id+"-point",id+"-line",id+"-fill"])map.on("click",layer,e=>{if(!e.features||!e.features.length)return;
const root=document.createElement("div");for(const [k,v] of Object.entries(e.features[0].properties||{}).slice(0,12)){const line=document.createElement("div");line.textContent=k+": "+String(v).slice(0,160);root.appendChild(line);}
new maplibregl.Popup().setLngLat(e.lngLat).setDOMContent(root).addTo(map);});
});map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:48,maxZoom:15});});</script></body></html>`;
}
const mapboxReact=`import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
// Install: npm install mapbox-gl ; place exported GeoJSON files in public/.
// Requires VITE_MAPBOX_TOKEN in your Vite project (.env.local). Do not commit your token.
// All GeoJSON layers must be WGS84 coordinates.
export default function GovernmentGeoMap() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
    if (!mapboxgl.accessToken) throw new Error("Set VITE_MAPBOX_TOKEN to render Mapbox maps");
    const bounds = GEO_BOUNDS;
    const map = new mapboxgl.Map({container: container.current, style: "mapbox://styles/mapbox/streets-v12",
       center:[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],zoom:11});
    map.once("load",()=>map.fitBounds([[bounds[0],bounds[1]],[bounds[2],bounds[3]]],{padding:48,maxZoom:15}));
    map.on("load", async () => {
      const files = GEOJSON_FILES;
      for (let i = 0; i < files.length; i++) {
        const response = await fetch("/" + files[i]);
        if (!response.ok) throw new Error("Missing GeoJSON in public/: " + files[i]);
        const data = await response.json();
        const id = "layer-" + i;
        map.addSource(id,{type:"geojson",data});
        map.addLayer({id:id+"-fill",type:"fill",source:id,filter:["==",["geometry-type"],"Polygon"],paint:{"fill-color":"#2476a8","fill-opacity":0.3}});
        map.addLayer({id:id+"-line",type:"line",source:id,filter:["==",["geometry-type"],"LineString"],paint:{"line-color":"#2476a8","line-width":2}});
        map.addLayer({id:id+"-points",type:"circle",source:id,filter:["==",["geometry-type"],"Point"],paint:{"circle-radius":5,"circle-color":"#2476a8"}});
      }
    });
    return () => map.remove();
  }, []);
  return <div ref={container} style={{ width:"100%", height:"100vh" }} />;
}
`;
async function runGeoPandas(folder:string,files:string[]) {
 return new Promise<{success:boolean;error?:string}>((done)=>{
   const child=spawn(process.env.HKMO_PYTHON_BIN??"python3",["render_geopandas.py","--output","map.png",...files],{cwd:folder,stdio:["ignore","ignore","pipe"],env:{...process.env,MPLBACKEND:"Agg"}});
   let stderr="";child.stderr.on("data",(v:Buffer)=>{stderr+=v.toString().slice(0,1000);});
   const timer=setTimeout(()=>child.kill("SIGKILL"),20_000);
   child.on("error",()=>{clearTimeout(timer);done({success:false,error:"Python is not installed or cannot start"});});
   child.on("close",code=>{clearTimeout(timer);done({success:code===0,error:code===0?undefined:stderr.slice(-700)||"Install geopandas and matplotlib"});});
 });
}
export async function exportShapefile(args:{region:Region;datasetId:string;resourceId?:number;inputFile?:string;declaredCrs?:string;outputMode?:GeoOutputMode;mapEngine?:MapEngine}) {
 if(!args.outputMode)return {status:"NEEDS_OUTPUT_CHOICE" as const,question:"想用哪一種格式輸出？",choices:[
   {value:"geojson",label:"原始 GeoJSON 檔案"},
   {value:"interactive_map",label:"互動地圖（MapLibre HTML 或 React + Mapbox）"},
   {value:"python_image",label:"Python GeoPandas 靜態 PNG 圖片"}],
   hint:"Please repeat this tool call with outputMode; for interactive_map you may choose mapEngine."};
 const {bytes,dataset,source}=await sourceZip(args);
 const parsed=await parseShapefileZip(bytes,args.declaredCrs);
 const outputRoot=resolve(process.env.HKMO_GEO_OUTPUT_DIR??join(tmpdir(),"hkmo-open-data-exports"));
 await mkdir(outputRoot,{recursive:true,mode:0o700});
 const folder=await mkdtemp(join(outputRoot,"export-"));
 const files:string[]=[];
 for(let i=0;i<parsed.layers.length;i++){
   const name=`layer-${i+1}.geojson`,path=join(folder,name);
   await writeFile(path,JSON.stringify(parsed.layers[i]),{mode:0o600});files.push(name);
 }
 const outputs=files.map(name=>join(folder,name));
 let resultPath:string|undefined,status:"OK"|"DEPENDENCY_REQUIRED"="OK",note="";
 if(args.outputMode==="interactive_map"){
   if(args.mapEngine==="react_mapbox"){
     const react=mapboxReact.replace("GEOJSON_FILES",JSON.stringify(files)).replace("GEO_BOUNDS",JSON.stringify(parsed.bounds));
     resultPath=join(folder,"GovernmentGeoMap.tsx");
     await writeFile(resultPath,react,{mode:0o600});
     note="Copy the GeoJSON files to the React project's public/ folder. Install mapbox-gl and configure VITE_MAPBOX_TOKEN. This is a source artifact, not a running website.";
   }else{
     const geoBytes=Buffer.byteLength(JSON.stringify(parsed.layers));
     if(geoBytes>3_000_000)reject("MAP_PREVIEW_LIMIT","Interactive HTML embeds up to 3MB GeoJSON; use geojson output or smaller layers");
     resultPath=join(folder,"index.html");
     await writeFile(resultPath,htmlMap(parsed.layers,parsed.bounds),{mode:0o600});
     note="Open index.html in a browser with internet access (MapLibre JS and OSM tiles load online). No Mapbox token needed.";
   }
 } else if(args.outputMode==="python_image"){
   const script=join(folder,"render_geopandas.py");
   await writeFile(script,pythonScript,{mode:0o600});
   const run=await runGeoPandas(folder,files);
   if(run.success)resultPath=join(folder,"map.png");
   else {status="DEPENDENCY_REQUIRED";resultPath=script;note=`PNG not generated: ${run.error}. Run python render_geopandas.py --output map.png ${files.join(" ")} after installing geopandas matplotlib.`;}
 }
 return {status,outputMode:args.outputMode,mapEngine:args.outputMode==="interactive_map"?(args.mapEngine??"maplibre_html"):undefined,
   datasetId:dataset.id,officialSource:dataset.detailUrl,inputSource:source,
   layerNames:parsed.layers.map(l=>l.fileName),featureCount:parsed.featureCount,bounds:parsed.bounds,transformations:parsed.transformations,
   geojsonFiles:outputs,artifactPath:resultPath??outputs[0],note};
}
