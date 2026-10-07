export type Region = "HK" | "MO";
export type VerificationStatus = "verified" | "manual_required" | "deprecated";

export type DatasetCandidate = {
  region: Region;
  id: string;
  title: string;
  category?: string;
  description?: string;
  provider?: string;
  formats?: string[];
  detailUrl: string;
  resourceUrls?: string[];
  exactAliases?: string[];
  updateFrequency?: string;
  dataType?: string;
  accessMethod?: string;
  requestMethod?: string;
  openness?: string;
  accessNotes?: string;
  apiVerification?: string;
  evidenceUrls?: string[];
  verificationStatus?: VerificationStatus;
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
