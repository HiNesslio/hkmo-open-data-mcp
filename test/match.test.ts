import test from "node:test";
import assert from "node:assert/strict";
import { strictMark } from "../src/match.js";

test("does not promote a similar parking dataset to exact", () => {
  const [x] = strictMark("停車場 實時 空位", [{
    region: "MO",
    id: "x",
    title: "停車場位置",
    description: "停車場地址及座標",
    detailUrl: "https://data.gov.mo/Detail?id=x",
    match: "candidate",
    evidence: []
  }]);
  assert.equal(x.match, "candidate");
});

test("accepts a curated exact alias after removing the explicit Macao region word", () => {
  const [x] = strictMark("澳門停車場實時空位", [{
    region: "MO",
    id: "ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
    title: "停車場車位資訊",
    exactAliases: ["停車場實時空位", "停車場剩餘車位"],
    description: "公共停車場動態車位資訊，官方更新頻率為10秒。",
    detailUrl: "https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
    match: "candidate",
    evidence: []
  }]);
  assert.equal(x.match, "exact");
});

test("does not treat car-park location as equivalent to real-time vacancy", () => {
  const [x] = strictMark("澳門停車場位置", [{
    region: "MO",
    id: "ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
    title: "停車場車位資訊",
    exactAliases: ["停車場實時空位", "停車場剩餘車位"],
    description: "公共停車場動態車位資訊，官方更新頻率為10秒。",
    detailUrl: "https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4",
    match: "candidate",
    evidence: []
  }]);
  assert.equal(x.match, "candidate");
});

test("Hong Kong matching strips region wording but still rejects semantic substitution", () => {
  const [x] = strictMark("香港停車場空位", [{
    region: "HK",
    id: "x",
    title: "停車場位置",
    description: "政府停車場地址及座標",
    detailUrl: "https://data.gov.hk/tc-data/dataset/x",
    match: "candidate",
    evidence: []
  }]);
  assert.equal(x.match, "candidate");
});
