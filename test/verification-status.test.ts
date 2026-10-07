import test from "node:test";
import assert from "node:assert/strict";
import { strictMark } from "../src/match.js";

test("manual_required dataset can never become exact even on title equality",()=>{
  const [x]=strictMark("澳門工程改道消息",[{region:"MO",id:"81c17efc-3e92-484e-ab14-de7fa0f90f01",title:"工程改道消息",detailUrl:"https://data.gov.mo/Detail?id=81c17efc-3e92-484e-ab14-de7fa0f90f01",verificationStatus:"manual_required",match:"candidate",evidence:[]}]);
  assert.equal(x.match,"candidate");
  assert.match(x.evidence.at(-1)??"",/blocks exact/);
});
