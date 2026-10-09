declare module "shpjs" {
  type GeoFeatureCollection = { type:"FeatureCollection";fileName?:string;features: Array<{type:"Feature";geometry:unknown;properties:Record<string,unknown>|null}> };
  const shp:(input:Uint8Array|Buffer|ArrayBuffer)=>Promise<GeoFeatureCollection|GeoFeatureCollection[]>;
  export default shp;
}
