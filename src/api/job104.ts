/**
 * 104 抓取層 —— 唯一直接碰 104 的檔案。
 *
 * 手法：用 cycletls 偽裝 Chrome 的 TLS 指紋，直接打 104 內部 API。
 * Cloudflare 看 TLS 握手指紋像真 Chrome 就放行 —— 不用開瀏覽器。
 * 104 改版時，只改這個檔（+ types.ts 的 normalize）。
 */
import { CONFIG } from "../config.js";
import { getClient } from "./httpClient.js";
import { waitForTurn } from "./throttle.js";
import {
  normalizeJob,
  normalizeJobDetail,
  normalizeCompanyJob,
  mergeCompanyJobLists,
  buildCompanyKeywordResult,
  normalizeCompanyCard,
  pickCompany,
  type Job,
  type JobDetail,
  type CompanyJob,
  type CompanyKeywordResult,
  type FindCompanyResult,
} from "../types.js";
import {
  buildSearchUrl,
  extractSlug,
  extractCompanyCode,
  filterJobs,
  limitJobs,
  companyPageSize,
  REMOTE_CODES,
  JOB_TYPE_CODES,
  EXPERIENCE_CODES,
  SORT_CODES,
  type RemoteKey,
  type JobTypeKey,
  type ExperienceKey,
  type SortKey,
} from "../query.js";
import {
  resolveAreaMatches,
  resolveJobCatCodes,
  buildAreaAmbiguity,
  type AreaAmbiguityResult,
  type FlatCode,
} from "../codes.js";

const log = (...args: unknown[]) => console.error("[104-mcp:api]", ...args);

// ── 共用的底層抓取（搜尋、詳情、公司職缺都用這個）──────────────

/** 打一次 API，回傳解析後的物件；非 200 或非 JSON（被擋）時丟錯 */
async function fetchOnce(url: string, referer: string): Promise<Record<string, unknown>> {
  await waitForTurn(); // 禮貌性節流：距上次請求隨機間隔 1.5~3.5s
  const client = await getClient();
  const res = await client(
    url,
    {
      ja3: CONFIG.ja3,
      userAgent: CONFIG.userAgent,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9",
        Referer: referer,
      },
      timeout: Math.floor(CONFIG.requestTimeoutMs / 1000), // cycletls 以秒為單位
    },
    "get",
  );

  if (res.status !== 200) {
    throw new Error(`104 回應 status=${res.status}（可能被 Cloudflare 阻擋）`);
  }
  const body = res.data as Record<string, unknown> | string;
  if (typeof body !== "object" || body === null) {
    throw new Error("104 回應不是預期的 JSON（可能是 Cloudflare 挑戰頁）");
  }
  return body;
}

/** 帶重試的抓取 —— Cloudflare 偶發失敗，多試幾次通常就過（節流自然拉開間隔） */
async function fetchWithRetry(url: string, referer: string): Promise<Record<string, unknown>> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= CONFIG.maxRetries; attempt++) {
    if (attempt > 0) log(`retry ${attempt}/${CONFIG.maxRetries}`);
    try {
      return await fetchOnce(url, referer);
    } catch (err) {
      lastError = err;
      log(`attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ── 搜尋職缺 ──────────────────────────────────────────────────

export interface SearchParams {
  readonly keyword: string;
  /** 工作地區名稱，例如 '台北市'、'新竹'（會解析成官方代碼查詢） */
  readonly area?: string;
  /** 月薪下限（新台幣）。面議預設保留 */
  readonly salaryMin?: number;
  /** 排除「面議」職缺。預設 false */
  readonly excludeNegotiable?: boolean;
  /** 排除 104 付費推廣/廣告位（jobType≠0）。預設 false */
  readonly excludeFeatured?: boolean;
  /** 職務類別名稱，例如 '軟體工程師'（會解析成官方代碼查詢） */
  readonly jobCategory?: string;
  /** 遠端工作：full 完全遠端 / partial 部分遠端 / any 皆可 */
  readonly remote?: RemoteKey;
  /** 工作性質：fulltime 全職 / parttime 兼職 */
  readonly jobType?: JobTypeKey;
  /** 年資級距 */
  readonly experience?: ExperienceKey;
  /** 排序：newest 最新更新在前 / salary 待遇高→低。未給＝相關性 */
  readonly sort?: SortKey;
  /** 第幾頁（每頁 20 筆），預設 1。想抓更多就往後翻 */
  readonly page?: number;
  readonly limit: number;
}

export interface SearchResult {
  readonly total: number; // 104 回報的符合總數（跨所有頁）
  readonly page: number;
  readonly jobs: readonly Job[];
}

/**
 * 依關鍵字 + 篩選條件搜尋職缺。
 * 地區同名多處 → AreaAmbiguityResult；關鍵字被判定為公司名 → CompanyKeywordResult
 * （都是「錯誤即資料」：不搜尋，回結構化提示讓模型決定下一步）。
 */
export async function searchJobs(
  params: SearchParams,
): Promise<SearchResult | AreaAmbiguityResult | CompanyKeywordResult> {
  const {
    keyword, area, salaryMin, excludeNegotiable, excludeFeatured,
    jobCategory, remote, jobType, experience, sort, page, limit,
  } = params;

  // 地區、職類：名稱 → 官方代碼（抓不到就回空陣列，退回 client 端子字串過濾）
  const [areaMatches, jobCatCodes] = await Promise.all([
    area ? resolveAreaMatches(area) : Promise.resolve<FlatCode[]>([]),
    jobCategory ? resolveJobCatCodes(jobCategory) : Promise.resolve<string[]>([]),
  ]);

  // 同名多區（如「信義區」= 台北+基隆）：地理上不相干，聯集沒意義 → 回去確認
  if (areaMatches.length > 1) {
    log(`area "${area}" ambiguous: ${areaMatches.map((m) => m.name).join(", ")}`);
    return buildAreaAmbiguity(area!, areaMatches);
  }
  const areaCodes = areaMatches.map((m) => m.code);

  const url = buildSearchUrl({
    keyword,
    salaryMin,
    excludeNegotiable,
    areaCodes,
    jobCatCodes,
    remoteWork: remote ? REMOTE_CODES[remote] : undefined,
    jobType: jobType ? JOB_TYPE_CODES[jobType] : undefined,
    experience: experience ? EXPERIENCE_CODES[experience] : undefined,
    order: sort ? SORT_CODES[sort] : undefined,
    page,
  });
  log(`search: ${url}`);

  const body = await fetchWithRetry(url, CONFIG.referer);
  const metadata = body.metadata as
    | { pagination?: { total?: number }; companyKeyword?: boolean }
    | undefined;
  // 104 的「這是公司名」暗號：data 空、無 pagination、只有 companyKeyword:true。
  // 翻譯給模型，不吞掉也不硬搜（帶 searchJobs=1 能壓掉暗號，但回的是全文模糊結果，
  // 第一筆常是代理商 —— 實測「聯發科」第一筆是文曄科技，靜默誤導比查無結果更糟）。
  if (metadata?.companyKeyword) {
    log(`keyword "${keyword}" judged as company name by 104`);
    return buildCompanyKeywordResult(keyword);
  }
  const pagination = metadata?.pagination;
  // 沒有分頁資訊 = 沒見過的回應形狀（104 改版或新的轉介暗號）。寧可吵，不要騙 ——
  // 這裡曾經靜默 fallback 成 0 筆，把「公司名關鍵字」演成「查無職缺」。
  if (typeof pagination?.total !== "number") {
    throw new Error(`104 回應缺少分頁資訊（keyword="${keyword}"），可能是 104 改版或未知的轉介訊號`);
  }
  const rawJobs = Array.isArray(body.data) ? body.data : [];
  log(`captured ${rawJobs.length} raw jobs (total=${pagination.total})`);

  // 正規化 → client 端過濾（地區 + 排除面議）
  const normalized = rawJobs.map((raw) => normalizeJob(raw as never));
  const filtered = filterJobs(normalized, { area, excludeNegotiable, excludeFeatured });

  return {
    total: pagination.total,
    page: page ?? 1,
    // limit 只數一般職缺 —— 廣告佔名額會截掉每頁尾端（見 limitJobs）
    jobs: limitJobs(filtered, limit),
  };
}

// ── 職缺詳情 ──────────────────────────────────────────────────

/** 取得單筆職缺的完整詳情 */
export async function getJobDetail(jobUrlOrSlug: string): Promise<JobDetail> {
  const slug = extractSlug(jobUrlOrSlug);
  if (!slug) throw new Error("無法從輸入取得職缺代碼");

  const url = `${CONFIG.jobDetailApiBase}${slug}`;
  const referer = `${CONFIG.jobPageBase}${slug}`;
  log(`detail: ${url}`);

  const body = await fetchWithRetry(url, referer);
  const data = body.data;
  if (typeof data !== "object" || data === null) {
    throw new Error(`找不到職缺 ${slug} 的詳情`);
  }
  // 補上 jobId(slug) 與 url，讓詳情跟搜尋/公司職缺的欄位一致
  return normalizeJobDetail(data as never, { jobId: slug, url: referer });
}

// ── 公司職缺 ──────────────────────────────────────────────────

export interface CompanyJobsParams {
  readonly companyUrlOrCode: string;
  /** 在這家公司內搜職缺 —— 比對職稱與 JD 內文（含「其他條件」欄）。⚠️ 多字詞是 OR 不是 AND（實測） */
  readonly keyword?: string;
  readonly page?: number;
  readonly limit: number;
}

export interface CompanyJobsResult {
  readonly total: number;
  readonly page: number;
  readonly jobs: readonly CompanyJob[];
}

/**
 * 取得某公司的職缺（分頁），可帶 keyword 在公司內搜尋（就是公司頁上那個搜尋框的 API）。
 * ⚠️ totalCount 不含置頂職缺（實測 465 缺 → totalCount 462）；帶 keyword 時置頂會變 0~1 筆。
 */
export async function getCompanyJobs(params: CompanyJobsParams): Promise<CompanyJobsResult> {
  const { companyUrlOrCode, keyword, page, limit } = params;
  const code = extractCompanyCode(companyUrlOrCode);
  if (!code) throw new Error("無法從輸入取得公司代碼");

  // pageSize 取涵蓋 limit 的最小檔位（20/50/100）：limit≤20 時跟舊行為完全一致，
  // keyword 模式常想一次拿完（實測聯發科 C++ = 98 筆，pageSize=100 一趟收工）
  const query = new URLSearchParams({ page: String(page ?? 1), pageSize: String(companyPageSize(limit)) });
  if (keyword?.trim()) query.set("keyword", keyword.trim());
  const url = `${CONFIG.companyApiBase}${code}/jobs?${query.toString()}`;
  const referer = `${CONFIG.companyPageBase}${code}`;
  log(`company jobs: ${url}`);

  const body = await fetchWithRetry(url, referer);
  const data = body.data as
    | { totalCount?: number; list?: { topJobs?: unknown[]; normalJobs?: unknown[] } }
    | undefined;
  if (!data) throw new Error(`找不到公司 ${code} 的職缺`);

  // 置頂/一般分開 normalize —— 置頂不佔 limit 名額（佔了會截掉每頁尾端，見 mergeCompanyJobLists）
  const top = (data.list?.topJobs ?? []).map((r) => normalizeCompanyJob(r as never));
  const normal = (data.list?.normalJobs ?? []).map((r) => normalizeCompanyJob(r as never));
  const jobs = mergeCompanyJobLists(top, normal, limit, page ?? 1);

  return {
    total: data.totalCount ?? jobs.length,
    page: page ?? 1,
    jobs,
  };
}

// ── 找公司 ────────────────────────────────────────────────────

/**
 * 用名稱找公司（104「找公司」頁的搜尋）。模糊比對含簡介全文：
 * 英文別名（MediaTek）找得到中文本尊，但也會混入「簡介提及」的無關公司 ——
 * 所以不猜：唯一命中或名稱完全相符才回單一名片，否則回候選讓模型跟使用者確認。
 */
export async function findCompany(name: string): Promise<FindCompanyResult> {
  const queryName = name.trim();
  if (!queryName) throw new Error("公司名稱不可為空");

  const params = new URLSearchParams({ keyword: queryName, mode: "s", page: "1", pageSize: "10" });
  const url = `${CONFIG.companySearchApiUrl}?${params.toString()}`;
  log(`find company: ${url}`);

  const body = await fetchWithRetry(url, CONFIG.companySearchReferer);
  const total = (body.metadata as { pagination?: { total?: number } } | undefined)?.pagination?.total;
  // 同 searchJobs：讀不懂的回應形狀就出聲，不要靜默演成「查無公司」
  if (typeof total !== "number") {
    throw new Error(`104 公司搜尋回應缺少分頁資訊（name="${queryName}"），可能是 104 改版`);
  }
  const raw = Array.isArray(body.data) ? body.data : [];
  const cards = raw.map((r) => normalizeCompanyCard(r as never)).filter((c) => c.companyId);
  return pickCompany(cards, total, queryName);
}
