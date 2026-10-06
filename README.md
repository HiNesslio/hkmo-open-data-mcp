# hkmo-open-data-mcp

**繁體中文** | [English](#english)

一個毋須自行託管伺服器的 **Agent Skill + 本機 MCP Server**，用於讓 AI 尋找、驗證及讀取 **香港與澳門政府公開數據**。

核心原則只有兩個，而且是硬性規則：

1. **香港／澳門不明確時，必須先問使用者。**
2. **找不到完全相符的資料時，回覆未找到；不得用相近但不同的資料代替。**

> 例如使用者只說「幫我搵停車場空位資料」，Agent 必須先問「你想查香港定澳門嘅資料？」  
> 如果使用者要求「澳門停車場實時空位」，只有停車場位置、收費或歷史空位資料時，必須視為 **NOT_FOUND**，不可當成答案。

---

## 繁體中文

### 專案目標

`hkmo-open-data-mcp` 希望提供一個可供 ChatGPT、Claude、Codex 或其他支援 MCP / Agent Skills 的 AI client 使用的政府 Open Data gateway。

專案由兩部分組成：

- **Skill**：規定 Agent 如何判斷地域、搜尋資料、處理 exact match，以及何時必須停止並回覆未找到。
- **Local MCP Server**：真正執行政府資料搜尋、官方 URL 驗證、HTTP request、API 呼叫及安全限制。

MCP 使用本機 `stdio` 執行，因此 **不需要 VPS、雲端後端或持續伺服器費用**。

### 設計原則

- **地域必須明確**  
  如果要求沒有明確指出香港或澳門，必須先反問，不可自行推斷。

- **Exact data only**  
  資料內容、指標、時間性、地域及粒度必須與要求相符。

- **禁止語意替代**  
  相近資料可以列為 related candidate，但不可冒充使用者真正要求的資料。

- **官方來源優先且預設唯一可信來源**  
  預設只接受 `*.gov.hk`、`*.gov.mo` 的 HTTPS 來源。

- **不猜測 API Token / Header**  
  API key、bearer token、cookie、CSRF token、Referer、request parameter 等，必須由官方文件或官方公開流程確認。

- **Secrets 只留在本機**  
  私人 credential 不應寫入 Skill、registry、log 或 Git repository。

### 安裝

需要 Node.js 20 或以上版本。

```bash
git clone https://github.com/HiNesslio/hkmo-open-data-mcp.git
cd hkmo-open-data-mcp
npm install
npm run build
```

直接執行：

```bash
node dist/src/index.js
```

使用 MCP Inspector：

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

判斷要求屬於香港或澳門。

如果地域不明，返回：

```text
你想查香港定澳門嘅資料？
```

而不是自行猜測。

#### `search_datasets`

搜尋官方 metadata / registry，並套用 strict matching。

`discoveryKeywords` 可以使用中文、英文或葡文同義詞幫助搜尋候選資料，但 **不能降低最後 exact-match 標準**。

#### `inspect_official_url`

讀取並檢查官方香港／澳門政府 HTTPS URL。

內建：

- government-domain allowlist
- HTTPS only
- redirect destination revalidation
- request timeout
- response-size limit

#### `call_official_api`

呼叫已經驗證的政府 API endpoint。

Agent 不得自行發明：

- API token
- cookie
- authentication header
- CSRF token
- Referer
- request parameter

### 香港 Adapter

香港目前使用 **DATA.GOV.HK 官方 CKAN metadata API**：

- `package_list`
- `package_show`

搜尋結果仍會經過 strict matching，metadata 搜到「相關」不代表一定符合使用者要求。

### 澳門 Adapter

澳門 v0.1 採用較保守策略：

1. 使用本機 registry 保存已驗證的 `data.gov.mo` dataset；
2. 只接受官方 `data.gov.mo` / `api.data.gov.mo` URL 作進一步 inspection；
3. 如果未找到 exact dataset，返回未找到或 discovery limited；
4. 在未確認穩定官方 machine-search endpoint 前，不自行假設或 reverse-engineer 一個搜尋 API。

### Strict Matching 範例

使用者要求：

> 澳門停車場實時空位

以下資料 **全部不能視為符合要求**：

- 停車場位置
- 停車場收費
- 停車場開放時間
- 歷史空位紀錄
- 道路交通狀況

正確結果應是：

```text
未找到完全符合要求的政府公開數據。
```

除非找到並驗證真正提供「澳門停車場實時空位」的官方 dataset/API。

### Agent Skill

Agent policy 位於：

```text
skill/SKILL.md
```

主要流程：

```text
User request
    ↓
Resolve HK / MO
    ↓
Region unclear? ── Yes ──→ Ask user and STOP
    ↓ No
Search official datasets
    ↓
Exact match?
 ├─ No  → NOT_FOUND
 └─ Yes
    ↓
Verify official detail / endpoint
    ↓
Verify method / params / headers / auth
    ↓
Call official API
    ↓
Return data
```

### Security

HTTP gateway 將模型提供的 URL / headers 視為不可信輸入。

詳細安全政策見 [SECURITY.md](SECURITY.md)。

---

<a id="english"></a>

## English

`hkmo-open-data-mcp` is a **zero-hosting Agent Skill + local MCP server** for discovering, validating, and accessing **Hong Kong and Macao government open data**.

It follows two non-negotiable rules:

1. **If Hong Kong vs Macao is unclear, ask the user first.**
2. **If the exact requested data cannot be found, return not found. Never substitute a similar dataset.**

> If a user asks only for “car park vacancy data”, the agent must first ask whether they mean Hong Kong or Macao.  
> If the user requests “real-time Macao car-park vacancy” but only location, tariff, or historical vacancy datasets exist, the request must be treated as **NOT_FOUND**.

### Architecture

The project contains two layers:

- **Agent Skill** — controls region clarification, strict matching, no-substitution behaviour, and the required workflow.
- **Local MCP Server** — performs deterministic discovery, official-domain validation, HTTP requests, response limits, and verified API access.

The MCP server runs locally over `stdio`, so **no VPS, hosted backend, or recurring server bill is required**.

### Core behaviour

- **Region must be explicit.** Never infer HK vs MO when the request is ambiguous.
- **Exact data only.** Metric, geography, time basis, granularity, and real-time/static semantics must match.
- **No semantic substitution.** Related datasets may be shown as candidates, but never used as replacements.
- **Official government sources by default.** Only HTTPS sources under `*.gov.hk` and `*.gov.mo` are accepted.
- **Never invent authentication.** Tokens, cookies, headers, CSRF values, Referer values, and request parameters must be verified.
- **Private secrets stay local.**

### Install

Node.js 20 or newer is required.

```bash
git clone https://github.com/HiNesslio/hkmo-open-data-mcp.git
cd hkmo-open-data-mcp
npm install
npm run build
```

Run:

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

Returns HK or MO. If the region is not explicit, it returns a clarification question instead of guessing.

#### `search_datasets`

Searches official metadata / registry and applies strict matching.

`discoveryKeywords` may broaden multilingual discovery, but they can never relax the final exact-match requirement.

#### `inspect_official_url`

Fetches only allowlisted Hong Kong or Macao government HTTPS URLs with redirect validation, timeout, and response-size limits.

#### `call_official_api`

Calls a verified official government API endpoint.

The model must not invent authentication values, headers, cookies, tokens, or request parameters.

### Hong Kong adapter

Hong Kong discovery currently uses the official **DATA.GOV.HK CKAN metadata APIs**:

- `package_list`
- `package_show`

Candidates still pass through strict matching before they can be considered exact.

### Macao adapter

Macao v0.1 intentionally uses a conservative approach:

1. a local registry for verified `data.gov.mo` datasets;
2. inspection of official `data.gov.mo` / `api.data.gov.mo` URLs only;
3. NOT_FOUND / discovery-limited results when no exact dataset is verified;
4. no assumed or reverse-engineered machine-search API until a stable official endpoint is confirmed.

### Strict matching example

A request for **real-time Macao car-park vacancy** is not satisfied by:

- car-park locations;
- parking tariffs;
- opening hours;
- historical vacancy;
- road traffic conditions.

Those may be shown only as related candidates.

### Agent Skill

The agent-facing policy is located at:

```text
skill/SKILL.md
```

Expected workflow:

```text
User request
    ↓
Resolve HK / MO
    ↓
Region unclear? ── Yes ──→ Ask user and STOP
    ↓ No
Search official datasets
    ↓
Exact match?
 ├─ No  → NOT_FOUND
 └─ Yes
    ↓
Verify official detail / endpoint
    ↓
Verify method / params / headers / auth
    ↓
Call official API
    ↓
Return data
```

### Security

Model-supplied URLs and headers are treated as untrusted input.

See [SECURITY.md](SECURITY.md) for the security policy.

## License

MIT
