import test from "node:test";
import assert from "node:assert/strict";
import registry from "../registry/mo.json" with { type: "json" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("Macao registry entries carry the required verifiable metadata", () => {
  assert.ok(registry.datasets.length >= 20);
  for (const d of registry.datasets as Array<any>) {
    assert.match(d.id, uuid, d.title);
    assert.equal(d.detailUrl, `https://data.gov.mo/Detail?id=${d.id}`);
    assert.ok(d.provider, `${d.title}: provider`);
    assert.ok(d.category, `${d.title}: category`);
    assert.ok(Array.isArray(d.formats) && d.formats.length > 0, `${d.title}: formats`);
    assert.ok(d.updateFrequency, `${d.title}: updateFrequency`);
    assert.ok(d.dataType, `${d.title}: dataType`);
    assert.ok(["API", "download", "URL"].includes(d.accessMethod), `${d.title}: accessMethod`);
    assert.ok(Array.isArray(d.evidenceUrls) && d.evidenceUrls.length > 0, `${d.title}: evidenceUrls`);
    assert.ok(d.evidenceUrls.every((u: string) => u.startsWith("https://")), `${d.title}: HTTPS evidence`);
    if (d.accessMethod === "API") {
      assert.ok(Array.isArray(d.resourceUrls) && d.resourceUrls.length > 0, `${d.title}: API resource URL`);
      assert.ok(["GET", "POST"].includes(d.requestMethod), `${d.title}: API method`);
    }
  }
});

test("registry never persists catalog tokens or APPCODE values", () => {
  const raw = JSON.stringify(registry);
  assert.equal(/token=/i.test(raw), false);
  assert.equal(/APPCODE\s+[0-9a-f]{16,}/i.test(raw), false);
});

test("core categories are represented", () => {
  const categories = new Set((registry.datasets as Array<any>).map((d) => d.category));
  assert.ok(categories.has("公共交通"));
  assert.ok(categories.has("城市環境"));
  assert.ok(categories.has("住房人口"));
  assert.ok(categories.has("醫療衛生"));
  assert.ok(categories.has("體育"));
  assert.ok(categories.has("教育"));
  assert.ok(categories.has("文化"));
});
