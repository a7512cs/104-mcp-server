import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJob, normalizeJobDetail, NEGOTIABLE } from "../dist/types.js";

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

test("normalizeJob: url 取自 link.job", () => {
  const job = normalizeJob({ link: { job: "https://www.104.com.tw/job/abc12" } });
  assert.equal(job.url, "https://www.104.com.tw/job/abc12");
});

test("normalizeJob: 缺欄位不炸，回空字串/空陣列", () => {
  const job = normalizeJob({});
  assert.equal(job.jobName, "");
  assert.equal(job.companyName, "");
  assert.deepEqual(job.skills, []);
});

test("normalizeJobDetail: 語言能力格式化", () => {
  const d = normalizeJobDetail({
    condition: { language: [{ language: "英文", ability: { listening: "中等", speaking: "中等", reading: "略懂", writing: "略懂" } }] },
  });
  assert.deepEqual(d.languages, ["英文 (聽:中等 說:中等 讀:略懂 寫:略懂)"]);
});

test("normalizeJobDetail: 地點 = region + detail", () => {
  const d = normalizeJobDetail({ jobDetail: { addressRegion: "新北市新店區", addressDetail: "寶高路26號" } });
  assert.equal(d.location, "新北市新店區 寶高路26號");
});

test("normalizeJobDetail: 技能/職類抽 description", () => {
  const d = normalizeJobDetail({
    jobDetail: { jobCategory: [{ code: "1", description: "軟體工程師" }] },
    condition: { specialty: [{ description: "Linux" }, { description: "C++" }] },
  });
  assert.deepEqual(d.categories, ["軟體工程師"]);
  assert.deepEqual(d.specialties, ["Linux", "C++"]);
});

test("normalizeJobDetail: 福利標籤直接帶出", () => {
  const d = normalizeJobDetail({ welfare: { tag: ["年終獎金", "三節獎金"] } });
  assert.deepEqual(d.welfareTags, ["年終獎金", "三節獎金"]);
});
