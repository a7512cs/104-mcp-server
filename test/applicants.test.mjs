import { test } from "node:test";
import assert from "node:assert/strict";
import { inferTotalCandidates } from "../dist/applicants.js";

// 104 自 2026-10-07 起 total/count 恆為 0，只留兩位小數的 percent。
// percent = round(count / total * 100, 2)，所以「哪個 N 能讓每個 percent 都是 k/N 四捨五入」就是應徵人數。

test("inferTotalCandidates: 9/18 黃金案例 —— 當時 API 還回 total=24，只看 percent 要推回 24", () => {
  // 2026-09-18 快照的 percent（sex 以外）；當時的 total 是 24，這是唯一有真值可對的案例
  const percents = [62.5, 37.5, 20.83, 50, 12.5, 4.17, 12.5, 25, 37.5, 12.5, 25, 4.17, 41.67, 12.5, 45.83, 29.17, 25, 29.17, 20.83];
  assert.deepEqual(inferTotalCandidates(percents, { min: 11, max: 30 }), [24]);
});

test("inferTotalCandidates: 倍數一定也符合（N 行，2N 也行）—— 區間是唯一能擋掉倍數的東西", () => {
  const percents = [12.5, 37.5, 25, 50]; // 最小 N = 8
  assert.deepEqual(inferTotalCandidates(percents), [8, 16, 24]); // 沒區間：回最小的 3 個候選
  assert.deepEqual(inferTotalCandidates(percents, { min: 6, max: 10 }), [8]); // 6~10 人 → 只剩 8
  assert.deepEqual(inferTotalCandidates(percents, { min: 11, max: 30 }), [16, 24]); // 區間擋掉 8，留下區間內的
});

test("inferTotalCandidates: 30 人以上沒有上限 → 多個候選，最小的排第一", () => {
  const percents = [3.23, 6.45, 90.32]; // 1/31、2/31、28/31
  assert.deepEqual(inferTotalCandidates(percents, { min: 30, max: Infinity }), [31, 62, 93]);
});

test("inferTotalCandidates: 四捨五入邊界（x.xx5）兩邊都要接受，不能因為浮點誤差漏掉真值", () => {
  // 1/8 = 12.5、1/16 = 6.25、1/32 = 3.125 → 104 可能給 3.13 或 3.12
  assert.deepEqual(inferTotalCandidates([3.13, 96.88], { min: 30, max: 40 }), [32]);
  assert.deepEqual(inferTotalCandidates([3.12, 96.88], { min: 30, max: 40 }), [32]);
});

test("inferTotalCandidates: 0% 不算數（0 人的項目對任何 N 都成立），只有 0% → 沒有候選", () => {
  assert.deepEqual(inferTotalCandidates([0, 0, 0]), []);
  assert.deepEqual(inferTotalCandidates([]), []);
  assert.deepEqual(inferTotalCandidates([0, 50, 50, 0], { min: 1, max: 3 }), [2]);
});

test("inferTotalCandidates: 區間內沒有任何 N 同時滿足 → 空陣列，不硬湊一個區間外的值", () => {
  // 50% 要偶數、33.33% 要 3 的倍數 → 最小是 6；104 說 0~5 人 → 對不上就回空，交給上層標 unknown
  assert.deepEqual(inferTotalCandidates([50, 33.33, 16.67], { min: 1, max: 5 }), []);
  assert.deepEqual(inferTotalCandidates([50, 33.33, 16.67], { min: 6, max: 10 }), [6]);
});
