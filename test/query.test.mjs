import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSearchUrl,
  extractSlug,
  extractCompanyCode,
  filterJobs,
  REMOTE_CODES,
  JOB_TYPE_CODES,
  EXPERIENCE_CODES,
  SORT_CODES,
  limitJobs,
} from "../dist/query.js";

const params = (url) => new URL(url).searchParams;

test("buildSearchUrl: 只有關鍵字 → 不帶篩選參數", () => {
  const p = params(buildSearchUrl({ keyword: "Rust" }));
  assert.equal(p.get("keyword"), "Rust");
  assert.equal(p.get("order"), "15");
  assert.ok(p.get("pagesize"));
  for (const k of ["scmin", "area", "jobcat", "remoteWork", "ro", "jobexp", "page"]) {
    assert.equal(p.get(k), null, `${k} 不該出現`);
  }
});

test("buildSearchUrl: salaryMin → scmin+sctp=M+scstrict=1+scneg=1（保留面議）", () => {
  const p = params(buildSearchUrl({ keyword: "Rust", salaryMin: 60000 }));
  assert.equal(p.get("scmin"), "60000");
  assert.equal(p.get("sctp"), "M");
  assert.equal(p.get("scstrict"), "1"); // 少了它薪資篩選會失效 —— 這條測試就是防守它
  assert.equal(p.get("scneg"), "1");
});

test("buildSearchUrl: excludeNegotiable → scneg=0", () => {
  const p = params(buildSearchUrl({ keyword: "Rust", salaryMin: 60000, excludeNegotiable: true }));
  assert.equal(p.get("scneg"), "0");
});

test("buildSearchUrl: salaryMin=0 視為未設", () => {
  const p = params(buildSearchUrl({ keyword: "Rust", salaryMin: 0 }));
  assert.equal(p.get("scmin"), null);
});

test("buildSearchUrl: 地區/職類代碼 → 逗號串接", () => {
  const p = params(buildSearchUrl({ keyword: "x", areaCodes: ["6001001000", "6001002000"], jobCatCodes: ["2007000000"] }));
  assert.equal(p.get("area"), "6001001000,6001002000");
  assert.equal(p.get("jobcat"), "2007000000");
});

test("buildSearchUrl: 遠端/全兼職/年資 對應正確參數名", () => {
  const p = params(buildSearchUrl({ keyword: "x", remoteWork: "1,2", jobType: "1", experience: "5" }));
  assert.equal(p.get("remoteWork"), "1,2");
  assert.equal(p.get("ro"), "1");
  assert.equal(p.get("jobexp"), "5");
});

test("buildSearchUrl: page>1 才帶 page", () => {
  assert.equal(params(buildSearchUrl({ keyword: "x", page: 1 })).get("page"), null);
  assert.equal(params(buildSearchUrl({ keyword: "x", page: 3 })).get("page"), "3");
});

test("enum 對照表：值符合實測的 104 代碼", () => {
  assert.equal(REMOTE_CODES.full, "1");
  assert.equal(REMOTE_CODES.partial, "2");
  assert.equal(REMOTE_CODES.any, "1,2");
  assert.equal(JOB_TYPE_CODES.fulltime, "1");
  assert.equal(JOB_TYPE_CODES.parttime, "2");
  assert.deepEqual(Object.values(EXPERIENCE_CODES), ["1", "3", "5", "10", "99"]);
});

test("extractSlug: 完整網址 / 帶 query / 裸 slug", () => {
  assert.equal(extractSlug("https://www.104.com.tw/job/7uqyj"), "7uqyj");
  assert.equal(extractSlug("https://www.104.com.tw/job/7uqyj?jobsource=x"), "7uqyj");
  assert.equal(extractSlug(" 7uqyj "), "7uqyj");
});

test("extractCompanyCode: 完整網址 / 帶 query / 裸代碼", () => {
  assert.equal(extractCompanyCode("https://www.104.com.tw/company/1a2x6blghh"), "1a2x6blghh");
  assert.equal(extractCompanyCode("https://www.104.com.tw/company/1a2x6blghh?jobsource=x"), "1a2x6blghh");
  assert.equal(extractCompanyCode(" 1a2x6blghh "), "1a2x6blghh");
});

const mk = (over) => ({ jobId: "1", jobName: "x", companyName: "c", companyUrl: "", area: "台北市信義區", salary: "月薪 60,000 元以上", skills: [], url: "", appearDate: "", featured: false, ...over });

test("filterJobs: 地區子字串比對", () => {
  const r = filterJobs([mk({ area: "台北市信義區" }), mk({ area: "新竹市東區" })], { area: "新竹" });
  assert.equal(r.length, 1);
  assert.equal(r[0].area, "新竹市東區");
});

test("filterJobs: excludeNegotiable 濾掉面議", () => {
  const r = filterJobs([mk({ salary: "面議" }), mk({ salary: "月薪 60,000 元以上" })], { excludeNegotiable: true });
  assert.equal(r.length, 1);
});

test("filterJobs: excludeFeatured 濾掉廣告位（featured=true）", () => {
  const r = filterJobs([mk({ featured: true }), mk({ featured: false })], { excludeFeatured: true });
  assert.equal(r.length, 1);
  assert.equal(r[0].featured, false);
});

test("filterJobs: 不設條件 → 回新陣列（不可變）", () => {
  const jobs = [mk({}), mk({})];
  const r = filterJobs(jobs, {});
  assert.equal(r.length, 2);
  assert.notEqual(r, jobs);
});

test("SORT_CODES: newest=16（掃新缺靠它）、salary=13", () => {
  assert.equal(SORT_CODES.newest, "16");
  assert.equal(SORT_CODES.salary, "13");
});

test("buildSearchUrl: 給 order → 覆寫預設排序", () => {
  const newest = params(buildSearchUrl({ keyword: "Rust", order: "16" }));
  assert.equal(newest.get("order"), "16");
  const salary = params(buildSearchUrl({ keyword: "Rust", order: "13" }));
  assert.equal(salary.get("order"), "13");
});

// 造 n 筆一般職缺（jobId 遞增，好認尾端有沒有被砍）
const normalsN = (n) => Array.from({ length: n }, (_, i) => mk({ jobId: `N${i + 1}` }));

test("limitJobs: 廣告不佔名額 —— 頁首2廣告+20一般/limit20 → 22筆，尾端不被砍", () => {
  const jobs = limitJobs(
    [mk({ jobId: "A1", featured: true }), mk({ jobId: "A2", featured: true }), ...normalsN(20)],
    20,
  );
  assert.equal(jobs.length, 22);
  assert.equal(jobs.at(-1).jobId, "N20"); // 上一版會砍 N19/N20，這條就是防守它
});

test("limitJobs: limit 只數一般職缺 —— 2廣告+limit5 → 7筆", () => {
  const jobs = limitJobs([mk({ featured: true }), mk({ featured: true }), ...normalsN(20)], 5);
  assert.equal(jobs.length, 7);
  assert.equal(jobs.filter((j) => j.featured).length, 2);
  assert.equal(jobs.at(-1).jobId, "N5");
});

test("limitJobs: 沒有廣告時等同 slice", () => {
  const jobs = limitJobs(normalsN(20), 5);
  assert.equal(jobs.length, 5);
  assert.equal(jobs.at(-1).jobId, "N5");
});

test("limitJobs: 取滿 limit 筆一般後即截斷（其後的廣告不再跟回）", () => {
  const jobs = limitJobs([...normalsN(5), mk({ jobId: "A9", featured: true })], 5);
  assert.equal(jobs.length, 5);
  assert.equal(jobs.at(-1).jobId, "N5");
});
