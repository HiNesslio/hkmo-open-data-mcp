# hkmo-open-data-mcp

[中文](#中文) · [English](#english)

A zero-hosting **Agent Skill + local MCP server** for discovering and accessing **Hong Kong and Macao government open data** with strict region resolution and no semantic substitution.

一個毋須自行託管伺服器的 **Agent Skill + 本機 MCP Server**，用於尋找及存取**香港與澳門政府公開數據**；地域不明時會先詢問使用者，並禁止以「相近但不同」的資料集代替原本要求。

---

## 中文

### 設計原則

- **地域必須明確**：如果使用者沒有清楚指出香港或澳門，必須先反問「你想查香港定澳門嘅資料？」；不可自行推斷。
- **只接受精確資料**：如果找不到完全符合要求的政府公開數據，就回覆未找到。
- **禁止語意替代**：相近資料只能列作相關候選，不能當成使用者要求的資料。
- **預設只使用官方來源**：只接受 `*.gov.hk`、`*.gov.mo` 的 HTTPS 來源。
- **零託管成本**：使用本機 `stdio` MCP，不需要 VPS、雲端後端或長期伺服器費用。
- **不猜測 Token / Header**：API token、cookie、header、參數等必須由官方文件或官方流程驗證後才可使用；私人 secrets 只保留在使用者本機。

### 為甚麼同時使用 Skill + MCP？

**Skill** 負責約束 AI 行為，例如地域判斷、exact-match 規則及禁止資料替代；**MCP** 則負責可驗證的資料搜尋、官方 URL allowlist、HTTP request、response-size limit 及 API 存取。

### 安裝

需要 Node.js 20 或以上版本。

```bash
npm install
npm run build
```

直接執行：

```bash
node dist/src/index.js
```

使用 MCP Inspector 測試：

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js
```

Client 設定範例：

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

### MCP Tools

#### `resolve_region`

判斷要求屬於香港或澳門。如果地域不明，會返回澄清問題而不是猜測。

#### `search_datasets`

搜尋官方 metadata / registry，並套用 strict matching。`discoveryKeywords` 只可用於擴展搜尋詞，不可令相近資料變成 exact match。

#### `inspect_official_url`

只讀取 allowlist 內的香港／澳門政府 HTTPS URL，並設有 timeout 及 response-size limits。

#### `call_official_api`

呼叫已驗證的政府 API endpoint。Method、headers、body 及認證資料均不得由模型自行猜測。

### 現有 Adapter

#### 香港

使用 DATA.GOV.HK 官方 CKAN metadata API（`package_list` / `package_show`）。

#### 澳門

v0.1 先使用可審核的本機 registry 記錄已驗證的 `data.gov.mo` dataset，並可透過 `inspect_official_url` 檢查官方 dataset detail / API URL。直到有穩定、已確認的官方 machine-search endpoint 前，專案不會自行假設或 reverse-engineer 搜尋 API。

### Strict matching 範例

使用者要求：**澳門停車場實時空位**。

以下資料均不可視為符合要求：

- 停車場位置；
- 停車場收費；
- 開放時間；
- 歷史空位；
- 道路交通狀況。

這些項目最多只能顯示為「相關候選」，不得代替使用者原本要求，更不得自動呼叫其 API 當成答案。

### Security

HTTP gateway 會拒絕非政府 domain、非 HTTPS URL、過大的 response 以及超時 request，redirect destination 亦會再次驗證。詳情見 [`SECURITY.md`](SECURITY.md)。

### Agent Skill

Agent-facing policy 位於 [`skill/SKILL.md`](skill/SKILL.md)。支援 Agent Skills 的 client 可以直接採用或按需要調整。

---

## English

### Core behaviour

- **Region must be explicit.** If Hong Kong vs Macao is unclear, ask the user which region they mean. Never guess.
- **Exact data only.** If the requested government dataset cannot be found exactly, return **not found**.
- **No semantic substitution.** Similar datasets may be shown as related candidates, but must never replace the requested data.
- **Official sources by default.** Only HTTPS sources under `*.gov.hk` and `*.gov.mo` are accepted.
- **Zero hosting cost.** The MCP runs locally over `stdio`; no VPS, hosted backend, or recurring server bill is required.
- **Never invent tokens or headers.** Authentication values, cookies, headers, and parameters must be verified from official documentation or an official request flow. Private secrets remain local.

### Why Skill + MCP?

The **Skill** controls agent behaviour, including region clarification, exact-match requirements, and the no-substitution rule. The **MCP server** performs deterministic discovery, official URL allowlisting, HTTP requests, response limits, and API access.

### Install

Node.js 20 or newer is required.

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

### MCP tools

#### `resolve_region`

Returns HK or MO, or a clarification question if the region is not explicit.

#### `search_datasets`

Searches official metadata / registry and applies strict matching. `discoveryKeywords` may broaden discovery vocabulary, but can never turn a related dataset into an exact match.

#### `inspect_official_url`

Fetches only allowlisted Hong Kong or Macao government HTTPS URLs, with timeout and response-size limits.

#### `call_official_api`

Calls a verified government API endpoint using explicit method, headers, and body. The model must not invent authentication values or request parameters.

### Current adapters

#### Hong Kong

Uses DATA.GOV.HK's official CKAN metadata APIs (`package_list` and `package_show`).

#### Macao

v0.1 uses a small, auditable local registry for verified `data.gov.mo` datasets, plus `inspect_official_url` for official dataset-detail and API URLs. Until a stable official machine-search endpoint is verified, the project intentionally does not assume or reverse-engineer one.

### Strict matching example

A request for **real-time Macao car-park vacancy** is not satisfied by:

- car-park locations;
- parking tariffs;
- opening hours;
- historical vacancy;
- road traffic conditions.

Those may be returned only as *related candidates*. They must never be called or presented as the requested data.

### Security

The HTTP gateway rejects non-government hosts, non-HTTPS URLs, oversized responses, and long-running calls. Redirect destinations are revalidated. See [`SECURITY.md`](SECURITY.md).

### Agent Skill

The agent-facing policy is in [`skill/SKILL.md`](skill/SKILL.md). Copy or adapt it for clients that support Agent Skills.

## License

MIT
