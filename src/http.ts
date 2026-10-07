const ALLOWED_SUFFIXES = [".gov.hk", ".gov.mo"];
const ALLOWED_EXACT = new Set(["data.gov.hk", "api.data.gov.hk", "app.data.gov.hk", "data.gov.mo", "api.data.gov.mo"]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export function assertOfficialUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are allowed");
  const host = url.hostname.toLowerCase();
  const ok = ALLOWED_EXACT.has(host) || ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
  if (!ok) throw new Error(`Host is not an allowlisted Hong Kong/Macao government domain: ${host}`);
  if (["localhost", "127.0.0.1", "::1"].includes(host)) throw new Error("Local addresses are forbidden");
  return url;
}

function requestHeaders(input?: HeadersInit): Headers {
  const h = new Headers(input ?? {});
  if (!h.has("user-agent")) h.set("user-agent", "hkmo-open-data-mcp/0.1 (+https://github.com/HiNesslio/hkmo-open-data-mcp)");
  if (!h.has("accept")) h.set("accept", "application/json,text/plain,text/html,application/xml;q=0.9,*/*;q=0.5");
  return h;
}

export async function safeFetch(raw: string, init: RequestInit = {}, maxBytes = 2_000_000): Promise<{ url: string; status: number; contentType: string; text: string }> {
  let current = assertOfficialUrl(raw);
  let method = String(init.method ?? "GET").toUpperCase();
  let body = init.body;
  let headers = requestHeaders(init.headers);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const res = await fetch(current, {
        ...init,
        method,
        body,
        headers,
        redirect: "manual",
        signal: controller.signal
      });

      if (REDIRECT_STATUSES.has(res.status)) {
        if (redirects === MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
        const location = res.headers.get("location");
        if (!location) throw new Error(`Redirect response ${res.status} missing Location header`);

        const next = assertOfficialUrl(new URL(location, current).toString());
        if (next.origin !== current.origin) {
          headers = new Headers(headers);
          headers.delete("authorization");
          headers.delete("cookie");
          headers.delete("proxy-authorization");
        }

        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method !== "GET" && method !== "HEAD")) {
          method = "GET";
          body = undefined;
          headers = new Headers(headers);
          headers.delete("content-length");
          headers.delete("content-type");
        }

        current = next;
        continue;
      }

      const finalUrl = assertOfficialUrl(res.url || current.toString());
      const reader = res.body?.getReader();
      if (!reader) {
        return { url: finalUrl.toString(), status: res.status, contentType: res.headers.get("content-type") ?? "", text: "" };
      }

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
      return {
        url: finalUrl.toString(),
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        text: merged.toString("utf8")
      };
    }
    throw new Error("Redirect loop");
  } finally {
    clearTimeout(timer);
  }
}
