/**
 * 直接對 MCP server 講協議（stdio、每行一個 JSON-RPC），拿 tools/list。
 * 用途：把「受測的到底是哪一版 description/schema」寫進結果檔（schemaHash）。
 * 沒有 hash 的 A/B 比較是不可信的 —— 你不知道兩次跑的是不是同一版。
 *
 *   node evals/lib/mcp-tools.mjs      # 印出 tool 名稱、description 長度、hash
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const LIST_TIMEOUT_MS = 15_000;
const PROTOCOL_VERSION = "2025-06-18";

export function listTools({ command, args }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const send = (msg) => child.stdin.write(JSON.stringify(msg) + "\n");
    const timer = setTimeout(() => { child.kill(); reject(new Error("tools/list 逾時")); }, LIST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          send({ jsonrpc: "2.0", method: "notifications/initialized" });
          send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
        } else if (msg.id === 2) {
          clearTimeout(timer);
          child.kill();
          if (msg.error) reject(new Error(`tools/list 失敗：${JSON.stringify(msg.error)}`));
          else resolve(msg.result.tools);
        }
      }
    });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });

    send({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "job104-evals", version: "0.1.0" } },
    });
  });
}

/** 只對 name/description/inputSchema 取 hash，排序後算，跟 server 回傳順序無關 */
export function schemaHash(tools) {
  const canonical = [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}

export const SERVER_ENTRY = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tools = await listTools({ command: "node", args: [SERVER_ENTRY] });
  for (const t of tools) {
    console.log(`${t.name.padEnd(18)} description ${String(t.description.length).padStart(4)} 字 · 參數 ${Object.keys(t.inputSchema?.properties ?? {}).join(", ")}`);
  }
  console.log(`schemaHash ${schemaHash(tools)}`);
}
