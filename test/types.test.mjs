import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJob, normalizeJobDetail, normalizeCompanyJob, NEGOTIABLE } from "../dist/types.js";

test("normalizeJob: 薪資 0/0 → 面議", () => {
  const job = normalizeJob({ salaryLow: 0, salaryHigh: 0 });
  assert.equal(job.salary, NEGOTIABLE);
});

test("normalizeJob: 上限 9999999 哨兵值 → 「以上」，不可印出 9,999,999", () => {
  const job = normalizeJob({ salaryLow: 90000, salaryHigh: 9999999 });
  assert.equal(job.salary, "月薪 90,000 元以上");
  assert.ok(!job.salary.includes("9,999,999"));
});

test("normalizeJob: 有上下限 → 區間格式", () => {
  const job = normalizeJob({ salaryLow: 60000, salaryHigh: 80000 });
  assert.equal(job.salary, "月薪 60,000~80,000 元");
});

test("normalizeJob: 只有上限 → 「以下」", () => {
  const job = normalizeJob({ salaryLow: 0, salaryHigh: 50000 });
  assert.equal(job.salary, "月薪 50,000 元以下");
});

test("normalizeJob: 清掉 [[[ ]]] 關鍵字標記", () => {
  const job = normalizeJob({ jobName: "【[[[Rust]]]】工程師" });
  assert.equal(job.jobName, "【Rust】工程師");
});

test("normalizeJob: pcSkills → skills 陣列，過濾空值", () => {
  const job = normalizeJob({ pcSkills: [{ description: "Python" }, {}, { description: "Git" }] });
  assert.deepEqual(job.skills, ["Python", "Git"]);
});

test("normalizeJob: jobId=slug（非數字 jobNo）、url、companyUrl 都取自 link", () => {
  const job = normalizeJob({ jobNo: "13191931", link: { job: "https://www.104.com.tw/job/abc12", cust: "https://www.104.com.tw/company/xyz99" } });
  assert.equal(job.jobId, "abc12"); // slug，不是數字 13191931 —— 可直接餵給 get_job_detail
  assert.equal(job.url, "https://www.104.com.tw/job/abc12");
  assert.equal(job.companyUrl, "https://www.104.com.tw/company/xyz99");
});

test("normalizeJob: 沒有 link 時 jobId 退回 jobNo", () => {
  assert.equal(normalizeJob({ jobNo: "999" }).jobId, "999");
});

test("normalizeJob: 缺欄位不炸，回空字串/空陣列", () => {
  const job = normalizeJob({});
  assert.equal(job.jobName, "");
  assert.equal(job.companyName, "");
  assert.deepEqual(job.skills, []);
  assert.equal(job.featured, false); // 沒 jobType 視為一般
});

test("normalizeJob: featured 只認 jobType=1（廣告）；0 一般、2 優先位都算有效結果", () => {
  assert.equal(normalizeJob({ jobType: 0 }).featured, false); // 一般
  assert.equal(normalizeJob({ jobType: 1 }).featured, true); // 廣告（無視關鍵字）
  assert.equal(normalizeJob({ jobType: 2 }).featured, false); // 優先位，仍符合關鍵字 → 保留分析
});

test("normalizeJobDetail: 語言能力格式化", () => {
  const d = normalizeJobDetail({
    condition: { language: [{ language: "英文", ability: { listening: "中等", speaking: "中等", reading: "略懂", writing: "略懂" } }] },
  });
  assert.deepEqual(d.languages, ["英文 (聽:中等 說:中等 讀:略懂 寫:略懂)"]);
});

test("normalizeJobDetail: area=區級、location=區+街道（兩個都給）", () => {
  const d = normalizeJobDetail({ jobDetail: { addressRegion: "新北市新店區", addressDetail: "寶高路26號" } });
  assert.equal(d.area, "新北市新店區"); // 跟 search / company 的 area 一致
  assert.equal(d.location, "新北市新店區 寶高路26號"); // 更詳細
});

test("normalizeJobDetail: experience 取自 workExp（跟 company 的 experience 同名）", () => {
  assert.equal(normalizeJobDetail({ condition: { workExp: "3年以上" } }).experience, "3年以上");
});

test("normalizeJobDetail: ref 帶入 jobId(slug) 與 url，跟其他工具一致", () => {
  const d = normalizeJobDetail({ header: { jobName: "x" } }, { jobId: "7uqyj", url: "https://www.104.com.tw/job/7uqyj" });
  assert.equal(d.jobId, "7uqyj");
  assert.equal(d.url, "https://www.104.com.tw/job/7uqyj");
});

test("normalizeJob: appearDate 從 20260817 轉成 2026/08/17（跟詳情同格式）", () => {
  assert.equal(normalizeJob({ appearDate: "20260817" }).appearDate, "2026/08/17");
  assert.equal(normalizeJob({}).appearDate, ""); // 缺值回空字串
});

test("normalizeCompanyJob: 不回傳 appearDate（原始只有 8/20 無年份，跨年會靜默誤導）", () => {
  const job = normalizeCompanyJob({ jobNo: "x", appearDate: "8/20" });
  assert.ok(!("appearDate" in job)); // 要日期就把 jobId 餵給 get_job_detail 拿完整的
});

test("normalizeJobDetail: appearDate 取自 header（頁面上的「MM/DD更新」）", () => {
  const d = normalizeJobDetail({ header: { appearDate: "2026/08/22" } });
  assert.equal(d.appearDate, "2026/08/22");
});

test("normalizeJobDetail: companyUrl 取自 header.custUrl", () => {
  const d = normalizeJobDetail({ header: { custUrl: "https://www.104.com.tw/company/xyz99" } });
  assert.equal(d.companyUrl, "https://www.104.com.tw/company/xyz99");
});

test("normalizeJobDetail: skills=擅長工具(specialty) / jobSkills=職務技能(skill)，語意跟 search 一致", () => {
  const d = normalizeJobDetail({
    jobDetail: { jobCategory: [{ code: "1", description: "軟體工程師" }] },
    condition: {
      specialty: [{ description: "Linux" }, { description: "C++" }], // 擅長工具
      skill: [{ description: "軟體工程系統開發" }], // 職務技能（職類層級）
    },
  });
  assert.deepEqual(d.categories, ["軟體工程師"]);
  assert.deepEqual(d.skills, ["Linux", "C++"]); // 跟 search_jobs 的 skills 同一種東西
  assert.deepEqual(d.jobSkills, ["軟體工程系統開發"]);
});

test("normalizeJobDetail: 福利標籤直接帶出", () => {
  const d = normalizeJobDetail({ welfare: { tag: ["年終獎金", "三節獎金"] } });
  assert.deepEqual(d.welfareTags, ["年終獎金", "三節獎金"]);
});
