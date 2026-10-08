import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseData } from "../src/data-reader.js";
import { requireVerifiedMacaoDataset } from "../src/macao-auth.js";
import { bindResource } from "../src/access.js";

const response=(text:string,contentType:string)=>({
 url:"https://data.gov.mo/some-resource",status:200,contentType,bytes:Buffer.from(text)
});
test("JSON reader limits rows and allows column selection",async()=>{
 const r=await parseData(response(JSON.stringify({data:[{name:"A",count:1},{name:"B",count:2}]}),"application/json"),{limit:1,fields:["name"]});
 assert.equal(r.returned,1);assert.deepEqual(r.rows,[{name:"A"}]);assert.equal(r.truncated,true);
});
test("CSV reader handles quoted commas and newlines",async()=>{
 const r=await parseData(response('a,b\n"hello, world","row\n2"\n',"text/csv"),{});
 assert.equal(r.rows[0].a,"hello, world");assert.equal(r.rows[0].b,"row\n2");
});
test("XML reader preserves attributes and blocks DOCTYPE",async()=>{
 const ok=await parseData(response('<root><item id="1"/><item id="2"/></root>',"application/xml"),{});
 assert.equal(ok.returned,2);assert.equal(ok.rows[0].id,"1");
 await assert.rejects(()=>parseData(response('<!DOCTYPE x><root/>',"application/xml"),{}),/DOCTYPE/);
});
test("XLSX reader extracts first-sheet rows",async()=>{
 const x=new ExcelJS.Workbook(),s=x.addWorksheet("Test");
 s.addRow(["name","count"]);s.addRow(["sample",42]);
 const buf=await x.xlsx.writeBuffer();
 const r=await parseData({url:"https://data.gov.mo/test.xlsx",status:200,contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",bytes:new Uint8Array(buf)}, {limit:10});
 assert.equal(r.format,"XLSX");assert.equal(r.rows[0].name,"sample");assert.equal(r.rows[0].count,"42");
});
test("manual_required dataset cannot be passed to runtime API resolver",()=>{
 assert.throws(()=>requireVerifiedMacaoDataset("81c17efc-3e92-484e-ab14-de7fa0f90f01"),/not verified/);
});
test("resource binder forbids undocumented params",()=>{
 const resource={id:0,url:"https://data.gov.hk/api/{stop_id}?lang=tc",format:"JSON",method:"GET" as const,requiredPathParams:["stop_id"],allowedQueryParams:["lang"],source:"registry" as const};
 assert.throws(()=>bindResource(resource,{},{}),/Missing path parameter/);
 assert.throws(()=>bindResource(resource,{stop_id:"AAA"},{token:"secret"}),/Undocumented query parameter/);
 assert.match(bindResource(resource,{stop_id:"AAA"},{lang:"en"}),/AAA/);
});
