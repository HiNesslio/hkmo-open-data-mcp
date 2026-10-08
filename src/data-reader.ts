import { XMLParser } from "fast-xml-parser";
import ExcelJS from "exceljs";
import type { FetchedBytes } from "./http.js";

export type TabularResult = {
 format:"JSON"|"XML"|"CSV"|"XLSX";
 columns:string[];
 rows:Record<string,unknown>[];
 rowCount:number|null;
 returned:number;
 offset:number;
 truncated:boolean;
 sourceUrl:string;
 preview?:unknown;
};
function tabular(input:unknown):Record<string,unknown>[] {
 if(Array.isArray(input))return input.map(x=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{value:x});
 if(input&&typeof input==="object"){
   const o=input as Record<string,unknown>;
   for(const key of ["records","results","items","data","rows","Car_park_info","car_park_info"]) {
     if(Array.isArray(o[key]))return tabular(o[key]);
   }
   for(const value of Object.values(o)) {
     if(Array.isArray(value))return tabular(value);
     if(value&&typeof value==="object"){
       const nested=tabular(value);
       if(nested.length>1)return nested;
     }
   }
   return [o];
 }
 return [{value:input}];
}
function csvRows(text:string,maxRows:number):string[][] {
 const rows:string[][]=[];let row:string[]=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){
   const c=text[i];
   if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;} else if(c==='"')quoted=false;else cell+=c;}
   else if(c==='"'&&cell==="")quoted=true;
   else if(c===","){row.push(cell);cell="";}
   else if(c==="\n"){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";if(rows.length>=maxRows)break;}
   else cell+=c;
 }
 if(rows.length<maxRows && (cell!==""||row.length)){row.push(cell);rows.push(row);}
 return rows;
}
function asRecord(row:string[],cols:string[]):Record<string,unknown> {
 const obj:Record<string,unknown>={};cols.forEach((k,i)=>{obj[k]=row[i]??"";});return obj;
}
function inferFormat(result:FetchedBytes,hint?:string):TabularResult["format"] {
 const p=new URL(result.url).pathname.toLowerCase();
 const type=result.contentType.toLowerCase();
 const first=Buffer.from(result.bytes.subarray(0,512)).toString("utf8").trimStart();
 if(p.endsWith(".zip")||p.endsWith(".xls"))throw new Error("ZIP/legacy XLS resources are not supported for structured reading");
 if(first.startsWith("PK")||p.endsWith(".xlsx")||type.includes("spreadsheetml"))return "XLSX";
 if(first.startsWith("{")||first.startsWith("[")||p.endsWith(".json")||type.includes("json"))return "JSON";
 if(first.startsWith("<")||p.endsWith(".xml")||type.includes("xml"))return "XML";
 if(p.endsWith(".csv")||type.includes("csv")||hint==="CSV")return "CSV";
 if(hint && ["JSON","XML","CSV","XLSX"].includes(hint))return hint as TabularResult["format"];
 throw new Error("Unsupported data format; supported: JSON, XML, CSV, XLSX");
}
export async function parseData(result:FetchedBytes,options:{
 limit?:number;offset?:number;fields?:string[];format?:string
}={}):Promise<TabularResult>{
 if(result.status<200||result.status>=300)throw new Error(`Upstream HTTP ${result.status}`);
 const limit=Math.max(1,Math.min(100,options.limit??20)),offset=Math.max(0,Math.min(10000,options.offset??0));
 const format=inferFormat(result,options.format);
 const bytes=result.bytes;
 let columns:string[]=[];let rows:Record<string,unknown>[]=[];let rowCount:number|null=null;
 if(format==="JSON"){
   const parsed=JSON.parse(Buffer.from(bytes).toString("utf8"));
   const all=tabular(parsed);rowCount=all.length;rows=all.slice(offset,offset+limit);
   columns=[...new Set(all.slice(0,Math.min(all.length,10)).flatMap(r=>Object.keys(r)))];
 } else if(format==="XML"){
   const xml=Buffer.from(bytes).toString("utf8");
   if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error("XML DOCTYPE/entities not allowed");
   const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"",processEntities:false,parseTagValue:false,parseAttributeValue:false});
   const parsed=parser.parse(xml);
   const all=tabular(parsed);rowCount=all.length;rows=all.slice(offset,offset+limit);
   columns=[...new Set(all.slice(0,Math.min(all.length,10)).flatMap(r=>Object.keys(r)))];
 } else if(format==="CSV"){
   const text=Buffer.from(bytes).toString("utf8").replace(/^\uFEFF/,"");
   const raw=csvRows(text,offset+limit+2);
   columns=raw[0]?.map((c,i)=>c.trim()||`column_${i+1}`)??[];
   rows=raw.slice(1+offset,1+offset+limit).map(r=>asRecord(r,columns));
   rowCount=null; // CSV is parsed only up to the requested page.
 } else {
   // XLSX only. Legacy XLS, arbitrary ZIP, and ShapeFile ZIP are deliberately rejected.
   if(bytes.byteLength>2_000_000)throw new Error("XLSX file exceeds 2MB parsing safety cap");
   const workbook=new ExcelJS.Workbook();
   await workbook.xlsx.load(Buffer.from(bytes) as any);
   const sheet=workbook.worksheets[0];
   if(!sheet)throw new Error("Empty XLSX workbook");
   const header=sheet.getRow(1);
   columns=Array.from({length:Math.min(header.cellCount,128)},(_,i)=>String(header.getCell(i+1).text??"").trim()||`column_${i+1}`);
   rowCount=Math.max(0,sheet.rowCount-1);
   for(let i=offset+2;i<=Math.min(sheet.rowCount,offset+limit+1);i++){
     const row=sheet.getRow(i),values=columns.map((_,j)=>row.getCell(j+1).text??"");
     rows.push(asRecord(values,columns));
   }
 }
 const fields=options.fields?.slice(0,50);
 if(fields?.length) {
   const unknown=fields.filter(f=>!columns.includes(f));
   if(unknown.length)throw new Error(`Unknown columns: ${unknown.join(", ")}`);
   rows=rows.map(r=>Object.fromEntries(fields.map(k=>[k,r[k]])));
   columns=fields;
 }
 // Don't send huge nested values to a model even when the row count is small.
 rows=rows.map(row=>Object.fromEntries(Object.entries(row).slice(0,30).map(([k,v])=>{
   const text=typeof v==="string"?v:JSON.stringify(v);
   return [k,typeof text==="string"&&text.length>512?text.slice(0,512)+"…":v];
 })));
 return {format,columns,rows,rowCount,returned:rows.length,offset,
   truncated:rowCount!==null?rowCount>offset+rows.length:rows.length===limit,sourceUrl:(()=>{const u=new URL(result.url);for(const k of [...u.searchParams.keys()]){if(/token|key|auth|appcode/i.test(k))u.searchParams.set(k,"[redacted]");}return u.toString();})()};
}
