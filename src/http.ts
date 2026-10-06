const ALLOWED_SUFFIXES = [".gov.hk", ".gov.mo"];
const ALLOWED_EXACT = new Set(["data.gov.hk", "api.data.gov.hk", "app.data.gov.hk", "data.gov.mo", "api.data.gov.mo"]);

export function assertOfficialUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed");
  const host = url.hostname.toLowerCase();
  const ok = ALLOWED_EXACT.has(host) || ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!ok) throw new Error(`Host is not an allowlisted Hong Kong/Macao government domain: ${host}`);
  if (["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Local addresses are forbidden");
  return url;
}

export async function safeFetch(raw: string, init: RequestInit = {}, maxBytes = 2_000_000): Promise<{ url: string; status: number; contentType: string; text: string }> {
  const url = assertOfficialUrl(raw);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "hkmo-open-data-mcp/0.1 (+https://github.com/HiNesslio/hkmo-open-data-mcp)",
        accept: "application/json,text/plain,text/html,application/xml;q=0.9,*/*;q=0.5",
        ...(init.headers ?? {})
      }
    });
    const finalUrl = assertOfficialUrl(res.url);
    const reader = res.body?.getReader();
    if (!reader) return { url: finalUrl.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", text: "" };
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
      chunks.push(value);
    }
    const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { url: finalUrl.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", text: merged.toString("utf8") };
  } finally {
    clearTimeout(timer);
  }
}
