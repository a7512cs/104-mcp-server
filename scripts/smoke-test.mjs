/**
 * 煙霧測試：手動發 JSON-RPC 訊息給 server，驗證整條路走得通。
 * 用法：node scripts/smoke-test.mjs
 */
import { spawn } from "node:child_process";

const child = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });

const requests = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "smoke-test", version: "1.0.0" },
  }},
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "search_jobs",
      arguments: { keyword: "Rust 工程師", area: "新竹市", limit: 2 },
  }},
];

for (const req of requests) child.stdin.write(JSON.stringify(req) + "\n");

let out = "";
child.stdout.on("data", (d) => {
  out += d.toString();
  // 收到 3 個帶 id 的回應就收工
  if (out.split("\n").filter((l) => l.includes('"id"')).length >= 3) {
    console.log("--- server responses (stdout) ---");
    for (const line of out.trim().split("\n")) {
      const msg = JSON.parse(line);
      console.log(`id=${msg.id}`, JSON.stringify(msg.result ?? msg.error).slice(0, 400));
    }
    child.kill();
    process.exit(0);
  }
});
child.stderr.on("data", (d) => process.stderr.write(`  (stderr) ${d}`));
