import test from "node:test";
import assert from "node:assert/strict";
import { HK_CSDI_SOURCES, csdiServiceUrl, validateHkBounds, parseLayerCatalog, validateCsdiGeojson, exportCsdiGeometry } from "../src/csdi.js";

test("CSDI only offers two official pinned road dataset endpoints",()=>{
 assert.equal(Object.keys(HK_CSDI_SOURCES).length,2);
 assert.match(csdiServiceUrl("road_centreline"),/landsd_rcd_1637310758814_80061\/FeatureServer$/);
 assert.match(csdiServiceUrl("road_network"),/td_rcd_1638949160594_2844\/FeatureServer$/);
 assert.throws(()=>csdiServiceUrl("fake" as any),/CSDI_SOURCE_UNKNOWN/);
});
test("bbox accepts a Hong Kong neighbourhood, rejects global/wide/reversed requests",()=>{
 assert.deepEqual(validateHkBounds([114.12,22.27,114.14,22.29]),[114.12,22.27,114.14,22.29]);
 assert.throws(()=>validateHkBounds([0,0,180,90]),/BBOX_INVALID/);
 assert.throws(()=>validateHkBounds([114.14,22.27,114.12,22.29]),/BBOX_INVALID/);
 assert.throws(()=>validateHkBounds([114.02,22.2,114.2,22.28]),/BBOX_TOO_LARGE/);
});
test("layers must come from official FeatureServer metadata",()=>{
 assert.deepEqual(parseLayerCatalog({layers:[{id:3,name:"ROAD_ROUTE",type:"Feature Layer"},{id:-1,name:"oops"},{id:"2",name:"bad"}]}),[{id:3,name:"ROAD_ROUTE",type:"Feature Layer",geometryType:undefined,defaultVisibility:undefined}]);
 assert.throws(()=>parseLayerCatalog({}),/CSDI_INVALID_RESPONSE/);
});
test("road geometry requires GeoJSON LineString or MultiLineString",()=>{
 const lines={type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"LineString",coordinates:[[114.12,22.28],[114.121,22.281],[114.123,22.282]]},properties:{STREETCODE:"sample"}}]};
 const fc=validateCsdiGeojson(lines,2);
 assert.equal(fc.features[0].geometry?.type,"LineString");
 assert.equal((fc.features[0].geometry as any).coordinates.length,3);
 assert.throws(()=>validateCsdiGeojson({type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"Point",coordinates:[114.12,22.28]},properties:{}}]},2),/UNEXPECTED_GEOMETRY/);
 assert.throws(()=>validateCsdiGeojson({type:"FeatureCollection",features:[{type:"Feature",geometry:{type:"LineString",coordinates:[[800000,820000],[800001,820001]]},properties:{}}]},2),/PROJECTION_INVALID/);
});
test("without output preference export asks user before fetching any CSDI data",async()=>{
 const result=await exportCsdiGeometry({source:"road_centreline",layerId:0,bbox:[114.12,22.27,114.14,22.29]});
 assert.equal(result.status,"NEEDS_OUTPUT_CHOICE");
 assert.equal(result.choices.length,3);
});
