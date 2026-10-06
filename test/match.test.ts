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
