import test from "node:test";
import assert from "node:assert/strict";
import { searchHongKong } from "../src/catalog/hk.js";
import { searchMacao } from "../src/catalog/mo.js";
import { strictMark } from "../src/match.js";
import { safeFetch } from "../src/http.js";

const run=process.env.RUN_E2E==="1";

test("HK end-to-end: curated discovery -> strict exact -> live HKO API",{skip:!run},async()=>{
  const found=strictMark("香港實時天氣",await searchHongKong("香港實時天氣",[],10));
  const exact=found.find(x=>x.match==="exact"&&x.id==="hk-hko-rss-current-weather-report");
  assert.ok(exact); assert.equal(exact.verificationStatus,"verified"); assert.ok(exact.resourceUrls?.[0]);
  const res=await safeFetch(exact.resourceUrls![0],{},1_000_000);
  assert.equal(res.status,200); assert.match(res.contentType,/json/i);
  const body=JSON.parse(res.text); assert.ok(body.updateTime||body.temperature);
});

test("MO end-to-end: verified registry -> strict exact -> live SMG XML",{skip:!run},async()=>{
  const found=strictMark("澳門實時天氣簡報",await searchMacao("澳門實時天氣簡報",[],10));
  const exact=found.find(x=>x.match==="exact"&&x.id==="070f7d9b-f734-4269-841c-0859912a5b15");
  assert.ok(exact); assert.equal(exact.verificationStatus,"verified"); assert.ok(exact.resourceUrls?.[0]);
  const res=await safeFetch(exact.resourceUrls![0],{},1_000_000);
  assert.equal(res.status,200); assert.ok(res.text.length>100); assert.ok(res.text.includes("<"));
});

test("MO end-to-end: unverified official candidate is never promoted",{skip:!run},async()=>{
  const rows=await searchMacao("澳門工程改道消息",[],10);
  const marked=strictMark("澳門工程改道消息",rows);
  const item=marked.find(x=>x.id==="81c17efc-3e92-484e-ab14-de7fa0f90f01");
  assert.ok(item); assert.equal(item.verificationStatus,"manual_required"); assert.equal(item.match,"candidate");
});

test("MO end-to-end: Detail SPA metadata -> runtime APPCODE -> live parking API",{skip:!run},async()=>{
  const { inspectMacaoDatasetDetail, resolveMacaoApiAccess } = await import("../src/macao-auth.js");
  const datasetId="ea50a770-cc35-47cc-a3ba-7f60092d4bc4";
  const inspected=await inspectMacaoDatasetDetail(datasetId);
  assert.equal(inspected.authentication.resolved,true);
  assert.equal(inspected.authentication.value,"[redacted]");
  assert.ok(inspected.apis.some((x)=>x.apiPath.includes("dsat.apigateway.data.gov.mo/car_park_maintance")));

  const access=await resolveMacaoApiAccess(datasetId,"https://dsat.apigateway.data.gov.mo/car_park_maintance");
  assert.ok(access.appCode.length>=16);
  assert.ok(access.selected);

  const res=await safeFetch(access.selected!.apiPath,{headers:{authorization:`APPCODE ${access.appCode}`}},1_000_000);
  assert.equal(res.status,200);
  assert.ok(res.text.includes("Car_park_info") || res.text.includes("CarPark"));
});
