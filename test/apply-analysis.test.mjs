import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ── normalize：規格書 §4 的實測形狀（2026-09-18 快照節錄；當時 API 還回真實 total/count）──

const REF = { jobId: "7bsyk", jobNo: 12308060, rangeCode: 3 }; // 3 = 11~30 人
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

test("normalizeApplyAnalysis: API 還回 total>0（9/18 形狀）→ 直接用 API 的 total 與 count，totalBasis=api", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.equal(r.total, 24);
  assert.equal(r.totalBasis, "api");
  assert.deepEqual(r.totalCandidates, [24]);
  assert.equal(r.applyRange, "11~30 人");
  assert.equal(r.updateTime, UPDATE);
  assert.equal(r.jobId, "7bsyk");
  assert.equal(r.jobNo, 12308060);
});

test("normalizeApplyAnalysis: 不輸出 sex —— 10/07 起 104 拿掉了，留著只會是永遠空的欄位", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.equal("sex" in r, false);
});

test("normalizeApplyAnalysis: 維度是物件不是陣列 —— 只收數字 key，update_time/total 不能變成一筆項目", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.deepEqual(r.edu.map((b) => b.name), ["博碩士", "大學"]);
  for (const dim of ["edu", "age", "exp", "language", "major", "skill", "cert"]) {
    for (const b of r[dim]) assert.ok(b.name && b.name !== "undefined", `${dim} 混進非項目 key：${JSON.stringify(b)}`);
  }
});

test("normalizeApplyAnalysis: 0% 的項目濾掉、依比例由大到小排", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.deepEqual(r.edu, [
    { name: "博碩士", count: 15, percent: 62.5 },
    { name: "大學", count: 9, percent: 37.5 },
  ]); // 專科/無法判斷 = 0 → 不出現
  assert.equal(r.age[0].name, "26~30歲"); // yearRange 對外叫 age，最大值排第一
  assert.equal(r.age[0].count, 12);
  assert.deepEqual(r.skill.map((b) => b.count), [11, 7, 7, 6]); // Git/C++ 同 29.17% 保持原順序（穩定排序）
});

test("normalizeApplyAnalysis: percent 字串與數字混用一律轉數字", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.equal(r.edu[0].percent, 62.5); // "62.50" → 62.5
  assert.equal(r.language[0].percent, 75); // 75 → 75
  assert.equal(typeof r.language[0].levels[0].percent, "number");
});

test("normalizeApplyAnalysis: expName 尾巴空白要 trim", () => {
  const r = normalizeApplyAnalysis(rawSample(), REF);
  assert.ok(r.exp.some((b) => b.name === "1~3年"), JSON.stringify(r.exp));
  assert.ok(!r.exp.some((b) => b.name.endsWith(" ")));
});

test("normalizeApplyAnalysis: language.level 是物件或陣列都要吃，levels 同樣比例遞減", () => {
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

test("normalizeApplyAnalysis: 缺某個維度 → 該維度空陣列；沒有 sex 也不炸；一個維度都沒有才出聲", () => {
  const raw = rawSample();
  delete raw.cert;
  delete raw.sex;
  const r = normalizeApplyAnalysis(raw, REF);
  assert.deepEqual(r.cert, []);
  assert.equal(r.total, 24); // 沒 sex 照樣從其他維度拿 total

  assert.throws(() => normalizeApplyAnalysis({}, REF), /應徵分析/);
  assert.throws(() => normalizeApplyAnalysis(null, REF), /應徵分析/);
});

test("normalizeApplyAnalysis: 各維度 total 不一致 → 出聲（fail loud），不准挑一個靜默回", () => {
  const raw = rawSample();
  raw.language.total = 26;
  assert.throws(() => normalizeApplyAnalysis(raw, REF), /language/);
});

// ── 10/07 起：total/count 恆 0，只剩 percent → 反推確切人數 ─────────────

/** 10/07 的遮罩：把 total 和每個 count 都抹成 0，只留 percent */
function maskLike1007(raw) {
  const zero = (o) => {
    if (Array.isArray(o)) return o.map(zero);
    if (typeof o !== "object" || o === null) return o;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "count" || k === "total" ? 0 : zero(v)]));
  };
  const { sex, ...rest } = zero(raw);
  return rest;
}

/** 2026-10-07 真實回應（cycletls 直打）＋ 同一天職缺詳情的 header.analysisType */
const fixture = (slug) =>
  JSON.parse(readFileSync(new URL(`./fixtures/apply-analysis-${slug}-2026-10-07.json`, import.meta.url), "utf8"));
const fromFixture = (slug, rangeCode = fixture(slug).analysisType) =>
  normalizeApplyAnalysis(fixture(slug).response, { jobId: slug, jobNo: parseInt(slug, 36), rangeCode });

test("normalizeApplyAnalysis: 9/18 黃金案例套上 10/07 遮罩 → 只靠 percent 要推回當時 API 的 24", () => {
  const r = normalizeApplyAnalysis(maskLike1007(rawSample()), REF);
  assert.equal(r.total, 24);
  assert.equal(r.totalBasis, "inferred");
  assert.equal(r.edu[0].count, 15); // count = round(62.5% × 24)
});

test("normalizeApplyAnalysis: 10/07 真實回應 → 反推人數落在 104 區間內", () => {
  const cases = [
    ["7bsyk", 27, [27], "11~30 人"],
    ["80ao3", 8, [8], "6~10 人"],
    ["5tr8f", 12, [12, 24], "11~30 人"], // 24 也符合且在區間內 → 兩個都列，最小的當 total
  ];
  for (const [slug, total, candidates, range] of cases) {
    const r = fromFixture(slug);
    assert.equal(r.total, total, slug);
    assert.equal(r.totalBasis, "inferred", slug);
    assert.deepEqual(r.totalCandidates, candidates, slug);
    assert.equal(r.applyRange, range, slug);
  }
});

test("normalizeApplyAnalysis: 反推後 count = round(percent × total) —— 學歷、年資才有「幾個人」", () => {
  const r = fromFixture("80ao3"); // 天一電子，8 人
  assert.deepEqual(r.edu.map((b) => `${b.name}:${b.count}`), ["博碩士:4", "大學:4"]);
  assert.equal(r.exp.find((b) => b.name === "1~3年").count, 3);
  assert.equal(r.exp.find((b) => b.name === "15~20年").count, 2);
});

test("normalizeApplyAnalysis: language 第一層 percent 是各程度四捨五入後的加總，不能拿來反推（7bsyk 放進去會推不出來）", () => {
  const raw = fixture("7bsyk").response;
  assert.equal(Number(raw.language["4"].percent), 22.21); // 中文：3.70 + 14.81 + 3.70，不是 6/27 = 22.22
  assert.equal(fromFixture("7bsyk").total, 27);
});

test("normalizeApplyAnalysis: 反推結果跟 104 區間對不上 → total=null、totalBasis=unknown、count=null（不猜）", () => {
  const r = fromFixture("80ao3", 1); // 假裝 104 說 0~5 人，但 percent 只容得下 8 的倍數
  assert.equal(r.total, null);
  assert.equal(r.totalBasis, "unknown");
  assert.deepEqual(r.totalCandidates, []);
  assert.equal(r.edu[0].count, null);
  assert.equal(r.edu[0].percent, 50); // percent 照樣給
});

test("normalizeApplyAnalysis: 沒有區間（詳情抓不到）→ 照樣反推，回最小候選，其他候選列出來", () => {
  const r = fromFixture("80ao3", null); // fetchApplyRangeCode 失敗時回 null
  assert.equal(r.total, 8);
  assert.deepEqual(r.totalCandidates, [8, 16, 24]);
  assert.equal(r.applyRange, "");
});

test("normalizeApplyAnalysis: percent 全 0 → 區間 0~5 人時 total=0；區間說有人卻全 0 → unknown", () => {
  const empty = maskLike1007({ edu: { "0": { eduName: "大學", count: 0, percent: "0.00" }, update_time: UPDATE, total: 0 } });
  assert.equal(normalizeApplyAnalysis(empty, { ...REF, rangeCode: 1 }).total, 0);
  const r = normalizeApplyAnalysis(empty, { ...REF, rangeCode: 3 });
  assert.equal(r.total, null);
  assert.equal(r.totalBasis, "unknown");
});
