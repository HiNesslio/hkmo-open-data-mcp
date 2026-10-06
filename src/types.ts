export type Region = "HK" | "MO";

export type DatasetCandidate = {
  region: Region;
  id: string;
  title: string;
  description?: string;
  provider?: string;
  formats?: string[];
  detailUrl: string;
  resourceUrls?: string[];
  match: "exact" | "candidate";
  evidence: string[];
};

export type SearchResult = {
  status: "FOUND" | "NOT_FOUND" | "NEEDS_REGION" | "DISCOVERY_LIMITED";
  region?: Region;
  query: string;
  candidates: DatasetCandidate[];
  message: string;
};
