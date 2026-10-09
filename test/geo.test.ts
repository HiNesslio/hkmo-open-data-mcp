import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectShapefileArchive, parseShapefileZip, exportShapefile, geoBounds } from "../src/geo.js";

function crc32(data: Buffer):number {
 let crc=0xffffffff;
 for(const value of data) {
   crc^=value;
   for(let i=0;i<8;i++) crc=(crc>>>1) ^ ((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function archive(files:Record<string,Buffer>) {
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [name,data] of Object.entries(files)) {
   const filename=Buffer.from(name),crc=crc32(data);
   const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);
   lh.writeUInt16LE(20,4);lh.writeUInt16LE(0,6);lh.writeUInt16LE(0,8);
   lh.writeUInt32LE(crc,14);lh.writeUInt32LE(data.length,18);lh.writeUInt32LE(data.length,22);
   lh.writeUInt16LE(filename.length,26);
   local.push(lh,filename,data);
   const ch=Buffer.alloc(46);ch.writeUInt32LE(0x02014b50,0);
   ch.writeUInt16LE(20,4);ch.writeUInt16LE(20,6);
   ch.writeUInt32LE(crc,16);ch.writeUInt32LE(data.length,20);ch.writeUInt32LE(data.length,24);
   ch.writeUInt16LE(filename.length,28);ch.writeUInt32LE(offset,42);
   central.push(ch,filename);
   offset+=lh.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);
 end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,directory,end]);
}
function shpPoint(x:number,y:number) {
 const b=Buffer.alloc(128);
 b.writeInt32BE(9994,0);b.writeInt32BE(64,24);b.writeInt32LE(1000,28);b.writeInt32LE(1,32);
 b.writeDoubleLE(x,36);b.writeDoubleLE(y,44);b.writeDoubleLE(x,52);b.writeDoubleLE(y,60);
 b.writeInt32BE(1,100);b.writeInt32BE(10,104);b.writeInt32LE(1,108);
 b.writeDoubleLE(x,112);b.writeDoubleLE(y,120);return b;
}
function dbfPoint() {
 const b=Buffer.alloc(65+9+1);b.writeUInt8(3,0);b.writeUInt32LE(1,4);
 b.writeUInt16LE(65,8);b.writeUInt16LE(9,10);
 b.write("Name",32);b.write("C",43);b.writeUInt8(8,48);
 b.writeUInt8(13,64);b.write(" Station ",65);b.writeUInt8(26,74);
 return b;
}
const prj=Buffer.from('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]]');
function sample(includePrj=true,x=113.55,y=22.2) {
 const files:Record<string,Buffer>={"macau.shp":shpPoint(x,y),"macau.dbf":dbfPoint()};
 if(includePrj)files["macau.prj"]=prj;
 return archive(files);
}
test("valid ZIP metadata lists Shapefile layers and required components",()=>{
 const metadata=inspectShapefileArchive(sample());
 assert.equal(metadata.layers.length,1);assert.equal(metadata.layers[0].hasPrj,true);
 assert.equal(metadata.entries,3);
});
test("missing .prj requires an explicit EPSG:4326 declaration",()=>{
 assert.throws(()=>inspectShapefileArchive(sample(false)),/CRS_REQUIRED/);
 assert.equal(inspectShapefileArchive(sample(false),"EPSG:4326").layers.length,1);
});
test("unsafe names are rejected before decompression",()=>{
 const malicious=archive({"../macau.shp":shpPoint(113.55,22.2),"../macau.dbf":dbfPoint(),"../macau.prj":prj});
 assert.throws(()=>inspectShapefileArchive(malicious),/INVALID_ZIP/);
});
test("out-of-bounds projected coordinates never masquerade as WGS84",()=>{
 assert.throws(()=>geoBounds([{type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Point",coordinates:[20000,18000]},properties:{}}]}]),/PROJECTION_INVALID/);
});
test("Shapefile ZIP converts to GeoJSON with correct coordinates",async()=>{
 const converted=await parseShapefileZip(sample());
 assert.equal(converted.featureCount,1);
 assert.deepEqual(converted.bounds,[113.55,22.2,113.55,22.2]);
 assert.equal(converted.layers[0].features[0].geometry.type,"Point");
});
test("missing output format yields three user-facing choices without fetching data",async()=>{
 const result=await exportShapefile({region:"MO",datasetId:"e7b2e84d-3333-42f0-b676-64ce95306f0d"});
 assert.equal(result.status,"NEEDS_OUTPUT_CHOICE");
 if(!("choices" in result))throw new Error("Missing choices");
 assert.equal(result.choices.length,3);
});
test("local ZIP export writes GeoJSON, interactive HTML and React Mapbox source",async()=>{
 const folder=await mkdtemp(join(tmpdir(),"hkmo-geo-test-"));
 const oldInput=process.env.HKMO_GEO_INPUT_DIR,oldOutput=process.env.HKMO_GEO_OUTPUT_DIR;
 try{
   process.env.HKMO_GEO_INPUT_DIR=folder;process.env.HKMO_GEO_OUTPUT_DIR=folder;
   await writeFile(join(folder,"sample.zip"),sample());
   const base={region:"MO" as const,datasetId:"e7b2e84d-3333-42f0-b676-64ce95306f0d",inputFile:"sample.zip"};
   const geo=await exportShapefile({...base,outputMode:"geojson"});
   assert.equal(geo.status,"OK");
   if(!("artifactPath" in geo))throw new Error("Missing GeoJSON artifact");
   const json=JSON.parse(await readFile(geo.artifactPath,"utf8"));assert.equal(json.type,"FeatureCollection");
   const html=await exportShapefile({...base,outputMode:"interactive_map",mapEngine:"maplibre_html"});
   assert.equal(html.status,"OK");if(!("artifactPath" in html))throw new Error("Missing HTML artifact");
   assert.match(await readFile(html.artifactPath,"utf8"),/maplibregl/);
   const react=await exportShapefile({...base,outputMode:"interactive_map",mapEngine:"react_mapbox"});
   if(!("artifactPath" in react))throw new Error("Missing React artifact");
   assert.match(await readFile(react.artifactPath,"utf8"),/VITE_MAPBOX_TOKEN/);
 }finally{
   if(oldInput===undefined)delete process.env.HKMO_GEO_INPUT_DIR;else process.env.HKMO_GEO_INPUT_DIR=oldInput;
   if(oldOutput===undefined)delete process.env.HKMO_GEO_OUTPUT_DIR;else process.env.HKMO_GEO_OUTPUT_DIR=oldOutput;
   await rm(folder,{force:true,recursive:true});
 }
});

test("Python image mode never claims a PNG when GeoPandas cannot start",async()=>{
 const folder=await mkdtemp(join(tmpdir(),"hkmo-python-test-"));
 const oldInput=process.env.HKMO_GEO_INPUT_DIR,oldOutput=process.env.HKMO_GEO_OUTPUT_DIR,oldPython=process.env.HKMO_PYTHON_BIN;
 try{
   process.env.HKMO_GEO_INPUT_DIR=folder;process.env.HKMO_GEO_OUTPUT_DIR=folder;
   process.env.HKMO_PYTHON_BIN="hkmo-no-such-python-binary";
   await writeFile(join(folder,"香港巴士路線.zip"),sample());
   const r=await exportShapefile({region:"MO",datasetId:"e7b2e84d-3333-42f0-b676-64ce95306f0d",inputFile:"香港巴士路線.zip",outputMode:"python_image"});
   assert.equal(r.status,"DEPENDENCY_REQUIRED");
   if(!("artifactPath" in r))throw new Error("Missing render script");
   assert.match(await readFile(r.artifactPath,"utf8"),/import geopandas as gpd/);
 }finally{
   if(oldInput===undefined)delete process.env.HKMO_GEO_INPUT_DIR;else process.env.HKMO_GEO_INPUT_DIR=oldInput;
   if(oldOutput===undefined)delete process.env.HKMO_GEO_OUTPUT_DIR;else process.env.HKMO_GEO_OUTPUT_DIR=oldOutput;
   if(oldPython===undefined)delete process.env.HKMO_PYTHON_BIN;else process.env.HKMO_PYTHON_BIN=oldPython;
   await rm(folder,{force:true,recursive:true});
 }
});

const sparseMacaoGridWkt="PROJCS[\"Macau_Grid\",GEOGCS[\"GCS_Macau\",DATUM[\"D_Macau\",SPHEROID[\"International_1924\",6378388.0,297.0]],PRIMEM[\"Greenwich\",0.0],UNIT[\"Degree\",0.0174532925199433]],PROJECTION[\"Transverse_Mercator\"],PARAMETER[\"False_Easting\",20000.0],PARAMETER[\"False_Northing\",20000.0],PARAMETER[\"Central_Meridian\",113.536469444444],PARAMETER[\"Scale_Factor\",1.0],PARAMETER[\"Latitude_Of_Origin\",22.2123972222222],UNIT[\"Meter\",1.0]]";
function sparseMacaoGridZip() {
 return archive({
  "macao_road.shp":shpPoint(21086.200383349347,18760.370077367555),
  "macao_road.dbf":dbfPoint(),
  "macao_road.prj":Buffer.from(sparseMacaoGridWkt)
 });
}
test("Macao D_Macau without TOWGS84 uses EPSG:8433 -> EPSG:8438 transformation",async()=>{
 const converted=await parseShapefileZip(sparseMacaoGridZip());
 assert.equal(converted.transformations[0].sourceCrs,"EPSG:8433");
 assert.equal(converted.transformations[0].operationEpsg,"EPSG:8438");
 assert.equal(converted.transformations[0].ballpark,false);
 assert.ok(converted.transformations[0].accuracyMeters<=1.1);
 const [lon,lat]=converted.layers[0].features[0].geometry.coordinates;
 assert.ok(Math.abs(lon-113.55)<0.00001,`longitude ${lon} is offset`);
 assert.ok(Math.abs(lat-22.20)<0.00001,`latitude ${lat} is offset`);
});
test("false Macau Grid fingerprint does not trigger automatic EPSG:8433 override",async()=>{
 const altered=sparseMacaoGridWkt.replace('PARAMETER["False_Easting",20000.0]','PARAMETER["False_Easting",30000.0]');
 const file=archive({"macao_road.shp":shpPoint(21086.200383349347,18760.370077367555),
   "macao_road.dbf":dbfPoint(),"macao_road.prj":Buffer.from(altered)});
 await assert.rejects(()=>parseShapefileZip(file),/DATUM_TRANSFORM_UNAVAILABLE|GEO_TRANSFORM_FAILED/);
});
