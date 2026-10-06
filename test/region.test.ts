import test from "node:test";
import assert from "node:assert/strict";
import { resolveRegion } from "../src/region.js";

test("asks when region is missing", () => {
  const r = resolveRegion("停車場空位資料");
  assert.equal(r.ok, false);
});

test("detects Macao", () => {
  assert.deepEqual(resolveRegion("澳門停車場空位"), { ok: true, region: "MO" });
});

test("detects Hong Kong", () => {
  assert.deepEqual(resolveRegion("香港巴士資料"), { ok: true, region: "HK" });
});
