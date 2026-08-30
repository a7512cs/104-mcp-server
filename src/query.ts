/**
 * 純函式：組查詢網址、解析 slug、套用 client 端過濾。
 *
 * 刻意跟 job104.ts（網路 I/O）分開 —— 這些沒有副作用、不碰網路，
 * 好測、好懂。所有「眉角知識」（篩選參數對照）都集中在這。
 */
import { CONFIG } from "./config.js";
import { NEGOTIABLE, type Job } from "./types.js";

// slug/公司碼解析移到 slug.ts（types.ts 也要用，抽出來避免重複）。這裡再匯出保持相容。
export { extractSlug, extractCompanyCode } from "./slug.js";

// ── 友善 enum → 104 代碼對照（都用 metadata.total 實測驗證過）───────

/** 遠端工作：完全遠端 / 部分遠端 / 兩者皆可 */
export const REMOTE_CODES = { full: "1", partial: "2", any: "1,2" } as const;
/** 工作性質（ro）：全職 / 兼職 */
export const JOB_TYPE_CODES = { fulltime: "1", parttime: "2" } as const;
/** 年資（jobexp）：104 的互斥級距 */
export const EXPERIENCE_CODES = {
  "under-1y": "1",
  "1-3y": "3",
  "3-5y": "5",
  "5-10y": "10",
  "over-10y": "99",
} as const;

/** 排序（order）：newest=16 最新更新在前（掃新缺/擴編偵測用）、salary=13 待遇高→低。預設 15 相關性 */
export const SORT_CODES = { newest: "16", salary: "13" } as const;

export type RemoteKey = keyof typeof REMOTE_CODES;
export type JobTypeKey = keyof typeof JOB_TYPE_CODES;
export type ExperienceKey = keyof typeof EXPERIENCE_CODES;
export type SortKey = keyof typeof SORT_CODES;

/** 組搜尋網址用的參數（代碼已解析、enum 已是 104 值） */
export interface SearchQuery {
  readonly keyword: string;
  readonly salaryMin?: number;
  readonly excludeNegotiable?: boolean;
  readonly areaCodes?: readonly string[];
  readonly jobCatCodes?: readonly string[];
  readonly remoteWork?: string; // "1" | "2" | "1,2"
  readonly jobType?: string; // ro: "1" | "2"
  readonly experience?: string; // jobexp: "1" | "3" | "5" | "10" | "99"
  readonly order?: string; // "16" 最新 | "13" 薪資（未給用預設 15 相關性）
  readonly page?: number;
}

/** 組出搜尋 API 網址 */
export function buildSearchUrl(q: SearchQuery): string {
  const params = new URLSearchParams({
    keyword: q.keyword,
    order: q.order ?? "15", // 預設相關性排序
    pagesize: String(CONFIG.pageSize),
    // 刻意不帶 searchJobs=1：關鍵字被 104 判定為公司名時，讓它回 companyKeyword 暗號，
    // 由 job104.ts 翻譯成給模型的提示（硬搜會回全文模糊結果，混入代理商/供應鏈，靜默誤導）。
  });
  if (q.page && q.page > 1) params.set("page", String(q.page));

  if (q.salaryMin && q.salaryMin > 0) {
    // 這幾個參數是「觀察 104 官網篩選 UI 實際送出的請求」得來的，缺一不可：
    params.set("scmin", String(q.salaryMin)); // 薪資下限
    params.set("sctp", "M"); // 薪資類型：月薪（104 會自動換算年薪職缺）
    params.set("scstrict", "1"); // 嚴格比對 —— 少了這個 scmin 會被完全忽略！
    // scneg 只在有薪資篩選時生效：1=保留面議、0=排除面議（實測單獨用無效）
    params.set("scneg", q.excludeNegotiable ? "0" : "1");
  }
  if (q.areaCodes?.length) params.set("area", q.areaCodes.join(","));
  if (q.jobCatCodes?.length) params.set("jobcat", q.jobCatCodes.join(","));
  if (q.remoteWork) params.set("remoteWork", q.remoteWork);
  if (q.jobType) params.set("ro", q.jobType); // 全職/兼職
  if (q.experience) params.set("jobexp", q.experience); // 年資級距

  return `${CONFIG.searchApiUrl}?${params.toString()}`;
}

/** 套用 client 端過濾：地區子字串 + 排除面議 + 排除廣告 */
export function filterJobs(
  jobs: readonly Job[],
  opts: { area?: string; excludeNegotiable?: boolean; excludeFeatured?: boolean },
): Job[] {
  let result = [...jobs];
  if (opts.area) {
    result = result.filter((job) => job.area.includes(opts.area!));
  }
  // 排除面議：因為 104 的 scneg 只在有薪資篩選時生效，
  // 且最上方常有不受篩選的推薦職缺漏進來，這裡再保險一次。
  if (opts.excludeNegotiable) {
    result = result.filter((job) => job.salary !== NEGOTIABLE);
  }
  // 排除 104 廣告位（jobType=1；jobType=2 付費優先位是有效結果，不算）—— 廣告會無視關鍵字硬塞在最前面
  if (opts.excludeFeatured) {
    result = result.filter((job) => !job.featured);
  }
  return result;
}

/**
 * 對過濾後的列表套 limit —— limit 只數一般職缺，廣告位（featured）另計、不佔名額。
 * 104 上游每頁固定回 20 筆一般職缺＋0~2 筆「額外疊加」的廣告（實測 page1 原始 22 筆）；
 * 若讓廣告佔名額，limit=20 時每頁尾端的一般職缺會被截掉且下一頁不補回
 * （跟公司頁置頂職缺同款問題，見 mergeCompanyJobLists）。取滿 limit 筆一般職缺即截斷。
 */
export function limitJobs(jobs: readonly Job[], limit: number): Job[] {
  const out: Job[] = [];
  let normals = 0;
  for (const job of jobs) {
    if (normals >= limit) break; // 取滿即斷，其後的項目（含廣告）不再跟回
    out.push(job);
    if (!job.featured) normals++;
  }
  return out;
}
