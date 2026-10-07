import test from "node:test";
import assert from "node:assert/strict";
import { assertOfficialUrl } from "../src/http.js";

test("allows official Hong Kong and Macao government HTTPS hosts", () => {
  assert.equal(assertOfficialUrl("https://data.gov.hk/tc-data/api/3/action/group_list").hostname, "data.gov.hk");
  assert.equal(assertOfficialUrl("https://dsat.apigateway.data.gov.mo/test").hostname, "dsat.apigateway.data.gov.mo");
});

test("rejects non-government, HTTP and lookalike hosts", () => {
  assert.throws(() => assertOfficialUrl("https://example.com/data"));
  assert.throws(() => assertOfficialUrl("http://data.gov.hk/test"));
  assert.throws(() => assertOfficialUrl("https://data.gov.hk.example.com/test"));
});
