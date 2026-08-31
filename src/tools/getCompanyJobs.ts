/**
 * get_company_jobs tool 的定義與註冊。
 * 拿公司網址（或代碼），列出該公司所有在徵職缺（分頁）。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCompanyJobs } from "../api/job104.js";
import { CONFIG } from "../config.js";

export function registerGetCompanyJobs(server: McpServer): void {
  server.registerTool(
    "get_company_jobs",
    {
      title: "列出某公司所有職缺",
      description:
        "列出「某一家指定公司」在 104 上在徵的職缺（職稱、地區、薪資、學經歷要求、網址），可分頁。公司用 find_company 回傳的 companyId，或 search_jobs / get_job_detail 回傳的 companyUrl。" +
        "帶 keyword 可在這家公司內搜職缺（比對職稱與 JD 內文，含「其他條件」欄 —— 「某公司有沒有 C++」這種問題用它，別自己翻頁過濾職稱）。⚠️ keyword 多字詞是 OR 不是 AND，要同時符合請分次搜再交集。" +
        "要完整翻頁請固定用同一個 limit（分頁窗口由 limit 檔位 20/50/100 決定，中途換會跳掉或重複）。置頂職缺（pinned=true）只在第 1 頁回、不佔 limit 名額；total 不含置頂。",
      inputSchema: {
        companyUrlOrId: z
          .string()
          .min(1)
          .describe(
            "公司網址或代碼（用 search_jobs / get_job_detail 回傳的 companyUrl），例如 'https://www.104.com.tw/company/1a2x6blghh' 或 '1a2x6blghh'",
          ),
        keyword: z
          .string()
          .optional()
          .describe(
            "在這家公司內搜職缺的關鍵字（比對職稱與 JD 內文）。例如 'C++'。多字詞是 OR，要 AND 請分次搜再交集",
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("第幾頁（窗口大小=limit 對應的檔位 20/50/100），預設 1。翻頁時 limit 要維持同一個值"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CONFIG.maxCompanyLimit)
          .default(10)
          .describe(
            `一般職缺的回傳筆數上限，最多 ${CONFIG.maxCompanyLimit}，預設 10。想一次拿完（如公司內搜 C++）用 ${CONFIG.maxCompanyLimit}；置頂職缺另計、不佔名額`,
          ),
      },
    },
    async ({ companyUrlOrId, keyword, page, limit }) => {
      try {
        const result = await getCompanyJobs({ companyUrlOrCode: companyUrlOrId, keyword, page, limit });
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
              text: `取得公司職缺失敗：${message}。104 可能改版或被 Cloudflare 阻擋，稍後再試。`,
            },
          ],
        };
      }
    },
  );
}
