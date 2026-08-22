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
  type Job,
  type JobDetail,
  type CompanyJob,
} from "../types.js";
import {
  buildSearchUrl,
  extractSlug,
  extractCompanyCode,
  filterJobs,
  REMOTE_CODES,
  JOB_TYPE_CODES,
  EXPERIENCE_CODES,
  type RemoteKey,
  type JobTypeKey,
  type ExperienceKey,
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
  /** 第幾頁（每頁 20 筆），預設 1。想抓更多就往後翻 */
  readonly page?: number;
  readonly limit: number;
}

export interface SearchResult {
  readonly total: number; // 104 回報的符合總數（跨所有頁）
  readonly page: number;
  readonly jobs: readonly Job[];
}

/** 依關鍵字 + 篩選條件搜尋職缺。地區同名多處時回 AreaAmbiguityResult（不搜尋，讓模型跟使用者確認） */
export async function searchJobs(params: SearchParams): Promise<SearchResult | AreaAmbiguityResult> {
  const {
    keyword, area, salaryMin, excludeNegotiable, excludeFeatured,
    jobCategory, remote, jobType, experience, page, limit,
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
    page,
  });
  log(`search: ${url}`);

  const body = await fetchWithRetry(url, CONFIG.referer);
  const rawJobs = Array.isArray(body.data) ? body.data : [];
  const pagination = (body.metadata as { pagination?: { total?: number } } | undefined)?.pagination;
  log(`captured ${rawJobs.length} raw jobs (total=${pagination?.total ?? "?"})`);

  // 正規化 → client 端過濾（地區 + 排除面議）
  const normalized = rawJobs.map((raw) => normalizeJob(raw as never));
  const filtered = filterJobs(normalized, { area, excludeNegotiable, excludeFeatured });

  return {
    total: pagination?.total ?? filtered.length,
    page: page ?? 1,
    jobs: filtered.slice(0, limit),
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
  readonly page?: number;
  readonly limit: number;
}

export interface CompanyJobsResult {
  readonly total: number;
  readonly page: number;
  readonly jobs: readonly CompanyJob[];
}

/** 取得某公司的所有職缺（分頁） */
export async function getCompanyJobs(params: CompanyJobsParams): Promise<CompanyJobsResult> {
  const { companyUrlOrCode, page, limit } = params;
  const code = extractCompanyCode(companyUrlOrCode);
  if (!code) throw new Error("無法從輸入取得公司代碼");

  const query = new URLSearchParams({ page: String(page ?? 1), pageSize: String(CONFIG.pageSize) });
  const url = `${CONFIG.companyApiBase}${code}/jobs?${query.toString()}`;
  const referer = `${CONFIG.companyPageBase}${code}`;
  log(`company jobs: ${url}`);

  const body = await fetchWithRetry(url, referer);
  const data = body.data as
    | { totalCount?: number; list?: { topJobs?: unknown[]; normalJobs?: unknown[] } }
    | undefined;
  if (!data) throw new Error(`找不到公司 ${code} 的職缺`);

  // 合併「置頂職缺」+「一般職缺」
  const raw = [...(data.list?.topJobs ?? []), ...(data.list?.normalJobs ?? [])];
  const jobs = raw.map((r) => normalizeCompanyJob(r as never));

  return {
    total: data.totalCount ?? jobs.length,
    page: page ?? 1,
    jobs: jobs.slice(0, limit),
  };
}
