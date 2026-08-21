#!/usr/bin/env node
/**
 * 104 MCP Server —— 進入點。
 * 只做組裝：建 server、掛 tool、接上 stdio、處理關閉。
 * 實際邏輯都在 tools/ 和 api/。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchJobs } from "./tools/searchJobs.js";
import { registerGetJobDetail } from "./tools/getJobDetail.js";
import { registerGetCompanyJobs } from "./tools/getCompanyJobs.js";
import { closeClient } from "./api/httpClient.js";

const log = (...args: unknown[]) => console.error("[104-mcp]", ...args);

const server = new McpServer({ name: "mcp-server-104", version: "0.1.0" });

registerSearchJobs(server);
registerGetJobDetail(server);
registerGetCompanyJobs(server);

/** 收到結束訊號時先關 client 子程序再退出，避免留下殭屍程序 */
function installShutdown() {
  const shutdown = async (signal: string) => {
    log(`received ${signal}, closing http client...`);
    await closeClient().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

async function main() {
  installShutdown();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server ready on stdio");
}

main().catch((err) => {
  log("fatal:", err);
  process.exit(1);
});
