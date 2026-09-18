import { test } from "node:test";
import assert from "node:assert/strict";
import { checkArg, scoreCase, summarize } from "../evals/lib/score.mjs";
import { parseStreamJson, buildArgs } from "../evals/lib/claude-runner.mjs";
import { schemaHash } from "../evals/lib/mcp-tools.mjs";
import { BLOCK_SETTINGS } from "../evals/lib/claude-runner.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const CASE = {
  id: "F09", category: "search-filter", utterance: "新竹 DevOps，月薪 8 萬以上、不要面議",
  expect: { tool: "search_jobs", args: [
    { arg: "keyword", contains: "DevOps" },
    { arg: "area", contains: "新竹" },
    { arg: "salaryMin", equals: 80000 },
    { arg: "excludeNegotiable", equals: true },
    { arg: "sort", absent: true },
  ] },
};

test("checkArg equals：數字與字串寬鬆相等（模型可能填 \"80000\"）", () => {
  assert.equal(checkArg({ salaryMin: "80000" }, { arg: "salaryMin", equals: 80000 }).pass, true);
  assert.equal(checkArg({ salaryMin: 60000 }, { arg: "salaryMin", equals: 80000 }).pass, false);
  assert.equal(checkArg({}, { arg: "salaryMin", equals: 80000 }).pass, false); // 沒填 ≠ 相等
});

test("checkArg contains：不分大小寫、子字串即可（'devops 工程師' 含 'DevOps'）", () => {
  assert.equal(checkArg({ keyword: "devops 工程師" }, { arg: "keyword", contains: "DevOps" }).pass, true);
  assert.equal(checkArg({ keyword: "SRE" }, { arg: "keyword", contains: "DevOps" }).pass, false);
  assert.equal(checkArg({ keyword: 123 }, { arg: "keyword", contains: "1" }).pass, false); // 非字串不算
});

test("checkArg absent：抓模型自己加條件（使用者沒說薪資卻填了 salaryMin）", () => {
  assert.equal(checkArg({}, { arg: "salaryMin", absent: true }).pass, true);
  assert.equal(checkArg({ salaryMin: 50000 }, { arg: "salaryMin", absent: true }).pass, false);
});

test("checkArg notEquals：不填或填 false 都過，填 true 才錯（不填 = 預設 false，行為相同不算錯）", () => {
  assert.equal(checkArg({}, { arg: "excludeFeatured", notEquals: true }).pass, true);
  assert.equal(checkArg({ excludeFeatured: false }, { arg: "excludeFeatured", notEquals: true }).pass, true);
  assert.equal(checkArg({ excludeFeatured: true }, { arg: "excludeFeatured", notEquals: true }).pass, false);
});

test("checkArg 未知型別要 throw，不能靜默當通過", () => {
  assert.throws(() => checkArg({}, { arg: "x", regex: ".*" }), /未知的 check 型別/);
});

test("scoreCase：沒有 tool call → 失敗，理由講清楚", () => {
  const r = scoreCase(CASE, null);
  assert.equal(r.pass, false);
  assert.match(r.reason, /沒有呼叫任何 tool/);
});

test("scoreCase：tool 選錯 → 失敗，不再看參數", () => {
  const r = scoreCase(CASE, { name: "find_company", input: { name: "DevOps" } });
  assert.equal(r.pass, false);
  assert.equal(r.toolPass, false);
  assert.match(r.reason, /期望 search_jobs，實際 find_company/);
});

test("scoreCase：tool 對但一個參數錯 → 失敗，理由指出哪個參數", () => {
  const r = scoreCase(CASE, { name: "search_jobs", input: { keyword: "DevOps", area: "新竹市", salaryMin: 80000 } });
  assert.equal(r.pass, false);
  assert.equal(r.toolPass, true);
  assert.match(r.reason, /excludeNegotiable 期望 equals true，實際 \(未填\)/);
});

test("scoreCase：全對 → 通過", () => {
  const r = scoreCase(CASE, { name: "search_jobs", input: { keyword: "DevOps", area: "新竹", salaryMin: 80000, excludeNegotiable: true } });
  assert.equal(r.pass, true);
  assert.equal(r.reason, "通過");
});

test("summarize：passedAll 只算每次都過的 case；meanPassRate 看穩定度", () => {
  const s = summarize([
    { id: "A", category: "x", passRate: 1 },
    { id: "B", category: "x", passRate: 2 / 3 },
    { id: "C", category: "y", passRate: 0 },
  ]);
  assert.equal(s.total, 3);
  assert.equal(s.passedAll, 1);
  assert.ok(Math.abs(s.meanPassRate - 5 / 9) < 1e-9);
  assert.deepEqual(s.byCategory, { x: { total: 2, passedAll: 1 }, y: { total: 1, passedAll: 0 } });
});

test("parseStreamJson：跳過 ToolSearch，取第一個真正的 tool_use；去前綴；讀 denials 判定 blocked", () => {
  const lines = [
    JSON.stringify({ type: "system", subtype: "init", tools: [] }),
    JSON.stringify({ type: "assistant", message: { content: [
      { type: "text", text: "先載入工具" },
      { type: "tool_use", id: "t0", name: "ToolSearch", input: { query: "select:mcp__job104__search_jobs", max_results: 1 } },
    ] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t0", content: [] }] } }),
    JSON.stringify({ type: "assistant", message: { content: [
      { type: "tool_use", id: "t1", name: "mcp__job104__search_jobs", input: { keyword: "DevOps", area: "新竹", limit: 20 } },
    ] } }),
    "not json line should be ignored",
    JSON.stringify({ type: "result", is_error: false, terminal_reason: "completed", total_cost_usd: 0.0346, duration_ms: 14179,
      permission_denials: [{ tool_name: "mcp__job104__search_jobs", tool_use_id: "t1", tool_input: { keyword: "DevOps", area: "新竹", limit: 20 } }] }),
  ].join("\n");
  const p = parseStreamJson(lines);
  assert.deepEqual(p.toolCall, { rawName: "mcp__job104__search_jobs", name: "search_jobs", input: { keyword: "DevOps", area: "新竹", limit: 20 } });
  assert.deepEqual(p.toolSearchQueries, ["select:mcp__job104__search_jobs"]);
  assert.deepEqual(p.toolSequence, ["ToolSearch", "search_jobs"]);
  assert.equal(p.finalText, "先載入工具");
  assert.equal(p.blocked, true);
  assert.equal(p.error, null);
  assert.equal(p.costUsd, 0.0346);
  assert.equal(p.durationMs, 14179);
});

test("parseStreamJson：只有 ToolSearch 就撞到 max_turns → 無 tool call、error 帶 terminal_reason", () => {
  const lines = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t0", name: "ToolSearch", input: { query: "select:x" } }] } }),
    JSON.stringify({ type: "result", is_error: true, terminal_reason: "max_turns", permission_denials: [] }),
  ].join("\n");
  const p = parseStreamJson(lines);
  assert.equal(p.toolCall, null);
  assert.equal(p.blocked, false);
  assert.match(p.error, /max_turns/);
});

test("parseStreamJson：有 tool call 時 result.is_error 不算執行錯誤（max_turns 是預期的）", () => {
  const lines = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__job104__find_company", input: { name: "聯發科" } }] } }),
    JSON.stringify({ type: "result", is_error: true, terminal_reason: "max_turns", permission_denials: [{ tool_name: "mcp__job104__find_company", tool_input: { name: "聯發科" } }] }),
  ].join("\n");
  const p = parseStreamJson(lines);
  assert.equal(p.toolCall.name, "find_company");
  assert.equal(p.error, null);
  assert.equal(p.blocked, true);
});

test("parseStreamJson：stream 裡沒 tool_use 但 denials 有 → 用 denials 當第二來源", () => {
  const p = parseStreamJson(JSON.stringify({ type: "result", is_error: false,
    permission_denials: [{ tool_name: "mcp__job104__get_job_detail", tool_input: { jobUrlOrId: "7bsyk" } }] }));
  assert.deepEqual(p.toolCall, { rawName: "mcp__job104__get_job_detail", name: "get_job_detail", input: { jobUrlOrId: "7bsyk" } });
  assert.equal(p.blocked, true);
});

test("parseStreamJson：result.is_error 且無任何 tool call → error 帶出訊息（例如 OAuth 過期）", () => {
  const p = parseStreamJson(JSON.stringify({ type: "result", is_error: true, result: "Failed to authenticate: OAuth session expired" }));
  assert.equal(p.toolCall, null);
  assert.match(p.error, /OAuth/);
});

test("buildArgs：max-turns 4（ToolSearch 可能兩次）、鎖定 MCP config、帶擋執行的 hook settings", () => {
  const args = buildArgs({ utterance: "hi", model: "sonnet", mcpConfigPath: "/tmp/mcp.json" });
  assert.deepEqual(args.slice(0, 2), ["-p", "hi"]);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--max-turns") + 1], "4");
  assert.match(args[args.indexOf("--settings") + 1], /block-all-but-toolsearch\.settings\.json$/);
});

test("PreToolUse hook：ToolSearch 放行（exit 0），其他所有 tool 擋下（exit 2）—— 含 Bash，不只 mcp__job104__*", () => {
  const cmd = JSON.parse(readFileSync(BLOCK_SETTINGS, "utf8")).hooks.PreToolUse[0].hooks[0].command;
  const run = (toolName) => spawnSync("sh", ["-c", cmd], { input: JSON.stringify({ tool_name: toolName, tool_input: {} }) }).status;
  assert.equal(run("ToolSearch"), 0);
  assert.equal(run("mcp__job104__search_jobs"), 2);
  assert.equal(run("Bash"), 2);
  assert.equal(run("WebFetch"), 2);
});

test("parseStreamJson：先 Bash 再 search_jobs → 第一個動作是 Bash，嚴格評分算錯；toolSequence 保留全貌", () => {
  const lines = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t0", name: "ToolSearch", input: { query: "select:x" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "echo 搜尋中" } }] } }),
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "mcp__job104__search_jobs", input: { keyword: "DevOps" } }] } }),
    JSON.stringify({ type: "result", is_error: false, permission_denials: [{ tool_name: "Bash", tool_input: {} }, { tool_name: "mcp__job104__search_jobs", tool_input: {} }] }),
  ].join("\n");
  const p = parseStreamJson(lines);
  assert.equal(p.toolCall.name, "Bash");
  assert.deepEqual(p.toolSequence, ["ToolSearch", "Bash", "search_jobs"]);
  assert.equal(p.blocked, true);
});

test("schemaHash：與 tool 順序無關；description 改一個字就變", () => {
  const a = { name: "a", description: "x", inputSchema: {} };
  const b = { name: "b", description: "y", inputSchema: {} };
  assert.equal(schemaHash([a, b]), schemaHash([b, a]));
  assert.notEqual(schemaHash([a, b]), schemaHash([{ ...a, description: "x." }, b]));
});
