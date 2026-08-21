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
  readonly area: string;
  readonly salary: string;
  readonly skills: readonly string[];
  readonly description: string;
  readonly url: string;
  readonly appearDate: string;
}

/** 104 原始職缺（只列我們會用到的欄位，其餘忽略） */
interface RawJob {
  jobNo?: string;
  jobName?: string;
  custName?: string;
  jobAddrNoDesc?: string;
  salaryLow?: number;
  salaryHigh?: number;
  descSnippet?: string;
  description?: string;
  pcSkills?: { description?: string }[];
  link?: { job?: string };
  appearDate?: string;
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
 * 把一筆 104 原始職缺轉成乾淨的 Job。
 * ⚠️ 這是「防腐層」—— 104 改版時的唯一修改點。
 */
export function normalizeJob(raw: RawJob): Job {
  const rawDesc = raw.description ?? raw.descSnippet ?? "";
  return {
    jobId: raw.jobNo ?? "",
    jobName: stripHighlight(raw.jobName ?? ""),
    companyName: raw.custName ?? "",
    area: raw.jobAddrNoDesc ?? "",
    salary: formatSalary(raw.salaryLow, raw.salaryHigh),
    skills: (raw.pcSkills ?? []).map((s) => s.description ?? "").filter(Boolean),
    description: stripHighlight(rawDesc),
    url: raw.link?.job ?? "",
    appearDate: raw.appearDate ?? "",
  };
}

// ─────────────────────────────────────────────────────────────
// 職缺詳情（get_job_detail 用）
// ─────────────────────────────────────────────────────────────

/** 職缺完整詳情的乾淨型別 */
export interface JobDetail {
  readonly jobName: string;
  readonly companyName: string;
  readonly salary: string;
  readonly location: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly workExp: string;
  readonly education: string;
  readonly skills: readonly string[];
  readonly specialties: readonly string[];
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
  header?: { jobName?: string; custName?: string };
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
    salary: jd.salary ?? "",
    location,
    description: (jd.jobDescription ?? "").trim(),
    categories: descriptions(jd.jobCategory),
    workExp: cond.workExp ?? "",
    education: cond.edu ?? "",
    skills: descriptions(cond.skill),
    specialties: descriptions(cond.specialty),
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
