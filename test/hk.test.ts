import test from "node:test";
import assert from "node:assert/strict";
import { extractHongKongTerms, scoreHongKongPackage, extractHongKongIndexRecords } from "../src/catalog/hk.js";

test("Hong Kong discovery strips the region and segments a Chinese natural-language query",()=>{
  const terms=extractHongKongTerms("香港停車場空位");
  assert.equal(terms.includes("香港停車場空位"),false);
  assert.ok(terms.some((x)=>x.includes("停車")||x.includes("車場")));
  assert.ok(terms.some((x)=>x.includes("空位")));
});
test("Hong Kong discovery scores official metadata instead of requiring an English dataset id match",()=>{
  const terms=extractHongKongTerms("香港停車場空位",["停車場","泊車位"]);
  const score=scoreHongKongPackage({name:"hk-td-sample-english-slug",title:"停車場空置泊車位數目",notes:"提供政府停車場可用泊車位資料",organization:{title:"運輸署"}},terms);
  assert.ok(score>0);
});
test("official dataset-list index extraction finds dataset ids embedded in Chinese records",()=>{
  const records=extractHongKongIndexRecords({datasets:[{title:"學校位置及資料",url:"https://data.gov.hk/tc-data/dataset/hk-edb-schinfo-school-location-and-information",provider:"教育局"}]});
  assert.deepEqual(records.map((x)=>x.id),["hk-edb-schinfo-school-location-and-information"]);
  assert.match(records[0].text,/學校位置及資料/);
});
