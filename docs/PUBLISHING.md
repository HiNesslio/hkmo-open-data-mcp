# Publishing to MCP directories

This is a **local stdio MCP server**. Do not publish a fictitious remote MCP URL or promise that the server is already listed. Publishing needs the maintainer's authenticated accounts; no GitHub Actions are required.

## Before publishing

1. Check that `package.json`, `server.json`, `manifest.json` and the MCP server version all match.
2. Install Node.js 20+, then run:
   ```bash
   npm install
   npm run check
   npm pack --dry-run
   ```
3. Review the packaged files: `dist/src/index.js`, the `dist/registry` catalogue JSON files, and `dist/src/geo-transform.py` must be present.
4. Confirm the npm package name `hkmo-open-data-mcp` is available or owned by the maintainer. If not, choose an npm name you own, and update **both** `package.json` and `server.json` before publishing.

## 1. Official MCP Registry

Official docs: https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx

The official registry lists **metadata**, not npm source code. The public npm release must exist **before** calling `mcp-publisher publish`.

```bash
npm login
npm publish --access public
# Check https://www.npmjs.com/package/hkmo-open-data-mcp for the released version.

# Install official mcp-publisher following its docs, e.g. on macOS:
brew install mcp-publisher

mcp-publisher validate server.json
mcp-publisher login github
mcp-publisher publish server.json
```

- The GitHub OAuth login belongs to the repository maintainer; don't share tokens or paste device codes into issues.
- Official registry name: `io.github.hinesslio/hkmo-open-data-mcp`.
- The public npm package **must** have matching `mcpName` in its `package.json`.
- After successful publication, confirm by searching the official API:
  `https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.hinesslio/hkmo-open-data-mcp`

## 2. Smithery

Smithery's current CLI can publish an **MCPB bundle** for a local server; a GitHub repo URL alone is not a running remote MCP endpoint.

```bash
npm install -g smithery
npm run pack:mcpb
smithery auth login
smithery namespace list
# Choose a namespace you own. Example:
smithery mcp publish releases/hkmo-open-data-mcp-0.5.1.mcpb -n YOUR_NAMESPACE/hkmo-open-data-mcp
```

The bundle contains the Node.js server plus production dependencies, but the optional Macau geospatial converter still requires local Python with `pyproj` / `pyshp`, and GeoPandas image generation also requires `geopandas` / `matplotlib`.

Reference: https://github.com/arcadeai-labs/smithery-cli

## 3. MCP.so

Submit the public GitHub repository through: https://mcp.so/submit?type=server

- Name: `HK/MO Open Data MCP`
- URL: `https://github.com/HiNesslio/hkmo-open-data-mcp`
- Type: local MCP server / stdio
- Short description: "A local MCP + Skill that lets AI discover and read official Hong Kong and Macao open data, transport information, and map geometry."
- Install instructions: link to the repository README.

The site's submission interface may request payment for immediate or priority publication; do not authorize any payment without explicit confirmation. Listing is not complete until the site actually shows an indexed server page.

## Publication status

These configuration files only prepare the project for publication. Do **not** add "available on Official MCP Registry / Smithery / MCP.so" badges until each directory confirms its listing.
