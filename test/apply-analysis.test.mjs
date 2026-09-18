import { test } from "node:test";
import assert from "node:assert/strict";
import { slugToJobNo } from "../dist/slug.js";
import { buildApplyAnalysisUrl } from "../dist/query.js";
import { normalizeApplyAnalysis } from "../dist/types.js";

// ── slug（base36）→ jobNo（十進位）：應徵分析 API 只吃十進位 ──────────

test("slugToJobNo: 7bsyk → 12308060（規格書實測值；這是唯一不會隨每日更新變動的數字）", () => {
  assert.equal(slugToJobNo("7bsyk"), 12308060);
});

test("slugToJobNo: 大小寫不影響（base36 不分大小寫）", () => {
  assert.equal(slugToJobNo("7BSYK"), 12308060);
});

test("slugToJobNo: 不是 base36 的輸入要出聲，不能算出一個錯的 jobNo 靜默送出", () => {
  assert.throws(() => slugToJobNo(""), /職缺代碼/);
  assert.throws(() => slugToJobNo("7bs-yk"), /職缺代碼/);
  assert.throws(() => slugToJobNo("https://www.104.com.tw/job/7bsyk"), /職缺代碼/); // 網址要先 extractSlug
});

// ── 組網址 ──────────────────────────────────────────────────────────

test("buildApplyAnalysisUrl: job_no 帶十進位 jobNo", () => {
  const url = buildApplyAnalysisUrl(12308060);
  const u = new URL(url);
  assert.equal(u.pathname, "/jb/104i/applyAnalysisToJob/all");
  assert.equal(u.searchParams.get("job_no"), "12308060");
});

// ── normalize：規格書 §4 的實測形狀（2026-09-18 快照節錄；數字每日變動，測的是形狀與規則）──

const REF = { jobId: "7bsyk", jobNo: 12308060 };
const UPDATE = "2026-09-18 03:19:47";

/** 每個維度都是「數字字串 key 的物件」＋ update_time ＋ total，不是陣列 */
const rawSample = () => ({
  sex: {
    "0": { sexName: "男", count: 19, percent: "79.17" },
    "1": { sexName: "女", count: 5, percent: "20.83" },
    update_time: UPDATE,
    total: 24,
  },
  edu: {
    "0": { eduName: "博碩士", count: 15, percent: "62.50" },
    "1": { eduName: "大學", count: 9, percent: "37.50" },
    "2": { eduName: "專科", count: 0, percent: "0.00" },
    "6": { eduName: "無法判斷", count: 0, percent: "0.00" },
    update_time: UPDATE,
    total: 24,
  },
  yearRange: {
    "1": { yearRangeName: "21~25歲", count: 5, percent: "20.83" },
    "2": { yearRangeName: "26~30歲", count: 12, percent: "50.00" },
    "3": { yearRangeName: "31~35歲", count: 3, percent: "12.50" },
    "6": { yearRangeName: "46~50歲", count: 1, percent: "4.17" },
    update_time: UPDATE,
    total: 24,
  },
  exp: {
    "1": { expName: "1年以下", count: 3, percent: "12.50" },
    "2": { expName: "1~3年 ", count: 6, percent: "25.00" }, // 尾巴空白是真實資料
    update_time: UPDATE,
    total: 24,
  },
  language: {
    update_time: UPDATE,
    total: 24,
    "0": {
      lang_no: 1, langName: "英文", count: 18, percent: 75, // 這層 percent 是數字
      level: {
        "3": { level_no: 2, levelName: "精通", count: 9, percent: "37.50" },
        "1": { level_no: 4, levelName: "略懂", count: 3, percent: "12.50" },
        "2": { level_no: 8, levelName: "中等", count: 6, percent: "25.00" },
      },
    },
    "4": {
      lang_no: 10, langName: "泰文", count: 1, percent: 4.17,
      level: [{ level_no: 1, levelName: "不會", count: 1, percent: "4.17" }], // 有時是陣列
    },
  },
  major: {
    update_time: UPDATE,
    total: 24,
    "0": { major: 3008004000, majorName: "資訊工程相關", count: 10, percent: "41.67" },
    "1": { major: 3006005000, majorName: "資訊管理相關", count: 3, percent: "12.50" },
  },
  skill: {
    update_time: UPDATE,
    total: 24,
    "0": { skill: 12001003045, skillName: "Python", count: 11, percent: "45.83" },
    "1": { skill: 12001002018, skillName: "Git", count: 7, percent: "29.17" },
    "2": { skill: 12001002016, skillName: "Github", count: 6, percent: "25.00" },
    "3": { skill: 12001003010, skillName: "C++", count: 7, percent: "29.17" },
  },
  cert: {
    update_time: UPDATE,
    total: 24,
    "0": { cert: 4001001005, certName: "TOEIC (多益測驗)", count: 5, percent: "20.83" },
  },
});

test("normalizeApplyAnalysis: total 取 sex.total（不重複應徵人數）、updateTime、jobId/jobNo 帶回", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.equal(r.total, 24);
  assert.equal(r.updateTime, UPDATE);
  assert.equal(r.jobId, "7bsyk");
  assert.equal(r.jobNo, 12308060);
});

test("normalizeApplyAnalysis: 維度是物件不是陣列 —— 只收數字 key，update_time/total 不能變成一筆項目", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.deepEqual(r.sex.map((b) => b.name), ["男", "女"]);
  for (const dim of ["sex", "edu", "age", "exp", "language", "major", "skill", "cert"]) {
    for (const b of r[dim]) assert.ok(b.name && b.name !== "undefined", `${dim} 混進非項目 key：${JSON.stringify(b)}`);
  }
});

test("normalizeApplyAnalysis: count=0 的項目濾掉、依 count 由大到小排", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.deepEqual(r.edu, [
    { name: "博碩士", count: 15, percent: 62.5 },
    { name: "大學", count: 9, percent: 37.5 },
  ]); // 專科/無法判斷 = 0 → 不出現
  assert.equal(r.age[0].name, "26~30歲"); // yearRange 對外叫 age，最大值排第一
  assert.equal(r.age[0].count, 12);
  assert.deepEqual(r.skill.map((b) => b.count), [11, 7, 7, 6]); // Git/C++ 同 7 保持原順序（穩定排序）
});

test("normalizeApplyAnalysis: percent 字串與數字混用一律轉數字", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.equal(r.sex[0].percent, 79.17); // "79.17" → 79.17
  assert.equal(r.language[0].percent, 75); // 75 → 75
  assert.equal(typeof r.language[0].levels[0].percent, "number");
});

test("normalizeApplyAnalysis: expName 尾巴空白要 trim", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.ok(r.exp.some((b) => b.name === "1~3年"), JSON.stringify(r.exp));
  assert.ok(!r.exp.some((b) => b.name.endsWith(" ")));
});

test("normalizeApplyAnalysis: language.level 是物件或陣列都要吃，levels 同樣 count 遞減", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  const en = r.language.find((l) => l.name === "英文");
  assert.deepEqual(en.levels.map((b) => `${b.name}:${b.count}`), ["精通:9", "中等:6", "略懂:3"]);
  const th = r.language.find((l) => l.name === "泰文");
  assert.deepEqual(th.levels, [{ name: "不會", count: 1, percent: 4.17 }]);
});

test("normalizeApplyAnalysis: skill/major/cert 只是 top 10，count 加總不必等於 total（不能為此報錯）", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  const sum = r.skill.reduce((a, b) => a + b.count, 0);
  assert.notEqual(sum, r.total);
});

test("normalizeApplyAnalysis: 缺某個維度 → 該維度空陣列（不炸），但 sex.total 沒有就要出聲", () => {
  const raw = rawSample();
  delete raw.cert;
  assert.deepEqual(normalizeApplyAnalysis(raw, REF).cert, []);

  assert.throws(() => normalizeApplyAnalysis({}, REF), /應徵分析/);
  assert.throws(() => normalizeApplyAnalysis(null, REF), /應徵分析/);
  assert.throws(() => normalizeApplyAnalysis({ sex: { "0": { sexName: "男", count: 1 } } }, REF), /應徵分析/); // 沒 total
});

test("normalizeApplyAnalysis: 各維度 total 不一致 → 出聲（fail loud），不准挑一個靜默回", () => {
  const raw = rawSample();
  raw.language.total = 26;
  assert.throws(() => normalizeApplyAnalysis(raw, REF), /language/);
});
