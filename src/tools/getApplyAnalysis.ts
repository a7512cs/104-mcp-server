/**
 * get_apply_analysis tool 的定義與註冊。
 * 拿職缺網址（或代碼），回傳兩週內不重複應徵人數與應徵者組成。
 * ⚠️ 使用者定的規矩：只在明確要求應徵者資料時才用，不主動、不批次 —— 寫在 description 給模型看。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getApplyAnalysis } from "../api/job104.js";

export function registerGetApplyAnalysis(server: McpServer): void {
  server.registerTool(
    "get_apply_analysis",
    {
      title: "取得 104 職缺的應徵者分析",
      description:
        "取得單筆 104 職缺的應徵者分析：兩週內不重複應徵人數（total，真實數字 —— 職缺頁與 search_jobs 的 applyRange 只有區間）與應徵者組成：性別、學歷、年齡、年資、語言（含程度）、科系、技能、證照。" +
        "⚠️ 只在使用者明確要求「這個職缺的應徵者／應徵人數／競爭狀況」時才呼叫；搜尋職缺、看職缺詳情、列公司職缺時不要主動呼叫，也不要為了順便比較競爭度而對多筆職缺批次呼叫。" +
        "科系／技能／證照只回前 10 名，count 加總不等於 total。資料由 104 每日更新一次（updateTime）。傳入 search_jobs / get_company_jobs 回傳的 url 或 jobId。",
      inputSchema: {
        jobUrlOrId: z
          .string()
          .min(1)
          .describe("職缺網址或代碼，例如 'https://www.104.com.tw/job/7bsyk' 或 '7bsyk'（跟 get_job_detail 相同）"),
      },
    },
    async ({ jobUrlOrId }) => {
      try {
        const result = await getApplyAnalysis(jobUrlOrId);
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
              text: `取得應徵分析失敗：${message}。104 可能改版或被 Cloudflare 阻擋，稍後再試。`,
            },
          ],
        };
      }
    },
  );
}
