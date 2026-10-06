import type { Region } from "./types.js";

const HK = ["香港", "hong kong", "hongkong", " hk ", "hk政府", "港府"];
const MO = ["澳門", "澳门", "macao", "macau", " mo ", "澳府"];

export function resolveRegion(text: string, explicit?: Region):
  | { ok: true; region: Region }
  | { ok: false; question: string; reason: "ambiguous" | "conflict" } {
  if (explicit) return { ok: true, region: explicit };
  const s = ` ${text.toLowerCase()} `;
  const hk = HK.some((x) => s.includes(x));
  const mo = MO.some((x) => s.includes(x));
  if (hk && mo) return { ok: false, reason: "conflict", question: "你想查香港定澳門嘅資料？" };
  if (hk) return { ok: true, region: "HK" };
  if (mo) return { ok: true, region: "MO" };
  return { ok: false, reason: "ambiguous", question: "你想查香港定澳門嘅資料？" };
}
