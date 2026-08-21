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
