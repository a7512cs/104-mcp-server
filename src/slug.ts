/**
 * 從 104 網址取出代碼的純函式（無相依，types/query 共用，避免重複 regex）。
 */

/**
 * 職缺 slug：吃得下完整網址或裸 slug。
 * 例：https://www.104.com.tw/job/7uqyj?foo=bar → 7uqyj；7uqyj → 7uqyj
 */
export function extractSlug(input: string): string {
  const match = input.match(/\/job\/([^/?#]+)/);
  return (match ? match[1] : input).trim();
}

/**
 * 公司代碼：吃得下完整公司網址或裸代碼。
 * 例：https://www.104.com.tw/company/1a2x6blghh → 1a2x6blghh
 */
export function extractCompanyCode(input: string): string {
  const match = input.match(/\/company\/([^/?#]+)/);
  return (match ? match[1] : input).trim();
}

/**
 * 職缺 slug（網址上的 base36，如 7bsyk）→ 104 內部十進位 jobNo（12308060）。
 * 應徵分析 API 只吃十進位。非 base36 的輸入直接出聲，不算出一個錯的號碼靜默送出。
 */
export function slugToJobNo(slug: string): number {
  const s = slug.trim();
  if (!/^[0-9a-z]+$/i.test(s)) {
    throw new Error(`職缺代碼「${slug}」不是合法的 104 職缺代碼（應為英數字，如 7bsyk）`);
  }
  const jobNo = parseInt(s, 36);
  if (!Number.isSafeInteger(jobNo)) throw new Error(`職缺代碼「${slug}」超出可轉換範圍`);
  return jobNo;
}
