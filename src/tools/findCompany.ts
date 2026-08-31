/**
 * find_company tool 的定義與註冊。
 * 名稱 → 公司名片（companyId 可直接餵 get_company_jobs）。
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findCompany } from "../api/job104.js";

export function registerFindCompany(server: McpServer): void {
  server.registerTool(
    "find_company",
    {
      title: "用名稱找 104 公司",
      description:
        "用公司名稱找 104 上的公司，回傳公司名片：companyId（公司代碼，可直接餵給 get_company_jobs）、全名、公司頁網址、產業、地區、員工數、資本額、在徵職缺數。" +
        "比對是模糊的：英文別名（如 MediaTek）也找得到中文本尊，但 total 含「簡介提及」的公司會偏大。" +
        "唯一命中或名稱完全相符 → 回單一 company；多家符合 → 回 candidates 候選清單，此時請向使用者確認是哪一家（用產業/地區/在徵職缺數分辨），不要自行猜選。" +
        "「某公司有沒有某類職缺」的標準流程：find_company 拿 companyId → get_company_jobs 帶 keyword。",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe("公司名稱 —— 全名、常用簡稱或英文名皆可，如 '聯發科'、'台積電'、'MediaTek'"),
      },
    },
    async ({ name }) => {
      try {
        const result = await findCompany(name);
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
              text: `找公司失敗：${message}。104 可能改版或被 Cloudflare 阻擋，稍後再試。`,
            },
          ],
        };
      }
    },
  );
}
