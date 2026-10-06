# hkmo-open-data-mcp

Zero-hosting **Skill + local MCP server** for discovering and accessing **Hong Kong and Macao government open data** with conservative, non-hallucinatory rules.

## Core behaviour

- If HK/MO is unclear, ask the user which region they mean.
- If the exact requested dataset is not found, return **not found**.
- Never silently replace the request with a similar dataset.
- Government sources only by default (`*.gov.hk`, `*.gov.mo`).
- Local `stdio` MCP: no VPS, no hosted backend, no recurring server bill.
- Tokens/headers are used only when verified from official sources; private secrets stay local.

## Why Skill + MCP?

The Skill controls agent behaviour and prevents semantic substitution. The MCP performs deterministic discovery, URL allowlisting, HTTP calls, response limits and API access.

## Install

```bash
npm install
npm run build
```

Run directly:

```bash
node dist/src/index.js
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js
```

Example client configuration:

```json
{
  "mcpServers": {
    "hkmo-open-data": {
      "command": "node",
      "args": ["/absolute/path/hkmo-open-data-mcp/dist/src/index.js"]
    }
  }
}
```

## MCP tools

### `resolve_region`
Returns HK/MO or a clarification question. It never guesses an ambiguous region.

### `search_datasets`
Searches official metadata/registry and applies strict matching. `discoveryKeywords` can expand search vocabulary but cannot make a related dataset count as an exact match.

### `inspect_official_url`
Fetches only allowlisted HK/MO government HTTPS URLs, with timeout and response-size limits.

### `call_official_api`
Calls a verified government endpoint with explicit method, headers and body. It does not generate authentication values.

## Current adapters

### Hong Kong
Uses DATA.GOV.HK's official CKAN metadata APIs (`package_list` and `package_show`).

### Macao
v0.1 uses a small auditable registry for known `data.gov.mo` datasets plus `inspect_official_url` for official detail/API URLs. This is intentionally conservative until a stable official machine-search endpoint is documented. Contributions that add a verified official Macao catalogue-search adapter are welcome.

## Strict matching policy

A request for **real-time car-park vacancy** is not satisfied by:

- car-park locations;
- parking tariffs;
- opening hours;
- historical vacancy;
- road traffic conditions.

Those may be returned as *related candidates* but must never be called or presented as the requested data.

## Security

The HTTP gateway rejects non-government hosts, non-HTTPS URLs, oversized responses and long-running calls. Redirect destinations are revalidated. See `SECURITY.md`.

## Skill

`skill/SKILL.md` contains the agent-facing policy. Copy/adapt it for clients that support Agent Skills.

## License

MIT
