import test from "node:test";
import assert from "node:assert/strict";
import { extractHongKongTerms, scoreHongKongPackage } from "../src/catalog/hk.js";

test("Hong Kong discovery strips the region and segments a Chinese natural-language query", () => {
  const terms = extractHongKongTerms("香港停車場空位");
  assert.equal(terms.includes("香港停車場空位"), false);
  assert.ok(terms.some((x) => x.includes("停車") || x.includes("車場")));
  assert.ok(terms.some((x) => x.includes("空位")));
});

test("Hong Kong discovery scores official metadata instead of requiring an English dataset id match", () => {
  const terms = extractHongKongTerms("香港停車場空位", ["停車場", "泊車位"]);
  const score = scoreHongKongPackage({
    name: "hk-td-sample-english-slug",
    title: "停車場空置泊車位數目",
    notes: "提供政府停車場可用泊車位資料",
    organization: { title: "運輸署" }
  }, terms);
  assert.ok(score > 0);
});
