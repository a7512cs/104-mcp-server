/**
 * search_jobs tool 的定義與註冊。
 * 只負責：宣告參數 schema、呼叫抓取層、把結果整理成給模型看的格式。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { searchJobs } from "../api/job104.js";
import { CONFIG } from "../config.js";

export function registerSearchJobs(server: McpServer): void {
  server.registerTool(
    "search_jobs",
    {
      title: "搜尋 104 職缺",
      description:
        "依關鍵字與篩選條件搜尋台灣 104 人力銀行的即時職缺，回傳職稱、公司、地區、薪資、需求技能與職缺網址。支援地區、薪資下限、職類、遠端、全/兼職、年資篩選，以及分頁。" +
        "若 area 同名多處（如「信義區」有台北市與基隆市兩個），不會直接搜尋，改回傳 ambiguousArea 候選清單 —— 此時請向使用者確認是哪一個，再用完整名稱（如「台北市信義區」）重新搜尋。" +
        "limit 只數一般職缺：廣告位（featured=true）另計、不佔名額。要完整翻頁請用 limit=20（上游每頁固定 20 筆一般職缺）；跨頁彙整時用 jobId 去重（最新排序下新缺插入會使分頁窗口飄移）。" +
        "keyword 適合職務/技能詞；輸入公司名稱時 104 不執行搜尋，本工具會回 companyKeyword 提示 —— 此時請改用 find_company 找到公司，再用 get_company_jobs 取得該公司職缺。",
      inputSchema: {
        keyword: z.string().min(1).describe("職務關鍵字，例如 'Rust 工程師'"),
        area: z
          .string()
          .optional()
          .describe("工作地區名稱，例如 '台北市'、'新竹'（會解析成 104 官方地區代碼查詢）"),
        salaryMin: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("月薪下限（新台幣），例如 60000。薪資明確低於此值的濾掉；面議預設保留"),
        excludeNegotiable: z
          .boolean()
          .optional()
          .describe("排除「面議」（沒寫薪資）的職缺，預設 false。想只看有明確薪資時設 true"),
        excludeFeatured: z
          .boolean()
          .optional()
          .describe(
            "排除 104 付費推廣/廣告職缺（結果中 featured=true 的），預設 false。這些會被 104 硬塞在最前面、常不符合搜尋條件；想只看自然結果時設 true",
          ),
        jobCategory: z
          .string()
          .optional()
          .describe("職務類別名稱，例如 '軟體工程師'、'行銷企劃'（會解析成 104 官方職類代碼查詢）"),
        remote: z
          .enum(["full", "partial", "any"])
          .optional()
          .describe("遠端工作：full 完全遠端 / partial 部分遠端 / any 兩者皆可"),
        jobType: z
          .enum(["fulltime", "parttime"])
          .optional()
          .describe("工作性質：fulltime 全職 / parttime 兼職"),
        experience: z
          .enum(["under-1y", "1-3y", "3-5y", "5-10y", "over-10y"])
          .optional()
          .describe("需求年資級距：under-1y(1年以下)/1-3y/3-5y/5-10y/over-10y(10年以上)"),
        sort: z
          .enum(["newest", "salary"])
          .optional()
          .describe(
            "排序：newest 最新更新在前（找新開職缺/掃描擴編用，建議搭配 excludeFeatured=true，否則廣告位仍會無視排序卡在最前面）/ salary 待遇由高到低。不給則用 104 預設的相關性排序",
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("第幾頁（每頁 20 筆），預設 1。想看更多職缺就往後翻頁"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CONFIG.maxLimit)
          .default(5)
          .describe(
            `一般職缺的回傳筆數上限，最多 ${CONFIG.maxLimit}，預設 5。廣告位（featured=true）另計、不佔名額；要完整翻頁請用 ${CONFIG.maxLimit}`,
          ),
      },
    },
    async (args) => {
      try {
        const result = await searchJobs(args);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `搜尋 104 職缺失敗：${message}。104 可能改版或被 Cloudflare 阻擋，稍後再試。`,
            },
          ],
        };
      }
    },
  );
}
