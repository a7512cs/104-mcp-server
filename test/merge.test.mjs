import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCompanyJobLists, normalizeCompanyJob } from "../dist/types.js";

// 造 N 筆一般職缺（jobNo 遞增，好認尾端有沒有被砍）
const normals = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => normalizeCompanyJob({ jobNo: `N${offset + i + 1}`, jobName: `一般${offset + i + 1}` }));
const tops = (n) =>
  Array.from({ length: n }, (_, i) => normalizeCompanyJob({ jobNo: `T${i + 1}`, jobName: `置頂${i + 1}` }));

test("mergeCompanyJobLists: 置頂不佔名額 —— 3置頂+20一般/limit20 → 23筆，尾端不被砍", () => {
  const jobs = mergeCompanyJobLists(tops(3), normals(20), 20, 1);
  assert.equal(jobs.length, 23);
  assert.equal(jobs[22].jobId, "N20"); // 上一版會砍掉 N18~N20，這條就是防守它
});

test("mergeCompanyJobLists: 置頂標 pinned:true，一般職缺不帶 pinned", () => {
  const jobs = mergeCompanyJobLists(tops(3), normals(20), 20, 1);
  assert.equal(jobs[0].pinned, true);
  assert.equal(jobs[2].pinned, true);
  assert.equal(jobs[3].pinned, undefined);
});

test("mergeCompanyJobLists: page>1 不重複回置頂", () => {
  const jobs = mergeCompanyJobLists(tops(3), normals(20), 20, 2);
  assert.equal(jobs.length, 20);
  assert.ok(jobs.every((j) => !j.pinned));
  assert.equal(jobs[0].jobId, "N1");
});

test("mergeCompanyJobLists: limit 只約束一般職缺 —— limit10 → 3置頂+10一般", () => {
  const jobs = mergeCompanyJobLists(tops(3), normals(20), 10, 1);
  assert.equal(jobs.length, 13);
  assert.equal(jobs[12].jobId, "N10");
});

test("mergeCompanyJobLists: 無置頂的公司行為不變", () => {
  const jobs = mergeCompanyJobLists([], normals(20), 20, 1);
  assert.equal(jobs.length, 20);
  assert.ok(jobs.every((j) => !j.pinned));
  assert.equal(jobs[0].jobId, "N1");
  assert.equal(jobs[19].jobId, "N20");
});
