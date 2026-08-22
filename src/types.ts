/**
 * 職缺的「乾淨型別」—— 這是我們回給模型的格式。
 *
 * 刻意跟 104 的原始欄位脫鉤：104 改欄位名時，只改 normalizeJob，
 * 這個型別和 tool 都不用動。
 */
import { extractSlug } from "./slug.js";

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
