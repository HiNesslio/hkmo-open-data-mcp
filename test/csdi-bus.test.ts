import test from "node:test";
import assert from "node:assert/strict";
import { HK_CSDI_SOURCES,csdiServiceUrl,buildBusRouteWhere,exportCsdiBusRoute,validateCsdiGeojson } from "../src/csdi.js";

const fields=[
 {name:"ROUTE_ID",type:"esriFieldTypeInteger"},
 {name:"ROUTE_NAMEE",type:"esriFieldTypeString"},
 {name:"ROUTE_SEQ",type:"esriFieldTypeSmallInteger"}
];
test("CSDI TD Bus Route is distinct from roads and stop locations",()=>{
 assert.equal(HK_CSDI_SOURCES.bus_route.datasetId,"td_rcd_1638844988873_41214");
 assert.notEqual(HK_CSDI_SOURCES.bus_route.datasetId,HK_CSDI_SOURCES.road_network.datasetId);
 assert.match(csdiServiceUrl("bus_route"),/td_rcd_1638844988873_41214\/FeatureServer$/);
});
test("routeId uses actual ROUTE_ID and optional sequence, not road proximity",()=>{
 assert.equal(buildBusRouteWhere(fields,{routeId:"1001",routeSeq:2}),"ROUTE_ID = 1001 AND ROUTE_SEQ = 2");
 assert.equal(buildBusRouteWhere(fields,{routeNumber:"219X"}),"ROUTE_NAMEE = '219X'");
});
test("ROUTE_SEQ does not become outbound or inbound automatically",()=>{
 assert.equal(buildBusRouteWhere(fields,{routeNumber:"26",routeSeq:1}),"ROUTE_NAMEE = '26' AND ROUTE_SEQ = 1");
 assert.throws(()=>buildBusRouteWhere(fields,{routeNumber:"26",routeId:"1001"}),/SELECTOR_AMBIGUOUS/);
 assert.throws(()=>buildBusRouteWhere(fields,{}),/SELECTOR_REQUIRED/);
});
test("rejects unknown schema and untrusted route filter values",()=>{
 assert.throws(()=>buildBusRouteWhere([{name:"OTHER",type:"string"}],{routeNumber:"26"}),/FIELD_MISSING/);
 assert.throws(()=>buildBusRouteWhere(fields,{routeNumber:"26' OR 1=1"}),/ID_INVALID/);
 assert.throws(()=>buildBusRouteWhere(fields,{routeId:"1;DROP TABLE"}),/ID_INVALID/);
 assert.throws(()=>buildBusRouteWhere(fields,{routeNumber:"26",routeSeq:0}),/SEQ_INVALID/);
});
test("line geometries preserve all official intermediate vertices",()=>{
 const fc=validateCsdiGeojson({type:"FeatureCollection",features:[{
  type:"Feature",geometry:{type:"LineString",coordinates:[[114.1,22.3],[114.101,22.3005],[114.102,22.301],[114.103,22.3]]},
  properties:{ROUTE_ID:1001,ROUTE_SEQ:1}
 }]},2);
 assert.equal((fc.features[0].geometry as any).coordinates.length,4);
});
test("bus map exporter asks about output before any network operation",async()=>{
 const value=await exportCsdiBusRoute({layerId:0,routeNumber:"26"});
 assert.equal(value.status,"NEEDS_OUTPUT_CHOICE");
 assert.equal(value.choices.length,3);
});
