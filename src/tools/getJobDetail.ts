/**
 * get_job_detail tool 的定義與註冊。
 * 拿 search_jobs 回傳的職缺網址（或代碼），取得完整詳情。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getJobDetail } from "../api/job104.js";

export function registerGetJobDetail(server: McpServer): void {
  server.registerTool(
    "get_job_detail",
    {
      title: "取得 104 職缺詳情",
      description:
        "取得單筆 104 職缺的完整詳情：完整職務說明、薪資、地點、學經歷要求、需求技能、語言能力、福利、產業別。傳入 search_jobs 結果中的職缺網址（url 欄位）。",
      inputSchema: {
        jobUrlOrId: z
          .string()
          .min(1)
          .describe(
            "職缺網址或代碼，例如 'https://www.104.com.tw/job/7uqyj' 或 '7uqyj'（用 search_jobs 回傳的 url）",
          ),
      },
    },
    async ({ jobUrlOrId }) => {
      try {
        const detail = await getJobDetail(jobUrlOrId);
        return {
          content: [{ type: "text", text: JSON.stringify(detail, null, 2) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `取得職缺詳情失敗：${message}。104 可能改版或被 Cloudflare 阻擋，稍後再試。`,
            },
          ],
        };
      }
    },
  );
}
