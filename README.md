# hkmo-open-data-mcp

**讓 AI 用一句話，安全地找到並調用香港／澳門政府公開數據。**

[繁體中文](#繁體中文) · [English](#english) · [Skill](skill/SKILL.md) · [Security](SECURITY.md)

> 最近愈來愈多人用 AI 做網站、App、Dashboard 或小工具，但政府 Open Data 往往散落在不同目錄、API、下載檔案和認證方式之中。  
> `hkmo-open-data-mcp` 把「找資料 → 核實 → 取得 API → 調用」這段流程交給 AI，同時避免 AI 猜錯 dataset、亂補 token，或者拿相似資料冒充答案。

---

<a id="繁體中文"></a>

## 這是什麼？

你可以把它理解成一個給 AI 用的「香港／澳門政府公開數據入口」。

安裝後，可以直接跟支援 MCP / Agent Skills 的 AI 說：

- 「幫我查澳門停車場即時空位。」
- 「香港而家有咩天氣警告？」
- 「找香港九巴實時到站時間。」
- 「澳門最新總人口是多少？」
- 「幫我找香港公共廁所位置的官方資料。」
- 「用澳門政府 Open Data 找停車場資料，再告訴我 API 怎樣調用。」

AI 會先找 **官方資料集**，核實是否真的符合你的要求，再決定是否調用 API。

### 它不是什麼？

- 不是另一個 Open Data 資料庫。
- 不會把政府資料複製到自己的伺服器。
- 不需要你租 VPS。
- 不會因為「差不多」就拿另一份資料代替。
- 不會猜 API token、APPCODE 或 Header。

**資料來源是政府官方公開資料，但本專案本身不是香港或澳門政府官方項目。**

---

## 最簡單的安裝方法：把這句交給 AI

如果你的 AI / Coding Agent 支援安裝 Skill、MCP 或操作本機專案，可以直接把下面整段貼給它：

```text
請幫我安裝並設定這個 Skill + MCP：
https://github.com/HiNesslio/hkmo-open-data-mcp

請完成：
1. clone repository
2. 安裝 Node.js dependencies
3. build MCP server
4. 把本機 MCP 加到目前使用的 AI client / coding agent
5. 安裝或載入 skill/SKILL.md
6. 跑 npm run check 驗證
7. 告訴我設定完成後，可以怎樣直接用自然語言查香港／澳門政府公開數據

不要把任何私人 API key、token 或 credential 寫入 repository。
```

安裝完成後，可以直接試：

```text
幫我查澳門停車場即時空位資料，並告訴我官方資料來源。
```

或：

```text
幫我查香港實時天氣。
```

---

## v0.3：AI 可以解析 Shapefile ZIP，並輸出地圖

### v0.3.1：澳門 Macao Grid 大地基準轉換修正

**Shapefile 讀得出來，不代表點位放得準。** 澳門部分官方 `.prj` 寫成 `Macau_Grid` / `D_Macau`，但缺少 `TOWGS84` 等 datum shift 參數。單靠 .prj 使用一般自動轉換，可能退化成 ballpark geographic offset，產生約百米級偏移。

新版會先核對原始 datum、International 1924 橢球、Transverse Mercator 與 Macao Grid 投影參數；**只有完全匹配**，先用 **EPSG:8433（Macao 1920 / Macao Grid）** 作來源，選用 **EPSG:8438（Macao 1920 to WGS 84 (1)，Molodensky–Badekas，標示精度約 1 米）** 轉換至 EPSG:4326。

- `pyproj` 使用 `always_xy=True`、`allow_ballpark=False`，並明確檢查所選 datum operation。
- 轉換資料連同 `sourceCrs`、`targetCrs`、`operation`、`operationEpsg`、`accuracyMeters`、`ballpark` 回傳，避免靜默猜測。
- 其他地區／不符合 EPSG:8433 定義嘅投影**不會被強行當作澳門格網**；如無可核實轉換便明確報錯。
- GeoJSON、互動地圖、GeoPandas 繪圖，都會共用**完成大地基準轉換後**嘅 WGS84 座標。

**Shapefile ZIP 功能額外需要 Python 套件**（Node.js MCP 本身仍只需原有 npm 安裝）：

```bash
python3 -m pip install pyproj pyshp
npm install
npm run build
npm run check
```

若需要直接生成 GeoPandas PNG，再安裝：

```bash
python3 -m pip install geopandas matplotlib
```

如 Python 執行檔非 `python3`，可設定環境變數 `HKMO_PYTHON_BIN`。缺少轉換套件時會報錯，**不會回退到錯誤嘅 JavaScript ballpark 座標**。

參考：[EPSG:8433](https://epsg.io/8433) · [EPSG:8438](https://epsg.io/8438) · [pyproj Transformer](https://pyproj4.github.io/pyproj/stable/api/transformer.html)



當你要求 AI 使用政府公開地理資料（例如巴士站、道路、公共設施），如果官方提供的是 Shapefile ZIP，AI 會先問你：

**「想要哪種輸出？」**

1. **GeoJSON 原始檔案**：將 ZIP 內每個 Shapefile layer 轉成獨立 `.geojson`，適合自己開發、分析或匯入 GIS。
2. **互動地圖**：預設輸出可直接在瀏覽器開啟的 **MapLibre HTML**（免 Mapbox Token）；亦可選 **React + Mapbox** TSX 組件，用於現有網站。
3. **Python GeoPandas 圖片**：輸出 `render_geopandas.py`，並在本機有 Python、GeoPandas、Matplotlib 時自動生成 `map.png`。

### 一句話用法

> 幫我將澳門巴士路線 Shapefile ZIP 轉成互動地圖。

如果你未指明輸出格式，`export_shapefile` 會先回傳 **NEEDS_OUTPUT_CHOICE**，要求 AI 反問，唔會直接假定你要邊種。

### 兩個新 Tool

- `inspect_shapefile_zip`：檢查 ZIP 內有幾層 Shapefile、`.shp/.dbf/.prj` 是否齊全、大小是否安全。
- `export_shapefile`：選擇 `geojson`、`interactive_map` 或 `python_image`，輸出真正本機檔案路徑。

### 官方 ZIP 或本機 ZIP

如果 dataset 的 `list_resources` 已有可核實 ZIP URL，可傳 `region`、`datasetId`、`resourceId`，由 MCP 安全下載。

如果澳門 dataset 只提供官方 Detail 頁，但未能取得可核實的檔案下載 URL，可先**由官方網站手動下載 ZIP**，放入指定資料夾：

```bash
# macOS / Linux 示範
mkdir -p "$HOME/hkmo-geo-input"
export HKMO_GEO_INPUT_DIR="$HOME/hkmo-geo-input"
# 將官網下載的 .zip 放入上述資料夾，再開始 MCP。
```

之後只需傳 ZIP **檔名**（例如 `bus_routes.zip`），MCP 唔會讀取資料夾以外嘅路徑或猜下載 token。需同時指定 verified `datasetId`，確保政府來源清楚。輸出預設放在本機暫存目錄 `hkmo-open-data-exports`，亦可用 `HKMO_GEO_OUTPUT_DIR` 指定位置。

### 地圖及座標注意事項

- **必須有可信座標系統**：ZIP 需附 `.prj`；否則只有用戶能明確確認資料本來就係 `EPSG:4326`，先可以加 `declaredCrs: "EPSG:4326"`。唔會猜澳門／香港本地投影。
- 輸出 GeoJSON 會檢查 WGS84 經緯度範圍；轉換唔可靠就拒絕，而唔係放錯巴士站／道路位置。
- ZIP 最大 12 MB，解壓後合計最多 64 MB，最多 100,000 features；防止壓縮炸彈、路徑穿越或異常文件。
- MapLibre HTML 的地圖庫及 OpenStreetMap 底圖需要上網；React + Mapbox 需要在 Vite 專案安裝 `mapbox-gl`，並自行設定 `VITE_MAPBOX_TOKEN`，唔會將 token 寫入成果。
- GeoPandas 圖片需要本機安裝：`python -m pip install geopandas matplotlib`。如未安裝，MCP 仍會輸出可執行腳本，並明確回覆未能生成 PNG。
- 產出檔案位於 **MCP 運行的本機**，唔會自動上傳雲端或自動展示成 ChatGPT 附件；Agent 可以開啟或搬運成果。

---

## v0.2：AI 可以直接讀取資料

新版不只可以找政府 dataset，仲會幫你解析常用格式，回傳**有欄位名稱、列數限制、官方來源**嘅結果。

例如安裝後向 AI 說：

> 請找澳門「停車場車位資訊」官方 dataset，列出車位資訊，最多 10 筆，附上政府來源。

AI 可以按以下次序使用 MCP：

1. `search_datasets`：只有官方**完整標題或經核實嘅 exact alias** 才算 FOUND。
2. `inspect_dataset`：檢查資料集、更新頻率同資源。
3. `list_resources`：取得可用資源 ID，同所需路徑／查詢參數。
4. `query_dataset`：由 MCP 使用已驗證 resource、讀取 JSON／XML／CSV／XLSX，按筆數及欄位輸出。

**新增安全限制：** `call_official_api` 保留作舊介面，但必須傳入 `region`、`datasetId`、`resourceId` 同與該資源完全相同嘅 URL／方法。任意官方 URL、私自指定 Authorization、未驗證 dataset、未列明參數都不能直接調用。建議新用戶使用 `query_dataset`。

**一般表格讀取：** JSON、XML、CSV、XLSX（Shapefile ZIP 請使用 v0.3 新增的專用工具；一般 ZIP／舊 XLS 不支援）。資料請求和試算表有大小限制；預設只回傳 20 筆，最多 50 筆，避免把整份大型檔案灌進 AI。澳門下載型 dataset 若未提供可核實嘅實際下載連結，只會列出資料集，唔會猜 URL。

> 這是 open-data access 工具，唔係全能資料爬蟲。香港／澳門官方 metadata 變動、來源失效或部分非 `gov.hk`／`gov.mo` 嘅外部資源可能無法直接使用。無法核實時會明確失敗，唔會用其他數據代替。

### 本地驗證（不使用 GitHub Actions）

```bash
npm install
npm run check
npm run e2e
```

`npm run check` 測程式同 parser；`npm run e2e` 會即時連接官方網站，可能受政府服務連線情況影響。

---

## 為什麼要做這個？

政府其實已經公開了很多有用資料，但對一般使用者來說，常見問題是：

1. **不知道哪一份 dataset 才是正確的。**
2. 搜到「相似資料」，但其實不是自己要的資料。
3. API endpoint、格式、更新頻率散落在 metadata 裡。
4. 有些 API 要特定 Header 或公開 APPCODE。
5. 澳門 `data.gov.mo` 的 Detail 頁是 SPA，單純抓 HTML 不一定拿到真正 API 設定。
6. AI 很容易在資料不足時「合理地猜」，但查政府數據時這樣做並不可靠。

所以這個專案最重要的規則只有兩條：

> **不知道是香港還是澳門，就先問。**

> **找不到完全符合的資料，就說找不到，不拿相似 dataset 代替。**

例如你問：

```text
澳門停車場實時空位
```

「停車場地址」、「泊車收費」、「歷史空位」都 **不算答案**。

---

## 它現在可以處理什麼？

### 香港

香港使用：

```text
verified registry
      ↓
找不到才查 DATA.GOV.HK 官方 metadata
      ↓
核實 dataset
      ↓
調用官方 API / resource
```

目前已特別整理常用的：

- 停車場空置車位
- 九巴／龍運 ETA
- 城巴 ETA
- 港鐵／輕鐵實時列車
- 公共交通路線及收費
- 道路交通數據
- 香港天文台實時天氣
- 人口資料
- 公共設施位置

Registry 沒有的資料，仍可以 fallback 到官方 DATA.GOV.HK metadata 搜尋。

### 澳門

澳門使用較保守的 verified registry：

```text
verified
    → 可以核實後使用

manual_required
    → 只可以告訴你「找到候選」
    → 不可以直接當成答案或調 API

deprecated
    → 不使用
```

目前涵蓋交通、天氣／環境、人口、教育、醫療、體育、文化等常用資料。

### 澳門 APPCODE 會自動處理

`data.gov.mo` 部分 API 需要：

```http
Authorization: APPCODE ...
```

但 **APPCODE 不會寫死在 registry 或 GitHub**。

MCP 會在需要時走官方 runtime metadata：

```text
data.gov.mo Detail
      ↓
api.data.gov.mo/datadir/detail/{datasetId}
      ↓
取得目前 appCode + apiId
      ↓
api.data.gov.mo/api/{apiId}
      ↓
取得目前 apiPath
      ↓
臨時注入 APPCODE
      ↓
調用官方 API
```

APPCODE 只在記憶體短暫使用，工具輸出會顯示為 `[redacted]`。

---

## 手動安裝

需要 **Node.js 20+**。

```bash
git clone https://github.com/HiNesslio/hkmo-open-data-mcp.git
cd hkmo-open-data-mcp
npm install
npm run build
```

啟動本機 MCP：

```bash
node dist/src/index.js
```

用 MCP Inspector 測試：

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js
```

MCP client 設定範例：

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

Skill 位於：

```text
skill/SKILL.md
```

不同 AI client 安裝 Skill / MCP 的方式可能不同，請按你使用的 client 設定。

---

## AI 實際會怎樣工作？

```text
你提出問題
    ↓
香港還是澳門？
    ├─ 不清楚 → 先問你
    ↓
搜尋官方 dataset
    ↓
完全符合？
    ├─ 否 → NOT_FOUND / 未驗證候選
    ↓
核實官方 endpoint / method / auth
    ↓
調用 API
    ↓
回覆資料 + 官方來源
```

### 四個 MCP Tools

| Tool | 用途 |
| --- | --- |
| `resolve_region` | 判斷香港／澳門；不明確就要求澄清 |
| `search_datasets` | 搜尋官方 dataset，並做 strict matching |
| `inspect_official_url` | 檢查官方 URL / metadata；澳門 Detail 會解析 SPA 背後 metadata |
| `call_official_api` | 調用已核實的官方 API；澳門可自動取得 runtime APPCODE |

---

## 我刻意做了哪些限制？

這個專案寧願少答，也不要「看起來很合理但其實錯」。

- 只信任 HTTPS 政府來源：`*.gov.hk`、`*.gov.mo`
- 香港／澳門不明確時不能自行猜
- 相似 dataset 不能代替 exact dataset
- `manual_required` 不能升格做 exact
- 不保存 APPCODE / token
- 不猜 Cookie、CSRF、Referer 或 authentication header
- redirect 每一跳都重新驗證官方 domain
- 有 timeout 和 response-size limit
- 跨 host redirect 會移除敏感 Header

詳細安全設計見 [SECURITY.md](SECURITY.md)。

---

## 舊版驗證說明

普通測試：

```bash
npm run check
```

真正連接香港／澳門政府 live endpoint：

```bash
npm run e2e
```

目前 E2E 包括：

- 香港天文台 live JSON
- 澳門氣象局 live XML
- 澳門 verified / manual-required guard
- 澳門 data.gov.mo runtime APPCODE → 停車場 live API

GitHub 的 **Live E2E** workflow 預設只在手動觸發，或 commit message 包含 `[e2e]` 時執行，避免政府網站短暫波動令一般 commit 無故失敗。

---

## 給開發者

專案分成兩層：

### Agent Skill

`skill/SKILL.md`

負責：

- 地域判斷
- exact-match policy
- 禁止 semantic substitution
- verified / manual-required 規則
- API 使用流程

### Local MCP Server

負責：

- 香港 DATA.GOV.HK discovery
- 香港／澳門 registry
- 官方 URL allowlist
- API request
- Macao runtime APPCODE resolution
- redirect / timeout / size guard
- deterministic validation

使用本機 `stdio`，所以 **沒有 VPS、Cloudflare Worker 或其他必需的常駐 hosting 成本**。

---

## Contributing

歡迎補充更多香港／澳門官方 dataset。

但新增資料前，請確保可以核實：

- 官方來源
- dataset ID
- 更新頻率
- 資料格式／類型
- API 或下載方式
- authentication 規則

**找不到就不要猜。**

詳情見 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

<a id="english"></a>

# English

**Let AI safely discover and call Hong Kong and Macao government open data with a natural-language request.**

This project combines an **Agent Skill + local MCP server**. It is designed for people building apps, websites, dashboards, research tools, or AI agents with government open data.

Two rules are non-negotiable:

1. **If Hong Kong vs Macao is unclear, ask first.**
2. **If the exact dataset cannot be verified, return not found. Never silently substitute a similar dataset.**

## Install with an AI Agent

Give this prompt to an AI / coding agent that can install Skills and MCP servers:

```text
Please install and configure this Skill + MCP:
https://github.com/HiNesslio/hkmo-open-data-mcp

Please:
1. clone the repository
2. install Node.js dependencies
3. build the MCP server
4. configure the local MCP in my current AI client / coding agent
5. install or load skill/SKILL.md
6. run npm run check
7. tell me how to query Hong Kong and Macao government open data in natural language

Do not write private API keys, tokens, or credentials into the repository.
```

Then try:

```text
Find the official real-time Macao car-park vacancy data and tell me the source.
```

## Why use it?

Government data is useful, but discovery and API access can be fragmented. This project handles:

- official dataset discovery;
- strict exact matching;
- official URL and endpoint verification;
- live API calls;
- Hong Kong DATA.GOV.HK fallback discovery;
- Macao runtime APPCODE resolution;
- protection against guessed authentication or semantic substitution.

It runs locally over `stdio`, so no hosted backend is required.

## Manual install

Node.js 20+:

```bash
git clone https://github.com/HiNesslio/hkmo-open-data-mcp.git
cd hkmo-open-data-mcp
npm install
npm run build
node dist/src/index.js
```

Example MCP config:

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

The Agent Skill is at `skill/SKILL.md`.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `resolve_region` | Resolve HK/MO; ask when ambiguous |
| `search_datasets` | Search official datasets with strict matching |
| `inspect_official_url` | Inspect official metadata and URLs |
| `call_official_api` | Call verified official APIs |

For Macao API-gateway datasets, current public APPCODE values are resolved at runtime from the official `data.gov.mo` metadata flow. They are not persisted in the registry or exposed in normal tool output.

## Validation

```bash
npm run check
npm run e2e
```

Live E2E covers Hong Kong and Macao official endpoints, including Macao runtime APPCODE → live car-park API access.

## v0.3 Shapefile ZIP → GeoJSON / interactive map / Python image

Shapefile ZIP is supported through two separate MCP tools: `inspect_shapefile_zip` and `export_shapefile`. The export tool **asks the user to choose** when `outputMode` is omitted, instead of producing an arbitrary artifact.

- `geojson`: WGS84 `.geojson` files, one per layer.
- `interactive_map`: standalone MapLibre HTML (uses online JS/OSM tiles) or React + Mapbox TSX + GeoJSON files (user-supplied Mapbox token).
- `python_image`: GeoPandas/Matplotlib `render_geopandas.py` script and a PNG when those optional Python packages are installed.

Files are generated on the **local MCP host**, not remotely uploaded. Set `HKMO_GEO_INPUT_DIR` for a manually downloaded official ZIP (pass only `inputFile`, not an unrestricted path). `HKMO_GEO_OUTPUT_DIR` optionally sets the artifact directory.

ZIP archives require matching `.shp/.dbf` layers and a `.prj`, unless the user explicitly confirms `EPSG:4326`. Projected coordinates are transformed by Shapefile.js to WGS84, and invalid longitude/latitude values are rejected. Archive size, compression ratio and feature limits apply.

For local rendering install `geopandas` and `matplotlib`; React/Mapbox needs `mapbox-gl` and `VITE_MAPBOX_TOKEN`.

## v0.2 structured data access

The MCP now requires verified dataset/resource binding for all API calls. Discover with `search_datasets`, then use `inspect_dataset`, `list_resources`, and `query_dataset`. Only exact official titles or curated aliases are considered exact; full-text word coverage is not sufficient.

The built-in reader supports bounded JSON, XML, CSV and XLSX rows with column selection and official provenance. Unsupported binary formats such as XLS, generic ZIP and Shapefile are not silently interpreted.

The legacy `call_official_api` tool remains available but requires a verified region, dataset ID, resource ID, matching URL and method. Manual Authorization and arbitrary query parameters are rejected.

Run `npm run check` and `npm run e2e` on your own computer; no GitHub Actions workflow is used.

## License

MIT
