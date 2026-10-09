# hkmo-open-data-mcp

**一句話，讓 AI 幫你使用香港與澳門政府公開數據。**

這是一個免費開源的 **AI Skill + MCP 工具**，讓 AI 幫你尋找、讀取及整理政府公開資料，不用自己逐個網站尋找資料和研究使用方法。

## 可以做甚麼？

- **查找資料**：例如香港巴士到站時間、澳門停車場空位、天氣或人口資料。
- **製作網站及 App**：讓 AI 找到合適的官方資料，協助你製作小工具、圖表及應用程式。
- **製作地圖**：澳門可解析官方地圖檔案；香港可接入 CSDI 官方道路形狀，輸出 GeoJSON、互動地圖或圖片。
- **減少錯誤**：優先核對官方來源；找不到符合要求的資料，就直接告訴你，不會用相似資料冒充。

## 怎樣安裝？

如果你使用的 AI 助手支援安裝 Skill 和 MCP，並能操作你的電腦，直接把這句話交給它：

```text
請幫我安裝並設定這個 AI Skill + MCP：
https://github.com/HiNesslio/hkmo-open-data-mcp

完成安裝、連接到我正在使用的 AI 工具，並確認可以正常使用。
```

安裝後，可以試試問 AI：

> 幫我查澳門停車場的即時空位，並附上政府資料來源。

> 幫我找香港巴士到站資料，協助製作一個簡單網頁。

> 幫我把澳門政府的巴士路線地圖資料做成互動地圖。

> 幫我取得香港道路形狀，製作中環附近的互動地圖。

## 自行安裝

需要 **Node.js 20 或以上版本**：

```bash
git clone https://github.com/HiNesslio/hkmo-open-data-mcp.git
cd hkmo-open-data-mcp
npm install
npm run build
```

然後在支援 MCP 的 AI 工具中，連接本機的 `dist/src/index.js`，並載入 [Skill 說明](skill/SKILL.md)。澳門 Shapefile 轉換另需安裝 Python 相關套件；香港 CSDI 地圖查詢不需要額外 Python 套件。

> 本工具在你的電腦上運行，不需要自行架設伺服器。部分資料可能需要由政府網站下載，亦並非所有公開資料都能直接使用。此專案並非政府官方產品。

---

## English

**Help your AI find and use Hong Kong and Macao government open data with a simple request.**

This free, open-source **AI Skill + local MCP** helps you discover official data, read supported datasets, build small apps and turn verified government map data into interactive maps or images, including Hong Kong CSDI road geometry. It checks sources rather than inventing missing information.

**Install with an AI agent** that supports local MCP and Skill setup:

```text
Please install and configure this Skill + MCP in my AI tool:
https://github.com/HiNesslio/hkmo-open-data-mcp
Verify the installation when finished.
```

For manual setup, use Node.js 20+, run `npm install && npm run build`, connect `dist/src/index.js` to your MCP client, and load [skill/SKILL.md](skill/SKILL.md). Geospatial conversion requires additional Python packages.

**License:** [MIT](LICENSE)
