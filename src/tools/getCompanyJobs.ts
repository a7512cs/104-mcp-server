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
        "列出「某一家指定公司」在 104 上所有在徵的職缺（職稱、地區、薪資、學經歷要求、網址）。這不是關鍵字搜尋 —— 是拿一家已知公司去看它全部的缺。公司網址請用 search_jobs 或 get_job_detail 回傳的 companyUrl 欄位。可分頁。",
      inputSchema: {
        companyUrlOrId: z
          .string()
          .min(1)
          .describe(
            "公司網址或代碼（用 search_jobs / get_job_detail 回傳的 companyUrl），例如 'https://www.104.com.tw/company/1a2x6blghh' 或 '1a2x6blghh'",
          ),
        page: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("第幾頁（每頁 20 筆），預設 1"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(CONFIG.maxLimit)
          .default(10)
          .describe(`本頁回傳筆數上限，最多 ${CONFIG.maxLimit}，預設 10`),
      },
    },
    async ({ companyUrlOrId, page, limit }) => {
      try {
        const result = await getCompanyJobs({ companyUrlOrCode: companyUrlOrId, page, limit });
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
