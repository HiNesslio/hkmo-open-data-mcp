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
  API key、bearer token、cookie、CSRF token、Referer、request parameter 等，必須由官方文件或官方公開流程確認。澳門 data.gov.mo 的公開 APPCODE 會由 MCP 在 runtime 透過官方 SPA metadata API 取得，僅在記憶體中短暫使用，不寫入 registry 或回傳原值。

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

讀取並檢查官方香港／澳門政府 HTTPS URL。當 URL 是 `https://data.gov.mo/Detail?id=...` 時，不再只讀 SPA HTML shell，而會改用官方 `api.data.gov.mo/datadir/detail/{datasetId}` metadata，解析現行 API ID、apiPath，以及 APPCODE 是否成功取得；APPCODE 原值會被 redacted。

內建：

- government-domain allowlist
- HTTPS only
- redirect destination revalidation
- request timeout
- response-size limit

#### `call_official_api`

呼叫已經驗證的政府 API endpoint。對已驗證的澳門 `*.apigateway.data.gov.mo` dataset，若沒有傳入 Authorization，MCP 會用 dataset UUID 從官方 runtime metadata 取得現行 APPCODE 並自動注入；可選傳入 `datasetId`，或由 verified registry 的 resource URL 安全反查。

Agent 不得自行發明：

- API token
- cookie
- authentication header
- CSRF token
- Referer
- request parameter

### 香港 Adapter

香港採用 **verified curated registry + 官方 DATA.GOV.HK metadata fallback**：

1. `registry/hk.json` 保存高可信、已核實的常用 dataset（交通、天氣、人口、公共設施等）；
2. verified exact registry hit 會直接返回，不會額外掃 catalog；
3. registry 未命中時，先使用 DATA.GOV.HK 官方「開放數據的數據集清單」作候選索引，再用 CKAN `package_show` 核實；
4. catalog 暫時不可用時會降級返回已有 curated candidate，而不令 MCP crash。

搜尋結果仍會經過 strict matching，metadata 搜到「相關」不代表一定符合使用者要求。

### 澳門 Adapter

澳門採用較保守的 registry 策略：

1. `registry/mo.json` 同時保存 `verified`、`manual_required`、`deprecated` 狀態；
2. 只有 `verified` dataset 可以升格為 exact / FOUND；
3. `manual_required` 只可作 discovery 診斷候選，必須重新核實更新頻率、格式及 API／下載方法後才可使用；
4. `deprecated` 不會返回；
5. token / APPCODE 值永不保存到 repository；
6. 在未確認穩定官方 machine-search endpoint 前，不自行假設或 reverse-engineer 一個搜尋 API。

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

### 驗證

普通單元測試：

```bash
npm run check
```

真正呼叫香港／澳門官方 live endpoint 的 E2E smoke test：

```bash
npm run e2e
```

GitHub 的 `Live E2E` workflow 預設只可手動執行；commit message 含 `[e2e]` 時亦會執行，避免一般 commit 因政府網站短暫波動而失敗。

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

Hong Kong uses a **verified curated registry plus official DATA.GOV.HK metadata fallback**:

1. `registry/hk.json` stores high-confidence verified datasets;
2. an exact verified registry hit returns immediately without a catalog scan;
3. otherwise the official DATA.GOV.HK dataset-list index is used for candidate discovery and CKAN `package_show` verifies the final metadata;
4. catalog failures degrade gracefully instead of crashing the MCP.

Candidates still pass through strict matching before they can be considered exact.

### Macao adapter

Macao uses a conservative status-aware registry:

1. `registry/mo.json` supports `verified`, `manual_required`, and `deprecated`;
2. only `verified` entries may become exact / FOUND;
3. `manual_required` entries are discovery-only until frequency, format, and API/download access are re-verified;
4. `deprecated` entries are not returned;
5. tokens and APPCODE values are never persisted;
6. no assumed or reverse-engineered machine-search API until a stable official endpoint is confirmed.

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

### Validation

Run deterministic checks:

```bash
npm run check
```

Run live smoke tests against official Hong Kong and Macao endpoints:

```bash
npm run e2e
```

The GitHub `Live E2E` workflow is manual by default, and also runs for commit messages containing `[e2e]`, so normal commits are not made flaky by temporary government-site outages.

### Security

Model-supplied URLs and headers are treated as untrusted input.

See [SECURITY.md](SECURITY.md) for the security policy.

## License

MIT
