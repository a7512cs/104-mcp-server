/**
 * 職缺的「乾淨型別」—— 這是我們回給模型的格式。
 *
 * 刻意跟 104 的原始欄位脫鉤：104 改欄位名時，只改 normalizeJob，
 * 這個型別和 tool 都不用動。
 */
import { extractSlug } from "./slug.js";
import { CONFIG } from "./config.js";

export interface Job {
  /** 職缺代碼（slug，如 7uqyj）—— 可直接餵給 get_job_detail。三個工具語意一致 */
  readonly jobId: string;
  readonly jobName: string;
  readonly companyName: string;
  /** 公司頁網址，可直接餵給 get_company_jobs 看這家公司所有職缺 */
  readonly companyUrl: string;
  readonly area: string;
  readonly salary: string;
  /** 應徵人數 —— 判斷這筆職缺的競爭程度 */
  readonly applyCount: number;
  /** 員工人數 —— 0 代表「未公開」（約半數公司不提供），不是 0 人。小公司/新創過濾用 */
  readonly employeeCount: number;
  /** 擅長工具/語言（具體技術，如 C++、Linux）。跨工具語意一致：詳情的 skills 也是這個 */
  readonly skills: readonly string[];
  readonly url: string;
  /** 更新日期（YYYY/MM/DD，頁面上的「MM/DD更新」）—— 跟 get_job_detail 同格式 */
  readonly appearDate: string;
  /** 是否為 104 廣告位（jobType=1，會無視關鍵字硬塞在最前面）。優先位(2)不算，仍是有效結果 */
  readonly featured: boolean;
}

/** 104 原始職缺（只列我們會用到的欄位，其餘忽略） */
interface RawJob {
  jobNo?: string;
  jobName?: string;
  custName?: string;
  jobAddrNoDesc?: string;
  salaryLow?: number;
  salaryHigh?: number;
  /** 薪資類型：10=面議、30=時薪、40=日薪、50=月薪、60=年薪 */
  s10?: number;
  /** 應徵人數 */
  applyCnt?: number;
  /** 員工人數；約半數公司不提供（缺欄位或 0） */
  employeeCount?: number | string;
  pcSkills?: { description?: string }[];
  link?: { job?: string; cust?: string };
  appearDate?: string;
  /** 0=一般自然結果；1=精選/廣告（會無視關鍵字硬塞在最前面）；2=付費優先位 */
  jobType?: number;
}

export const NEGOTIABLE = "面議";
/** 104 用這個值表示「上限不設」，要正規化成「以上」，不能直接印出來 */
const NO_UPPER_LIMIT = 9_999_999;

/** 104 薪資類型代碼（搜尋 API 的 s10）：10=面議、30=時薪、40=日薪、50=月薪、60=年薪 */
const SALARY_TYPE_PREFIX: Record<number, string> = { 30: "時薪", 40: "日薪", 50: "月薪", 60: "年薪" };
const SALARY_TYPE_NEGOTIABLE = 10;

/** 把薪資數字轉成人看得懂的字串（type=10 或 0/0 代表面議；上限 9999999 代表不設上限） */
function formatSalary(low?: number, high?: number, type?: number): string {
  if (type === SALARY_TYPE_NEGOTIABLE || (!low && !high)) return NEGOTIABLE;
  const prefix = SALARY_TYPE_PREFIX[type ?? 0] ?? "月薪"; // 沒給 s10 時退回月薪（歷史行為）
  const fmt = (n: number) => n.toLocaleString("en-US");
  const hasUpper = !!high && high < NO_UPPER_LIMIT; // 濾掉 9999999 這個哨兵值
  if (low && hasUpper) return `${prefix} ${fmt(low)}~${fmt(high!)} 元`;
  if (low) return `${prefix} ${fmt(low)} 元以上`; // 含 low>0 且上限不設的情況
  return `${prefix} ${fmt(high!)} 元以下`;
}

/** 搜尋 API 的日期是 8 碼數字（20260817），轉成跟詳情 API 一致的 2026/08/17；非預期格式原樣放行 */
function formatAppearDate(raw?: string): string {
  if (!raw) return "";
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : raw;
}

/** 104 用 [[[關鍵字]]] 標記命中的字，清掉這些標記 */
function stripHighlight(text: string): string {
  return text.replace(/\[\[\[|\]\]\]/g, "").trim();
}

/**
 * 把一筆 104 原始職缺轉成乾淨的 Job（精簡列表用）。
 * 刻意不含完整 JD —— 搜尋是概覽，完整內容用 get_job_detail 拿。
 * 列表越精簡，模型整理成清單時越不會把某筆的網址對錯到別筆。
 * ⚠️ 這是「防腐層」—— 104 改版時的唯一修改點。
 */
export function normalizeJob(raw: RawJob): Job {
  // jobId 用 slug（跟 link.job / get_job_detail / 公司職缺一致），不用數字 jobNo
  const slug = extractSlug(raw.link?.job ?? "");
  return {
    jobId: slug || (raw.jobNo ?? ""),
    jobName: stripHighlight(raw.jobName ?? ""),
    companyName: raw.custName ?? "",
    companyUrl: raw.link?.cust ?? "",
    area: raw.jobAddrNoDesc ?? "",
    salary: formatSalary(raw.salaryLow, raw.salaryHigh, raw.s10),
    applyCount: raw.applyCnt ?? 0,
    employeeCount: Number(raw.employeeCount) || 0,
    skills: (raw.pcSkills ?? []).map((s) => s.description ?? "").filter(Boolean),
    url: raw.link?.job ?? "",
    appearDate: formatAppearDate(raw.appearDate),
    // 只有 jobType=1 是會無視關鍵字硬塞的廣告；0(一般)和 2(優先位) 都是有效結果，一起分析
    featured: raw.jobType === 1,
  };
}

// ─────────────────────────────────────────────────────────────
// 職缺詳情（get_job_detail 用）
// ─────────────────────────────────────────────────────────────

/** 職缺完整詳情的乾淨型別 */
export interface JobDetail {
  /** 職缺代碼（slug）—— 跟 search_jobs / get_company_jobs 的 jobId 一致 */
  readonly jobId: string;
  readonly jobName: string;
  readonly companyName: string;
  /** 公司頁網址，可直接餵給 get_company_jobs 看這家公司所有職缺 */
  readonly companyUrl: string;
  /** 職缺網址 */
  readonly url: string;
  /** 更新日期（頁面上的「MM/DD更新」，原始格式 YYYY/MM/DD） */
  readonly appearDate: string;
  readonly salary: string;
  /** 地區（區級，如「新北市新店區」）—— 跟 search_jobs / get_company_jobs 的 area 一致 */
  readonly area: string;
  /** 完整地址（區 + 街道），比 area 更詳細 */
  readonly location: string;
  readonly description: string;
  readonly categories: readonly string[];
  /** 需求工作經歷 —— 跟 get_company_jobs 的 experience 同名同義 */
  readonly experience: string;
  readonly education: string;
  /** 科系要求，例如「資訊工程相關」 */
  readonly majors: readonly string[];
  /** 其他條件 —— 常藏關鍵資訊（外派地點、證照要求等），別漏看 */
  readonly otherConditions: string;
  /** 擅長工具/語言（具體技術，如 C++、Linux）—— 跟 search_jobs 的 skills 同一種東西 */
  readonly skills: readonly string[];
  /** 職務技能（職類層級描述，如「軟體工程系統開發」）—— 跟 skills 不同層級 */
  readonly jobSkills: readonly string[];
  readonly languages: readonly string[];
  readonly headcount: string;
  readonly manageResp: string;
  readonly businessTrip: string;
  readonly industry: string;
  readonly employees: string;
  readonly welfareTags: readonly string[];
  readonly welfare: string;
}

interface CodeItem {
  description?: string;
}
interface LanguageItem {
  language?: string;
  ability?: {
    listening?: string;
    speaking?: string;
    reading?: string;
    writing?: string;
  };
}

/** 104 詳情原始結構（只列會用到的欄位） */
interface RawJobDetail {
  header?: { jobName?: string; custName?: string; custUrl?: string; appearDate?: string };
  jobDetail?: {
    jobDescription?: string;
    salary?: string;
    jobCategory?: CodeItem[];
    addressRegion?: string;
    addressDetail?: string;
    needEmp?: string;
    manageResp?: string;
    businessTrip?: string;
  };
  condition?: {
    workExp?: string;
    edu?: string;
    major?: string[];
    /** 通常是字串，偶爾是字串陣列 */
    other?: string | string[];
    skill?: CodeItem[];
    specialty?: CodeItem[];
    language?: LanguageItem[];
  };
  welfare?: { tag?: string[]; welfare?: string };
  industry?: string;
  employees?: string;
}

const descriptions = (items?: CodeItem[]): string[] =>
  (items ?? []).map((i) => i.description ?? "").filter(Boolean);

/** 把語言要求整理成 "英文 (聽:中等 說:中等)" 這種好讀字串 */
function formatLanguages(langs?: LanguageItem[]): string[] {
  return (langs ?? []).map((l) => {
    const a = l.ability;
    const parts = a
      ? [
          a.listening && `聽:${a.listening}`,
          a.speaking && `說:${a.speaking}`,
          a.reading && `讀:${a.reading}`,
          a.writing && `寫:${a.writing}`,
        ]
          .filter(Boolean)
          .join(" ")
      : "";
    return parts ? `${l.language ?? ""} (${parts})` : (l.language ?? "");
  });
}

/**
 * 把 104 原始詳情轉成乾淨的 JobDetail。
 * ref 帶入這筆職缺的 jobId(slug) 與 url —— 詳情 body 本身沒有，由呼叫端補上，
 * 讓 jobId/url 跟 search_jobs / get_company_jobs 一致。
 * ⚠️ 跟 normalizeJob 一樣是防腐層，104 改版時的修改點。
 */
export function normalizeJobDetail(
  raw: RawJobDetail,
  ref: { jobId: string; url: string } = { jobId: "", url: "" },
): JobDetail {
  const jd = raw.jobDetail ?? {};
  const cond = raw.condition ?? {};
  const location = [jd.addressRegion, jd.addressDetail].filter(Boolean).join(" ");
  return {
    jobId: ref.jobId,
    jobName: raw.header?.jobName ?? "",
    companyName: raw.header?.custName ?? "",
    companyUrl: raw.header?.custUrl ?? "",
    url: ref.url,
    appearDate: raw.header?.appearDate ?? "",
    salary: jd.salary ?? "",
    area: jd.addressRegion ?? "",
    location,
    description: (jd.jobDescription ?? "").trim(),
    categories: descriptions(jd.jobCategory),
    experience: cond.workExp ?? "",
    education: cond.edu ?? "",
    majors: cond.major ?? [],
    otherConditions: (Array.isArray(cond.other) ? cond.other.filter(Boolean).join("\n") : (cond.other ?? "")).trim(),
    // skills = 擅長工具/語言（跟 search 的 skills 一致），jobSkills = 職務技能（職類層級）
    skills: descriptions(cond.specialty),
    jobSkills: descriptions(cond.skill),
    languages: formatLanguages(cond.language),
    headcount: jd.needEmp ?? "",
    manageResp: jd.manageResp ?? "",
    businessTrip: jd.businessTrip ?? "",
    industry: raw.industry ?? "",
    employees: raw.employees ?? "",
    welfareTags: raw.welfare?.tag ?? [],
    welfare: (raw.welfare?.welfare ?? "").trim(),
  };
}

// ─────────────────────────────────────────────────────────────
// 公司職缺（get_company_jobs 用）
// 注意：公司 API 的欄位跟搜尋 API 不同，薪資/年資是現成字串。
// ─────────────────────────────────────────────────────────────

/** 公司職缺的乾淨型別 */
export interface CompanyJob {
  readonly jobId: string;
  readonly jobName: string;
  readonly area: string;
  readonly salary: string;
  readonly education: string;
  readonly experience: string;
  readonly url: string;
  /** 置頂職缺（公司付費置頂）。只在第 1 頁回、不佔 limit 名額；一般職缺不帶此欄位 */
  readonly pinned?: boolean;
  // 刻意不含 appearDate：公司 API 原始只有 "8/20" 這種無年份格式，
  // 殭屍職缺看起來永遠像最近更新，跨年靜默誤導。要日期就把 jobId 餵給 get_job_detail。
}

/** 公司 API 的原始職缺（只列會用到的欄位） */
interface RawCompanyJob {
  jobNo?: string;
  jobName?: string;
  jobUrl?: string;
  jobAddrNoDesc?: string;
  jobSalaryDesc?: string;
  edu?: string;
  periodDesc?: string;
}

/** 把公司 API 的原始職缺轉成乾淨的 CompanyJob（防腐層） */
export function normalizeCompanyJob(raw: RawCompanyJob): CompanyJob {
  return {
    jobId: raw.jobNo ?? "",
    jobName: (raw.jobName ?? "").trim(),
    area: raw.jobAddrNoDesc ?? "",
    salary: raw.jobSalaryDesc ?? "",
    education: raw.edu ?? "",
    experience: raw.periodDesc ?? "",
    url: raw.jobUrl ?? "",
  };
}

/**
 * 合併置頂（topJobs）與一般（normalJobs）職缺。
 * 104 上游每頁回「置頂 0~3 筆＋一般職缺一個窗口」（窗口＝pageSize 檔位 20/50/100，
 * 見 companyPageSize；帶 keyword 時置頂會變 0~1 筆）；
 * 若讓置頂佔掉 limit 名額，每頁尾端的一般職缺會被截掉且下一頁不會補回
 * （實測聯發科 464 筆漏掉約 66 筆）。
 * 因此：limit 只約束一般職缺；置頂另計、標 pinned；置頂每頁重複回，page>1 直接略過。
 */
export function mergeCompanyJobLists(
  top: readonly CompanyJob[],
  normal: readonly CompanyJob[],
  limit: number,
  page: number,
): CompanyJob[] {
  const pinned = page > 1 ? [] : top.map((j) => ({ ...j, pinned: true }));
  return [...pinned, ...normal.slice(0, limit)];
}

// ─────────────────────────────────────────────────────────────
// 「公司名關鍵字」回應（search_jobs 用）
// ─────────────────────────────────────────────────────────────

/**
 * 104 對「長得像公司名」的關鍵字不執行職缺搜尋，改回 metadata.companyKeyword:true 暗號
 * （data 為空、無 pagination）。這包是把暗號翻譯給「模型」看的結構化提示 —— 錯誤即資料，
 * 跟 ambiguousArea 同款；使用者只會看到模型消化後的人話。
 */
export interface CompanyKeywordResult {
  readonly companyKeyword: {
    readonly query: string;
    readonly hint: string;
  };
}

/**
 * 搜尋 API metadata 的三種已知形狀 → 讀數。防腐層的一部分：
 * - 有 pagination.total → 正常結果
 * - companyKeyword:true → 104 判定關鍵字是公司名（不執行搜尋的暗號）
 * - 兩者皆無 → 沒見過的形狀，出聲（曾經靜默 fallback 成 0 筆，把公司名演成「查無職缺」）
 */
export type SearchMetadataReading =
  | { readonly kind: "companyKeyword" }
  | { readonly kind: "ok"; readonly total: number };

export function interpretSearchMetadata(metadata: unknown, keyword: string): SearchMetadataReading {
  const m = metadata as
    | { pagination?: { total?: unknown }; companyKeyword?: unknown }
    | undefined
    | null;
  if (m?.companyKeyword) return { kind: "companyKeyword" };
  const total = m?.pagination?.total;
  if (typeof total === "number") return { kind: "ok", total };
  throw new Error(`104 回應缺少分頁資訊（keyword="${keyword}"），可能是 104 改版或未知的轉介訊號`);
}

/** 把 104 的公司名暗號翻譯成給模型的下一步指示 */
export function buildCompanyKeywordResult(query: string): CompanyKeywordResult {
  return {
    companyKeyword: {
      query,
      hint:
        `104 判定「${query}」是公司名稱，未執行職缺搜尋（硬搜會回全文模糊結果，混入代理商與供應鏈廠商，容易誤導）。` +
        `要這家公司自己的職缺：先用 find_company 以名稱取得 companyId，再用 get_company_jobs 列出職缺（可帶 keyword 在該公司內搜，例如 C++）。`,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 公司名片（find_company 用）
// ─────────────────────────────────────────────────────────────

/** 公司名片 —— find_company 的回傳單位 */
export interface CompanyCard {
  /** 公司代碼（slug，如 12noppgo）—— 可直接餵給 get_company_jobs */
  readonly companyId: string;
  readonly companyName: string;
  /** 公司頁網址（也可餵 get_company_jobs） */
  readonly companyUrl: string;
  readonly area: string;
  readonly industry: string;
  /** 員工數（104 原樣字串，如「員工數16000人」；未提供為空字串） */
  readonly employees: string;
  /** 資本額（原樣字串，如「資本額150億」） */
  readonly capital: string;
  /** 在徵職缺數 —— 分辨同名公司的關鍵（本尊通常有缺，掛名店面多半 0） */
  readonly jobCount: number;
}

/** /company/ajax/list 的原始公司（只列會用到的欄位） */
interface RawCompanyCard {
  /** ⚠️ 公司 slug 在這支 API 叫 encodedCustNo；mixSearch 叫 custNo；職缺搜尋的 custNo 又是數字 —— 對外一律統一成 companyId */
  encodedCustNo?: string;
  name?: string;
  areaDesc?: string;
  industryDesc?: string;
  employeeCountDesc?: string;
  capitalDesc?: string;
  jobCount?: number;
}

/** 把公司搜尋的原始資料轉成乾淨名片（防腐層） */
export function normalizeCompanyCard(raw: RawCompanyCard): CompanyCard {
  const slug = raw.encodedCustNo ?? "";
  return {
    companyId: slug,
    companyName: (raw.name ?? "").trim(),
    companyUrl: slug ? `${CONFIG.companyPageBase}${slug}` : "",
    area: raw.areaDesc ?? "",
    industry: raw.industryDesc ?? "",
    employees: raw.employeeCountDesc ?? "",
    capital: raw.capitalDesc ?? "",
    jobCount: raw.jobCount ?? 0,
  };
}

/**
 * find_company 的回傳：
 * - 唯一命中（或名稱完全相符）→ company 單一名片
 * - 多家符合 → candidates 候選 + hint（觀眾是模型：請跟使用者確認，不要猜）
 * - 找不到 → 只有 total=0 + hint
 * total 是 104 回報的符合總數 —— 模糊比對含「簡介提及」，通常偏大。
 */
export interface FindCompanyResult {
  readonly total: number;
  readonly company?: CompanyCard;
  readonly candidates?: readonly CompanyCard[];
  readonly hint?: string;
}

/** 候選清單上限 —— 超過只會稀釋判斷（本尊幾乎都在前幾筆） */
const MAX_COMPANY_CANDIDATES = 5;

/** 從公司搜尋結果挑選：不猜 —— 唯一或完全相符才直接回，否則交給模型跟使用者確認 */
export function pickCompany(
  cards: readonly CompanyCard[],
  total: number,
  query: string,
): FindCompanyResult {
  if (cards.length === 0) {
    return {
      total, // 保留 104 回報的真實總數，不硬編 0（呼叫端負責擋「有資料但解析全失敗」的情況）
      hint: `104 找不到名稱符合「${query}」的公司。可換更完整的全名、常用簡稱，或中英文互換再試。`,
    };
  }
  if (total === 1 && cards.length === 1) {
    return { total, company: cards[0] };
  }
  const exact = cards.find((c) => c.companyName === query.trim());
  if (exact) {
    return { total, company: exact };
  }
  return {
    total,
    candidates: cards.slice(0, MAX_COMPANY_CANDIDATES),
    hint:
      `「${query}」符合多家公司（共 ${total} 家，含簡介提及的；此處列前 ${Math.min(cards.length, MAX_COMPANY_CANDIDATES)} 家）。` +
      `請向使用者確認是哪一家 —— 用名稱、產業、地區、在徵職缺數分辨，不要自行猜選。` +
      `確認後把該筆 companyId 餵給 get_company_jobs（可帶 keyword 在該公司內搜職缺）。`,
  };
}
