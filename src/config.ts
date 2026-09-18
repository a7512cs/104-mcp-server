/** 全域設定：所有魔術數字集中在這裡，方便調整。 */
export const CONFIG = {
  /** 104 內部搜尋 API（直接打，用 TLS 指紋偽裝過 Cloudflare） */
  searchApiUrl: "https://www.104.com.tw/jobs/search/api/jobs",
  /** 搜尋 API 的 Referer（104 會檢查） */
  referer: "https://www.104.com.tw/jobs/search/",
  /** 職缺詳情 API（slug 接在後面） */
  jobDetailApiBase: "https://www.104.com.tw/job/ajax/content/",
  /** 職缺頁網址（拿來當詳情請求的 Referer，slug 接在後面） */
  jobPageBase: "https://www.104.com.tw/job/",
  /** 公司職缺 API（公司代碼接在中間：/api/companies/{code}/jobs） */
  companyApiBase: "https://www.104.com.tw/api/companies/",
  /** 公司頁網址（當公司請求的 Referer，代碼接在後面） */
  companyPageBase: "https://www.104.com.tw/company/",
  /** 公司搜尋 API（官網「找公司」頁用的；模糊比對，含公司簡介全文） */
  companySearchApiUrl: "https://www.104.com.tw/company/ajax/list",
  /** 公司搜尋的 Referer */
  companySearchReferer: "https://www.104.com.tw/company/search/",
  /** 應徵分析 API（「應徵分析」頁自己打的；job_no 要十進位 jobNo；不登入也回完整資料，「登入解鎖」只是前端遮罩） */
  applyAnalysisApiUrl: "https://www.104.com.tw/jb/104i/applyAnalysisToJob/all",
  /** 應徵分析頁網址（當應徵分析請求的 Referer，slug 接在後面） */
  applyAnalysisPageBase: "https://www.104.com.tw/jobs/apply/analysis/",
  /** 地區代碼表（樹狀 JSON，放 static.104，沒有 Cloudflare） */
  areaJsonUrl: "https://static.104.com.tw/category-tool/json/Area.json",
  /** 職類代碼表（樹狀 JSON，放 static.104，沒有 Cloudflare） */
  jobCatJsonUrl: "https://static.104.com.tw/category-tool/json/JobCat.json",
  /**
   * Chrome 的 JA3 TLS 指紋。cycletls 用這個讓 TLS 握手長得像真 Chrome，
   * 騙過 Cloudflare 的 bot 偵測。Chrome 大改版時可能要更新這串。
   */
  ja3: "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0",
  /** 配合指紋的 User-Agent（要跟 ja3 的 Chrome 版本大致一致） */
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  /** 單次請求逾時（毫秒） */
  requestTimeoutMs: 15_000,
  /** 回傳非 200 時的重試次數（Cloudflare 偶發 403 用） */
  maxRetries: 2,
  /** 兩次請求間的最小間隔（毫秒），實際會在 min~max 間隨機，降低被 ban 風險 */
  throttleMinMs: 1_500,
  throttleMaxMs: 3_500,
  /** 每頁抓幾筆（我們再依 limit 切） */
  pageSize: 20,
  /** 回傳筆數硬上限，避免一次抓太多 */
  maxLimit: 20,
  /** 公司職缺的 limit 上限 —— 上游 pageSize 有 20/50/100 檔位，keyword 模式常想一次拿完（實測聯發科 C++ = 98 筆） */
  maxCompanyLimit: 100,
} as const;
