/**
 * 從應徵分析的 percent 反推確切應徵人數（純函式，無 I/O）。
 *
 * 104 自 2026-10-07 起把應徵分析的 total / count 一律回 0（登入也一樣），只留 percent。
 * 但 percent = round(count / total × 100, 2)，兩位小數等於把 count/total 洩漏出來：
 * 找出「每個 percent 都是某個 k/N 四捨五入結果」的 N，就是應徵人數。
 * 9/18 快照（當時 API 還回 total=24）只用 percent 推回來正好是 24。
 *
 * 限制：N 成立時 2N、3N 也一定成立 —— 只有 104 的人數區間能擋掉倍數。
 * 「30 人以上」沒有上限，倍數擋不掉，只能回最小候選。
 * 若 104 哪天把 percent 砍成整數，這招就失效（會出現大量候選）。
 */

/** 反推人數的搜尋上限 —— 104 熱門職缺兩週內應徵人數實測沒見過上千 */
const MAX_TOTAL = 5000;
/** 最多回幾個候選（最小的排第一） */
const MAX_CANDIDATES = 3;

export interface TotalBounds {
  readonly min: number;
  readonly max: number;
}

/** percent（兩位小數）是不是 k/n 四捨五入的結果；k 至少 1（0% 的項目不帶資訊，呼叫端已濾掉） */
function fitsPercent(percent: number, n: number): boolean {
  const k = Math.round((percent * n) / 100);
  if (k < 1 || k > n) return false;
  // 以「百分之一」為單位比較，容許 x.xx5 兩邊都算（104 的四捨五入方向沒驗證過）
  return Math.abs((k * 10000) / n - percent * 100) <= 0.5 + 1e-9;
}

/**
 * 回傳所有 percent 同時成立的人數候選（由小到大，最多 MAX_CANDIDATES 個）。
 * 給 bounds 就只找區間內的；沒有任何正的 percent → 空陣列（交給呼叫端判斷是 0 人還是資料被遮）。
 */
export function inferTotalCandidates(percents: readonly number[], bounds?: TotalBounds): number[] {
  const informative = percents.filter((p) => p > 0);
  if (informative.length === 0) return [];

  const lo = Math.max(1, bounds?.min ?? 1);
  const hi = Math.min(MAX_TOTAL, bounds?.max ?? MAX_TOTAL);
  const candidates: number[] = [];
  for (let n = lo; n <= hi && candidates.length < MAX_CANDIDATES; n++) {
    if (informative.every((p) => fitsPercent(p, n))) candidates.push(n);
  }
  return candidates;
}
