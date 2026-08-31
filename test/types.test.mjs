import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeJob, normalizeJobDetail, normalizeCompanyJob, NEGOTIABLE, buildCompanyKeywordResult, normalizeCompanyCard, pickCompany, interpretSearchMetadata } from "../dist/types.js";

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

test("normalizeJob: s10 薪資類型 —— 時薪/日薪/月薪/年薪，不再寫死月薪", () => {
  assert.equal(normalizeJob({ salaryLow: 235, salaryHigh: 265, s10: 30 }).salary, "時薪 235~265 元");
  assert.equal(normalizeJob({ salaryLow: 1250, salaryHigh: 0, s10: 40 }).salary, "日薪 1,250 元以上");
  assert.equal(normalizeJob({ salaryLow: 1000000, salaryHigh: 9999999, s10: 60 }).salary, "年薪 1,000,000 元以上");
  assert.equal(normalizeJob({ salaryLow: 60000, salaryHigh: 80000, s10: 50 }).salary, "月薪 60,000~80,000 元");
  assert.equal(normalizeJob({ salaryLow: 60000, salaryHigh: 80000 }).salary, "月薪 60,000~80,000 元"); // 沒 s10 → 預設月薪
  assert.equal(normalizeJob({ salaryLow: 0, salaryHigh: 0, s10: 10 }).salary, NEGOTIABLE); // 10 = 面議
});

test("normalizeJob: applyCount 應徵人數（判斷競爭度）", () => {
  assert.equal(normalizeJob({ applyCnt: 12 }).applyCount, 12);
  assert.equal(normalizeJob({}).applyCount, 0);
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

test("normalizeJobDetail: majors 科系要求、otherConditions 其他條件（外派/證照這類關鍵資訊）", () => {
  const d = normalizeJobDetail({
    condition: { major: ["資訊工程相關", "電機電子工程相關"], other: "本職務需出差外派（工作地點：日本）\n" },
  });
  assert.deepEqual(d.majors, ["資訊工程相關", "電機電子工程相關"]);
  assert.equal(d.otherConditions, "本職務需出差外派（工作地點：日本）");
  // 104 的 other 偶爾是陣列，容忍並合併
  assert.equal(normalizeJobDetail({ condition: { other: ["條件A", "條件B"] } }).otherConditions, "條件A\n條件B");
  assert.equal(normalizeJobDetail({}).otherConditions, "");
});

test("normalizeJobDetail: 福利標籤直接帶出", () => {
  const d = normalizeJobDetail({ welfare: { tag: ["年終獎金", "三節獎金"] } });
  assert.deepEqual(d.welfareTags, ["年終獎金", "三節獎金"]);
});

test("normalizeJob: employeeCount 數字直取、數字字串轉數字", () => {
  assert.equal(normalizeJob({ employeeCount: 28 }).employeeCount, 28);
  assert.equal(normalizeJob({ employeeCount: "3900" }).employeeCount, 3900);
});

test("normalizeJob: employeeCount 缺欄位 → 0（0 代表未公開，不是 0 人）", () => {
  assert.equal(normalizeJob({}).employeeCount, 0);
});

test("buildCompanyKeywordResult: 把 104 的公司名暗號翻譯成下一步指示（觀眾是模型）", () => {
  const r = buildCompanyKeywordResult("聯發科");
  assert.equal(r.companyKeyword.query, "聯發科");
  assert.ok(r.companyKeyword.hint.includes("find_company"), "要指名 find_company");
  assert.ok(r.companyKeyword.hint.includes("get_company_jobs"), "要指名 get_company_jobs");
});

// ── 公司名片（find_company） ──────────────────────────────────

const card = (over) => normalizeCompanyCard({ encodedCustNo: "x1", name: "某公司", jobCount: 3, ...over });

test("normalizeCompanyCard: encodedCustNo → companyId(slug)，並組出 companyUrl", () => {
  const c = normalizeCompanyCard({
    encodedCustNo: "12noppgo",
    name: " 聯發科技股份有限公司 ",
    areaDesc: "新竹市",
    industryDesc: "半導體製造業",
    employeeCountDesc: "員工數16000人",
    capitalDesc: "資本額150億",
    jobCount: 465,
  });
  assert.equal(c.companyId, "12noppgo");
  assert.equal(c.companyName, "聯發科技股份有限公司"); // trim
  assert.equal(c.companyUrl, "https://www.104.com.tw/company/12noppgo"); // 可直接餵 get_company_jobs
  assert.equal(c.jobCount, 465);
});

test("normalizeCompanyCard: 缺欄位不炸 —— 空字串/0", () => {
  const c = normalizeCompanyCard({});
  assert.equal(c.companyId, "");
  assert.equal(c.companyUrl, ""); // 沒 slug 就不硬組網址
  assert.equal(c.jobCount, 0);
});

test("pickCompany: 唯一命中 → 直接回單一名片", () => {
  const r = pickCompany([card({ encodedCustNo: "a1", name: "獨一無二公司" })], 1, "獨一無二");
  assert.equal(r.total, 1);
  assert.equal(r.company.companyId, "a1");
  assert.equal(r.candidates, undefined);
});

test("pickCompany: 名稱完全相符 → 即使多家也直接回那筆（輸入就是全名）", () => {
  const cards = [
    card({ encodedCustNo: "a5h92m0", name: "台灣積體電路製造股份有限公司(台積電)" }),
    card({ encodedCustNo: "b2", name: "台積電機有限公司" }),
  ];
  const r = pickCompany(cards, 662, "台積電機有限公司");
  assert.equal(r.company.companyId, "b2");
  assert.equal(r.total, 662);
});

test("pickCompany: 多家無完全相符 → 候選+hint，不猜（觀眾是模型）", () => {
  const cards = [card({ encodedCustNo: "c1", name: "聯發科技股份有限公司" }), card({ encodedCustNo: "c2", name: "全家便利商店聯發科店" })];
  const r = pickCompany(cards, 102, "聯發科");
  assert.equal(r.company, undefined); // 就是不猜 —— 這條防守它
  assert.equal(r.candidates.length, 2);
  assert.ok(r.hint.includes("確認"));
  assert.ok(r.hint.includes("get_company_jobs"));
});

test("pickCompany: 候選最多 5 筆（超過只稀釋判斷）", () => {
  const cards = Array.from({ length: 8 }, (_, i) => card({ encodedCustNo: `n${i}`, name: `公司${i}` }));
  const r = pickCompany(cards, 200, "公司");
  assert.equal(r.candidates.length, 5);
});

test("pickCompany: 找不到 → total=0 + hint，沒有 company/candidates", () => {
  const r = pickCompany([], 0, "不存在的公司名");
  assert.equal(r.total, 0);
  assert.equal(r.company, undefined);
  assert.equal(r.candidates, undefined);
  assert.ok(r.hint.length > 0);
});

// ── 搜尋 metadata 三路分派（審查抓到的缺口：還原舊 bug 測試曾照樣全綠） ──

test("interpretSearchMetadata: 正常回應 → ok+total", () => {
  const r = interpretSearchMetadata({ pagination: { total: 1101 } }, "聯發科");
  assert.deepEqual(r, { kind: "ok", total: 1101 });
});

test("interpretSearchMetadata: companyKeyword 暗號 → 翻譯，不是 0 筆也不是錯誤", () => {
  const r = interpretSearchMetadata({ companyKeyword: true }, "聯發科");
  assert.equal(r.kind, "companyKeyword");
});

test("interpretSearchMetadata: 兩者皆無 → 出聲（fail loud），不准靜默演成「查無職缺」", () => {
  assert.throws(() => interpretSearchMetadata({}, "x"), /分頁/);
  assert.throws(() => interpretSearchMetadata(undefined, "x"), /分頁/);
  assert.throws(() => interpretSearchMetadata({ pagination: {} }, "x"), /分頁/);
});

// ── pickCompany 的「不猜」不變量：從兩側防守（審查抓到的突變缺口） ──

test("pickCompany: 只剩 1 張卡但 total>1 → 仍回候選，不准確信地猜", () => {
  const r = pickCompany([card({ encodedCustNo: "z1", name: "某某科技" })], 3, "某某");
  assert.equal(r.company, undefined);
  assert.equal(r.candidates.length, 1);
});

test("pickCompany: 完全相符排在第 6 名也要被找到（exact 掃全部卡，不是只掃候選前 5）", () => {
  const cards = Array.from({ length: 7 }, (_, i) => card({ encodedCustNo: `e${i}`, name: `相近公司${i}` }));
  cards[5] = card({ encodedCustNo: "hit", name: "目標全名股份有限公司" });
  const r = pickCompany(cards, 50, "目標全名股份有限公司");
  assert.equal(r.company.companyId, "hit");
});

test("pickCompany: 空清單保留呼叫端給的 total（不硬編 0）", () => {
  assert.equal(pickCompany([], 5, "x").total, 5);
});
