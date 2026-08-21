/**
 * 職缺的「乾淨型別」—— 這是我們回給模型的格式。
 *
 * 刻意跟 104 的原始欄位脫鉤：104 改欄位名時，只改 normalizeJob，
 * 這個型別和 tool 都不用動。
 */
export interface Job {
  readonly jobId: string;
  readonly jobName: string;
  readonly companyName: string;
  /** 公司頁網址，可直接餵給 get_company_jobs 看這家公司所有職缺 */
  readonly companyUrl: string;
  readonly area: string;
  readonly salary: string;
  /** 擅長工具/語言（具體技術，如 C++、Linux）。跨工具語意一致：詳情的 skills 也是這個 */
  readonly skills: readonly string[];
  readonly url: string;
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
  pcSkills?: { description?: string }[];
  link?: { job?: string; cust?: string };
  appearDate?: string;
  /** 0=一般自然結果；1=精選/廣告（會無視關鍵字硬塞在最前面）；2=付費優先位 */
  jobType?: number;
}

export const NEGOTIABLE = "面議";
/** 104 用這個值表示「上限不設」，要正規化成「以上」，不能直接印出來 */
const NO_UPPER_LIMIT = 9_999_999;

/** 把薪資數字轉成人看得懂的字串（0/0 代表面議；上限 9999999 代表不設上限） */
function formatSalary(low?: number, high?: number): string {
  if (!low && !high) return NEGOTIABLE;
  const fmt = (n: number) => n.toLocaleString("en-US");
  const hasUpper = !!high && high < NO_UPPER_LIMIT; // 濾掉 9999999 這個哨兵值
  if (low && hasUpper) return `月薪 ${fmt(low)}~${fmt(high!)} 元`;
  if (low) return `月薪 ${fmt(low)} 元以上`; // 含 low>0 且上限不設的情況
  return `月薪 ${fmt(high!)} 元以下`;
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
  return {
    jobId: raw.jobNo ?? "",
    jobName: stripHighlight(raw.jobName ?? ""),
    companyName: raw.custName ?? "",
    companyUrl: raw.link?.cust ?? "",
    area: raw.jobAddrNoDesc ?? "",
    salary: formatSalary(raw.salaryLow, raw.salaryHigh),
    skills: (raw.pcSkills ?? []).map((s) => s.description ?? "").filter(Boolean),
    url: raw.link?.job ?? "",
    appearDate: raw.appearDate ?? "",
    // 只有 jobType=1 是會無視關鍵字硬塞的廣告；0(一般)和 2(優先位) 都是有效結果，一起分析
    featured: raw.jobType === 1,
  };
}

// ─────────────────────────────────────────────────────────────
// 職缺詳情（get_job_detail 用）
// ─────────────────────────────────────────────────────────────

/** 職缺完整詳情的乾淨型別 */
export interface JobDetail {
  readonly jobName: string;
  readonly companyName: string;
  /** 公司頁網址，可直接餵給 get_company_jobs 看這家公司所有職缺 */
  readonly companyUrl: string;
  readonly salary: string;
  readonly location: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly workExp: string;
  readonly education: string;
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
  header?: { jobName?: string; custName?: string; custUrl?: string };
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
 * ⚠️ 跟 normalizeJob 一樣是防腐層，104 改版時的修改點。
 */
export function normalizeJobDetail(raw: RawJobDetail): JobDetail {
  const jd = raw.jobDetail ?? {};
  const cond = raw.condition ?? {};
  const location = [jd.addressRegion, jd.addressDetail].filter(Boolean).join(" ");
  return {
    jobName: raw.header?.jobName ?? "",
    companyName: raw.header?.custName ?? "",
    companyUrl: raw.header?.custUrl ?? "",
    salary: jd.salary ?? "",
    location,
    description: (jd.jobDescription ?? "").trim(),
    categories: descriptions(jd.jobCategory),
    workExp: cond.workExp ?? "",
    education: cond.edu ?? "",
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
  readonly appearDate: string;
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
  appearDate?: string;
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
    appearDate: raw.appearDate ?? "",
  };
}
