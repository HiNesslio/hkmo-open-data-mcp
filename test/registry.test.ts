import test from "node:test";
import assert from "node:assert/strict";
import mo from "../registry/mo.json" with { type: "json" };
import hk from "../registry/hk.json" with { type: "json" };

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validStatus=new Set(["verified","manual_required","deprecated"]);

function checkCommon(d:any,region:"HK"|"MO"){
  assert.ok(d.id,`${region} id`); if(region==="MO") assert.match(d.id,uuid,d.title);
  assert.ok(d.title); assert.ok(d.provider); assert.ok(d.category); assert.ok(validStatus.has(d.verificationStatus));
  assert.ok(Array.isArray(d.evidenceUrls)&&d.evidenceUrls.length>0,`${d.title}: evidenceUrls`);
  assert.ok(d.evidenceUrls.every((u:string)=>u.startsWith("https://")),`${d.title}: HTTPS evidence`);
}
test("verified Macao entries have complete callable metadata",()=>{
  for(const d of mo.datasets as Array<any>){ checkCommon(d,"MO"); if(d.verificationStatus!=="verified") continue;
    assert.equal(d.detailUrl,`https://data.gov.mo/Detail?id=${d.id}`);
    assert.ok(Array.isArray(d.formats)&&d.formats.length>0,`${d.title}: formats`);
    assert.ok(d.updateFrequency); assert.ok(d.dataType); assert.ok(d.accessMethod);
    if(d.accessMethod==="API"){ assert.ok(d.resourceUrls.length>0); assert.ok(["GET","POST"].includes(d.requestMethod)); }
  }
});
test("manual_required Macao entries are discovery-only",()=>{
  const pending=(mo.datasets as Array<any>).filter(d=>d.verificationStatus==="manual_required");
  assert.ok(pending.length>=10); for(const d of pending){ checkCommon(d,"MO"); assert.equal(d.resourceUrls.length,0); }
});
test("Hong Kong curated registry is verified",()=>{
  assert.ok((hk.datasets as Array<any>).length>=10);
  for(const d of hk.datasets as Array<any>){ checkCommon(d,"HK"); assert.equal(d.verificationStatus,"verified"); assert.ok(d.updateFrequency); assert.ok(d.dataType); assert.ok(d.accessMethod); }
});
test("registries never persist catalog tokens or APPCODE values",()=>{
  const raw=JSON.stringify({mo,hk}); assert.equal(/token=/i.test(raw),false); assert.equal(/APPCODE\s+[0-9a-f]{16,}/i.test(raw),false);
});
