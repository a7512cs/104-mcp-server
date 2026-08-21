/**
 * 純函式：組查詢網址、解析 slug、套用 client 端過濾。
 *
 * 刻意跟 job104.ts（網路 I/O）分開 —— 這些沒有副作用、不碰網路，
 * 好測、好懂。所有「眉角知識」（篩選參數對照）都集中在這。
 */
import { CONFIG } from "./config.js";
import { NEGOTIABLE, type Job } from "./types.js";

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

export type RemoteKey = keyof typeof REMOTE_CODES;
export type JobTypeKey = keyof typeof JOB_TYPE_CODES;
export type ExperienceKey = keyof typeof EXPERIENCE_CODES;

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
  readonly page?: number;
}

/** 組出搜尋 API 網址 */
export function buildSearchUrl(q: SearchQuery): string {
  const params = new URLSearchParams({
    keyword: q.keyword,
    order: "15", // 相關性排序
    pagesize: String(CONFIG.pageSize),
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

/**
 * 從輸入取出職缺 slug：吃得下完整網址或裸 slug。
 * 例：https://www.104.com.tw/job/7uqyj?foo=bar → 7uqyj；7uqyj → 7uqyj
 */
export function extractSlug(input: string): string {
  const match = input.match(/\/job\/([^/?#]+)/);
  return (match ? match[1] : input).trim();
}

/**
 * 從輸入取出公司代碼：吃得下完整公司網址或裸代碼。
 * 例：https://www.104.com.tw/company/1a2x6blghh → 1a2x6blghh
 */
export function extractCompanyCode(input: string): string {
  const match = input.match(/\/company\/([^/?#]+)/);
  return (match ? match[1] : input).trim();
}

/** 套用 client 端過濾：地區子字串 + 排除面議 */
export function filterJobs(
  jobs: readonly Job[],
  opts: { area?: string; excludeNegotiable?: boolean },
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
  return result;
}
