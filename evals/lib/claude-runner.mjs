/**
 * 用 headless Claude Code（claude -p）當「受測 agent」。
 *
 * 實測（2026-09-17，Claude Code 2.1.251）得到的三個事實，決定了這支的寫法：
 * 1. MCP tool 是延遲載入的：模型要先呼叫 ToolSearch 載入 schema，才會呼叫 mcp__job104__*。
 *    ToolSearch 可能連呼叫兩次 → --max-turns 放寬到 4，評分只看「第一個不是 ToolSearch 的 tool_use」。
 * 2. 只靠 --max-turns 擋不住執行（回合到了才停，中間的 tool 照跑）。
 *    改用 PreToolUse hook（block-all-but-toolsearch.settings.json，exit 2）攔下 ToolSearch 以外的所有 tool。
 *    只擋 mcp__job104__* 不夠：haiku 曾改用 Bash 直接 curl 104（baseline-haiku-x1 的 C01），那也不能放行。
 * 3. 被攔下的呼叫會出現在 result.permission_denials，含結構化 tool_input，可當第二來源。
 *
 * 評分定義（嚴格）：第一個非 ToolSearch 的 tool_use 就是「agent 的第一個動作」，選錯就算錯，
 * 即使它後來補呼叫了正確的 tool。toolSequence 保留整段序列供診斷。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const TOOL_PREFIX = "mcp__job104__";
export const TOOL_SEARCH = "ToolSearch";
export const BLOCK_SETTINGS = fileURLToPath(new URL("../block-all-but-toolsearch.settings.json", import.meta.url));
const CASE_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TURNS = 4;
const FINAL_TEXT_MAX = 300;

export function buildArgs({ utterance, model, mcpConfigPath, maxTurns = DEFAULT_MAX_TURNS }) {
  return [
    "-p", utterance,
    "--model", model,
    "--max-turns", String(maxTurns),
    "--output-format", "stream-json",
    "--verbose",
    "--mcp-config", mcpConfigPath,
    "--strict-mcp-config",           // 只載入我們指定的 server
    "--setting-sources", "project",  // 不載 user 層設定與 CLAUDE.md（實測：模型改用簡體回答 = 未載入）
    "--settings", BLOCK_SETTINGS,    // PreToolUse hook：ToolSearch 以外全部擋下，只記錄不執行
  ];
}

const stripPrefix = (name) => (name.startsWith(TOOL_PREFIX) ? name.slice(TOOL_PREFIX.length) : name);
const toToolCall = (name, input) => ({ rawName: name, name: stripPrefix(name), input: input ?? {} });

export function parseStreamJson(text) {
  const events = text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  const toolUses = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => e.message?.content ?? [])
    .filter((b) => b.type === "tool_use");
  const toolSearchQueries = toolUses.filter((b) => b.name === TOOL_SEARCH).map((b) => b.input?.query ?? "");
  const toolSequence = toolUses.map((b) => stripPrefix(b.name));
  const firstReal = toolUses.find((b) => b.name !== TOOL_SEARCH);
  const texts = events
    .filter((e) => e.type === "assistant")
    .flatMap((e) => e.message?.content ?? [])
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text);
  const finalText = texts.length ? texts[texts.length - 1].slice(0, FINAL_TEXT_MAX) : "";
  const result = events.find((e) => e.type === "result") ?? null;
  const denials = result?.permission_denials ?? [];

  const toolCall = firstReal
    ? toToolCall(firstReal.name, firstReal.input)
    : denials[0]
      ? toToolCall(denials[0].tool_name, denials[0].tool_input)
      : null;
  const blocked = denials.some((d) => d.tool_name === toolCall?.rawName);

  return {
    toolCall,
    blocked,
    toolSearchQueries,
    toolSequence,
    finalText,
    // 只有「完全沒抓到 tool call」且 result 說有錯，才算執行錯誤（例如 OAuth 過期）。
    // 有抓到 tool call 時，result.is_error（常是 max_turns）不影響評分。
    error: !toolCall && result?.is_error ? String(result.result ?? result.terminal_reason ?? "unknown") : null,
    terminalReason: result?.terminal_reason ?? null,
    costUsd: result?.total_cost_usd ?? null,
    durationMs: result?.duration_ms ?? null,
    numEvents: events.length,
  };
}

export function runClaude({ args, cwd }) {
  return new Promise((resolve, reject) => {
    const { CLAUDECODE, ...env } = process.env; // 允許從 Claude Code 內巢狀執行
    const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude 逾時 ${CASE_TIMEOUT_MS} ms`));
    }, CASE_TIMEOUT_MS);
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve({ stdout, stderr }); });
  });
}
