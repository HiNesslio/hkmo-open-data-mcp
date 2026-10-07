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
