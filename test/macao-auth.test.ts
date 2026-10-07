import test from "node:test";
import assert from "node:assert/strict";
import { datasetIdFromMacaoDetailUrl, findVerifiedMacaoDatasetIdByApiUrl } from "../src/macao-auth.js";

test("extracts a data.gov.mo dataset id from an official Detail URL", () => {
  assert.equal(
    datasetIdFromMacaoDetailUrl("https://data.gov.mo/Detail?id=ea50a770-cc35-47cc-a3ba-7f60092d4bc4"),
    "ea50a770-cc35-47cc-a3ba-7f60092d4bc4"
  );
});

test("maps a verified Macao API gateway URL back to its dataset without using APPCODE from the registry", () => {
  assert.equal(
    findVerifiedMacaoDatasetIdByApiUrl("https://dsat.apigateway.data.gov.mo/car_park_maintance?lang=zh_TW"),
    "ea50a770-cc35-47cc-a3ba-7f60092d4bc4"
  );
});

test("does not infer a dataset for an unknown Macao API gateway URL", () => {
  assert.equal(findVerifiedMacaoDatasetIdByApiUrl("https://dsat.apigateway.data.gov.mo/not-registered"), null);
});
