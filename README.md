# mcp-server-104

台灣 104 人力銀行的 MCP server。讓 Claude（或任何 MCP client）能直接搜尋 104 的即時職缺。

## 這個工具適合你嗎？

| 你的情境 | 最佳工具 |
|---------|---------|
| 偶爾自己找工作 | 直接開 104 網站 |
| 想寫個一次性爬蟲抓資料 | Playwright / cycletls 腳本就好，不用 MCP |
| 想讓 Claude 幫你分析/比對/彙整/自動化職缺 | **這個 MCP** |

## ⚠️ 免責聲明（請先讀）

- 104 **沒有公開官方 API**。本專案使用的是網頁前端的**非官方內部 endpoint**，隨時可能因 104 改版而失效。
- 自動化存取**可能違反 104 的服務條款**。本專案僅供**個人、低頻、學習用途**。
- **請勿**拿去做高頻抓取、大量爬取，或架成公開服務 —— 容易被封鎖，也有法律風險。
- 本專案已內建禮貌性節流（每次請求間隔隨機 1.5~3.5 秒），請勿移除或調低。
- 使用本專案造成的任何後果，使用者自負。

## 用什麼方法取得資料

104 的搜尋 API 藏在 Cloudflare bot 防護後面。用 `curl` 或 Node `fetch`（即使帶 Referer / User-Agent）都會被擋 —— 回 403 或 Cloudflare 的 "Just a moment..." 挑戰頁。

**關鍵不是 header，是 TLS 指紋。** Cloudflare 會檢查 TLS 握手的指紋（JA3）；一般程式的指紋一看就不是瀏覽器，直接被攔。

本專案用 **[cycletls](https://github.com/Danny-Dasilva/CycleTLS)** 偽裝成 Chrome 的 TLS 指紋，讓 Cloudflare 以為請求來自真瀏覽器 → 放行。這樣**不用開瀏覽器**（比 Playwright / Selenium 輕一個量級、快、好部署），純 HTTP 就能拿到真實 JSON。

> cycletls 底層是一個 Go 寫的 TLS client 子程序，server 啟動時開一次、全程共用。

## 現在有什麼

| Tool | 狀態 | 說明 |
|------|------|------|
| `search_jobs` | ✅ 真實資料 | 依關鍵字 + 多種篩選搜尋職缺，支援分頁 |
| `get_job_detail` | ✅ 真實資料 | 取得單筆職缺完整詳情：完整 JD、薪資、地點、學經歷要求、技能、語言能力、福利、產業別 |
| `get_company_jobs` | ✅ 真實資料 | 列出某公司所有在徵職缺（分頁） |

### `search_jobs` 參數

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `keyword` | ✅ | 職務關鍵字，例如 `Rust 工程師` |
| `area` | | 工作地區名稱，例如 `台北市`、`新竹`（自動解析成 104 官方地區代碼查詢） |
| `salaryMin` | | 月薪下限（新台幣），例如 `60000`。薪資明確低於此值的濾掉；面議預設保留 |
| `excludeNegotiable` | | 設 `true` 排除「面議」職缺。預設 `false` |
| `excludeFeatured` | | 設 `true` 排除 104 付費廣告職缺（`featured=true` 那些）。預設 `false` |
| `jobCategory` | | 職務類別名稱，例如 `軟體工程師`（自動解析成 104 官方職類代碼查詢） |
| `remote` | | 遠端：`full` 完全遠端 / `partial` 部分遠端 / `any` 皆可 |
| `jobType` | | 工作性質：`fulltime` 全職 / `parttime` 兼職 |
| `experience` | | 需求年資：`under-1y` / `1-3y` / `3-5y` / `5-10y` / `over-10y` |
| `page` | | 第幾頁（每頁 20 筆），預設 1。想看更多就往後翻 |
| `limit` | | 本頁回傳筆數上限，最多 20，預設 5 |

> **篩選參數的實作眉角**（都是觀察 104 官網 UI 實際請求 + `metadata.total` 實測得來的）：
> 1. `salaryMin` 要同時送 `scmin` + `sctp=M` + `scstrict=1`，缺了 `scstrict` 薪資篩選會被完全忽略。
> 2. 「面議」薪資值是 `0`，104 預設保留（面議可能開很高）。`excludeNegotiable` 會排除它們。
> 3. 薪資上限 `9,999,999` 是 104「不設上限」哨兵值，server 端已正規化成「N 元以上」。
> 4. `remoteWork`=1完全/2部分、`ro`=1全職/2兼職、`jobexp`=1/3/5/10/99（互斥年資級距）。
> 5. 地區/職類用**樹狀代碼表 + 剪枝**：命中父節點（如「新竹縣市」）就用父代碼，不展開成一堆子代碼 —— 展開太多會讓 104 回 `400`。
> 6. **廣告偵測**：104 會在結果最前面塞廣告（原始欄位 `jobType=1`），它會**無視關鍵字**（例如護理師搜尋跑出「COACH 精品銷售」）。每筆回傳 `featured` 旗標標記它，`excludeFeatured=true` 可整批濾掉。`jobType=2`（付費優先位）仍符合關鍵字，視為有效結果不標記。搜尋列表刻意不含完整 JD（精簡、避免模型整理清單時把某筆網址對錯到別筆），完整內容用 `get_job_detail`。

> **欄位命名跨三個工具一致**（都對照 104 原始欄位語意，避免同名不同物）：
>
> | 概念 | search_jobs | get_job_detail | get_company_jobs |
> |------|:-----------:|:--------------:|:----------------:|
> | 職缺代碼（slug，可餵回 `get_job_detail`）| `jobId` | `jobId` | `jobId` |
> | 職缺網址 | `url` | `url` | `url` |
> | 地區（區級）| `area` | `area` | `area` |
> | 完整地址（區+街道）| — | `location` | — |
> | 需求年資 | — | `experience` | `experience` |
> | 擅長工具/語言（C++、Linux）| `skills` | `skills` | — |
> | 職務技能（職類層級，如「軟體工程系統開發」）| — | `jobSkills` | — |
> | 公司頁網址（餵給 `get_company_jobs`）| `companyUrl` | `companyUrl` | — |
> | 是否為廣告位（`jobType=1`）| `featured` | — | — |
>
> `jobId` 一律是 **slug**（如 `7uqyj`），不是 104 內部數字 —— slug 才能餵回 `get_job_detail`。`skills` 到哪都是「具體技術」。

### `get_job_detail` 參數

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `jobUrlOrId` | ✅ | 職缺網址或代碼，例如 `https://www.104.com.tw/job/7uqyj` 或 `7uqyj`（用 `search_jobs` 回傳的 `url`） |

### `get_company_jobs` 參數

| 參數 | 必填 | 說明 |
|------|:----:|------|
| `companyUrlOrId` | ✅ | 公司網址或代碼，例如 `https://www.104.com.tw/company/1a2x6blghh` 或 `1a2x6blghh` |
| `page` | | 第幾頁（每頁 20 筆），預設 1 |
| `limit` | | 本頁回傳筆數上限，最多 20，預設 10 |

**三個工具怎麼串**：
- `search_jobs` / `get_job_detail` 每筆都回 `url`（職缺）和 `companyUrl`（公司）兩個網址。
- 想看某筆職缺完整內容 → 把它的 `url` 餵給 `get_job_detail`。
- 想看「這家公司還有哪些缺」→ 把 `companyUrl` 餵給 `get_company_jobs`（它是**指定公司**的職缺列表，不是關鍵字搜尋）。

```
search_jobs ─ url ──────→ get_job_detail
      │                        │
      └─ companyUrl ───────────┴──→ get_company_jobs
```

## 104 內部 API 參考

主要 endpoint：

```
GET https://www.104.com.tw/jobs/search/api/jobs
```

必要 header：`Referer: https://www.104.com.tw/jobs/search/`、`Accept-Language: zh-TW`

常用查詢參數（本專案目前只用到部分，其餘供未來擴充）：

| 參數 | 意義 | 範例值 |
|------|------|--------|
| `keyword` | 關鍵字 | 自由文字 |
| `kwop` | 關鍵字運算 | `7`（全符合） |
| `order` | 排序 | `15` 相關性(預設) · `16` 最新 · `13` 薪資 |
| `page` / `pagesize` | 分頁 | `pagesize` 建議 20 |
| `area` | 地區碼（逗號分隔） | 查 `Area.json`（見下） |
| `jobcat` | 職類碼（逗號分隔） | 查 `JobCat.json` |
| `scmin` + `scstrict=1` | 最低薪資 | 整數 |
| `remoteWork` | 遠端 | `1` 完全遠端 · `2` 部分 · `1,2` 皆可（實測） |
| `ro` | 全/兼職 | `1` 全職 · `2` 兼職（實測；`wt` 部分值會 400，不用） |
| `jobexp` | 年資 | `1`/`3`/`5`/`10`/`99` = 1年下/1-3/3-5/5-10/10年上（互斥級距，實測） |
| `edu` | 學歷 | `4,5,6` 大學以上 等 |

地區 / 職類代碼表（放 `static.104.com.tw`，**沒有 Cloudflare 擋**，一般 fetch 就能拿）：

```
https://static.104.com.tw/category-tool/json/Area.json
https://static.104.com.tw/category-tool/json/JobCat.json
```

其他 endpoint：
- 職缺詳情：`GET https://www.104.com.tw/job/ajax/content/{slug}`（Referer 指向 `/job/{slug}`）
- 公司職缺：`GET https://www.104.com.tw/api/companies/{code}/jobs?page=1&pageSize=20`（回 `list.topJobs` + `list.normalJobs`）

## 檔案結構

```
src/
  index.ts            進入點：建 server、掛 tool、接 stdio、處理關閉
  config.ts           所有設定 / 魔術數字（JA3 指紋、endpoint、節流區間…）
  types.ts            乾淨型別 + normalizeJob / JobDetail / CompanyJob（防腐層）
  query.ts            純函式：組查詢網址、解析 slug/公司碼、client 端過濾、enum 對照
  codes.ts            地區/職類「名稱→官方代碼」解析（樹狀比對+剪枝，快取代碼表）
  api/
    httpClient.ts     cycletls 單例（TLS 指紋偽裝）
    throttle.ts       禮貌性隨機節流 1.5~3.5s
    job104.ts         104 抓取層：組 URL → 打 API → 重試 → 正規化
  tools/
    searchJobs.ts     search_jobs
    getJobDetail.ts   get_job_detail
    getCompanyJobs.ts get_company_jobs
scripts/
  smoke-test.mjs      手動發 JSON-RPC 驗證，不用開 Claude 也能測
test/
  types.test.mjs      normalize 邏輯（薪資格式、面議、哨兵值…）
  query.test.mjs      組網址 / slug / 公司碼 / 過濾 / enum 對照
  codes.test.mjs      代碼表樹狀比對 + 剪枝
```

## 開發

```bash
npm run build                 # 編譯 src → dist
npm test                      # 跑單元測試（先 build 再 node --test，零額外依賴）
node scripts/smoke-test.mjs   # 煙霧測試（連真實 104）
npm run inspect               # 開 MCP Inspector GUI 除錯
```

**測試策略**：純邏輯（normalize、組網址、過濾）都抽到 `types.ts` / `query.ts`，用 Node 內建 `node --test` 測，快又不用連網 —— 改壞馬上知道。碰網路的部分（`job104.ts` / `httpClient.ts`）用 smoke-test 對真實 104 驗證。

## 接到 Claude Code

```bash
claude mcp add job104 -- node /你的路徑/104-mcp-server/dist/index.js
```

改完 code 要 `npm run build`，然後重啟 Claude Code（或用 `/mcp` reconnect）才會生效。

## 兩個必記的坑

1. **stdout 是協議專用管線。** stdio 模式下用 `console.log` 會污染 JSON-RPC 訊息，直接斷線。log 一律走 `stderr`。
2. **`description` 是模型唯一的判斷依據。** 模型靠它決定要不要呼叫 tool，寫清楚比寫漂亮重要。
