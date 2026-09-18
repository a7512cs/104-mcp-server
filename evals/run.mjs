#!/usr/bin/env node
/**
 * job104 MCP tool-routing evals 執行器。
 * 對 golden.json 的每一句話，用 headless Claude Code 載入本 repo 的 dist/index.js，
 * 只取第一個非 ToolSearch 的 tool_use；PreToolUse hook 擋住執行，不打 104，比對期望 → 逐 case 通過/失敗 → 寫 evals/results/{label}.json。
 *
 *   node evals/run.mjs --label baseline --model sonnet --repeat 3
 *   node evals/run.mjs --only S01 --model haiku      # 單題除錯（多題用逗號：--only C01,C02,C03）
 *   node evals/run.mjs --dry-run                      # 只印指令，不呼叫模型
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildArgs, parseStreamJson, runClaude, BLOCK_SETTINGS } from "./lib/claude-runner.mjs";
import { listTools, schemaHash, SERVER_ENTRY } from "./lib/mcp-tools.mjs";
import { scoreCase, summarize } from "./lib/score.mjs";

const EVALS_DIR = fileURLToPath(new URL(".", import.meta.url));
const RESULTS_DIR = join(EVALS_DIR, "results");
/** harness 版本：評分定義或擋執行方式改了就 +1，compare.mjs 用它警告「兩份結果的 harness 不同」 */
const HARNESS_VERSION = 2;
const timestamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

const { values: opt } = parseArgs({
  options: {
    label: { type: "string", default: `run-${timestamp()}` },
    model: { type: "string", default: "sonnet" },
    repeat: { type: "string", default: "1" },
    only: { type: "string" }, // 單一或逗號分隔多個 case id，例如 C01,C02,C03
    golden: { type: "string", default: join(EVALS_DIR, "golden.json") },
    "dry-run": { type: "boolean", default: false },
  },
});
const repeat = Number.parseInt(opt.repeat, 10);
if (!Number.isInteger(repeat) || repeat < 1) throw new Error(`--repeat 要是正整數，收到 ${opt.repeat}`);

const golden = JSON.parse(readFileSync(opt.golden, "utf8"));
const onlyIds = opt.only ? new Set(opt.only.split(",").map((x) => x.trim()).filter(Boolean)) : null;
const cases = onlyIds ? golden.cases.filter((c) => onlyIds.has(c.id)) : golden.cases;
if (cases.length === 0) throw new Error(`找不到 case：${opt.only ?? "(golden 為空)"}`);

const tools = await listTools({ command: "node", args: [SERVER_ENTRY] });
const hash = schemaHash(tools);
console.log(`受測 schema：${tools.map((t) => t.name).join(", ")} · schemaHash ${hash}`);
console.log(`模型 ${opt.model} · ${cases.length} cases × ${repeat} 次 · label ${opt.label}\n`);

const sandbox = mkdtempSync(join(tmpdir(), "job104-evals-"));
const mcpConfigPath = join(sandbox, "mcp.json");
writeFileSync(
  mcpConfigPath,
  JSON.stringify({ mcpServers: { job104: { type: "stdio", command: "node", args: [SERVER_ENTRY] } } }),
);

const quote = (s) => (/[\s"]/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s);

async function runOnce(c, runIndex) {
  const args = buildArgs({ utterance: c.utterance, model: opt.model, mcpConfigPath });
  if (opt["dry-run"]) {
    console.log(`  $ claude ${args.map(quote).join(" ")}`);
    return null;
  }
  const { stdout, stderr } = await runClaude({ args, cwd: sandbox });
  const rawDir = join(RESULTS_DIR, "raw", opt.label);
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, `${c.id}-${runIndex + 1}.jsonl`), stdout); // 原始事件流：失敗時回來看模型到底做了什麼
  const parsed = parseStreamJson(stdout);
  if (parsed.numEvents === 0) {
    throw new Error(`claude 沒有輸出任何事件。stderr：${stderr.slice(0, 500)}`);
  }
  const score = parsed.error
    ? { id: c.id, pass: false, toolPass: false, checks: [], reason: `執行錯誤：${parsed.error}` }
    : scoreCase(c, parsed.toolCall);
  if (parsed.toolCall && !parsed.blocked) {
    console.warn(`⚠️ ${c.id}：tool call 沒被 hook 擋下，可能真的打了 104。檢查 block-tools.settings.json。`);
  }
  const call = parsed.toolCall ? `${parsed.toolCall.name} ${JSON.stringify(parsed.toolCall.input)}` : "(無 tool call)";
  console.log(`${score.pass ? "✅" : "❌"} ${c.id} [${c.category}] ${call}${score.pass ? "" : `\n     ↳ ${score.reason}`}`);
  if (!parsed.toolCall && parsed.finalText) console.log(`     ↳ 模型回答：${parsed.finalText.slice(0, 160).replace(/\n/g, " ")}`);
  return {
    toolCall: parsed.toolCall, score, blocked: parsed.blocked, toolSearchQueries: parsed.toolSearchQueries,
    toolSequence: parsed.toolSequence, finalText: parsed.finalText,
    terminalReason: parsed.terminalReason, costUsd: parsed.costUsd, durationMs: parsed.durationMs, error: parsed.error,
  };
}

const caseResults = [];
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < repeat; i += 1) {
    const r = await runOnce(c, i);
    if (r) runs.push(r);
  }
  const passRate = runs.length ? runs.filter((r) => r.score.pass).length / runs.length : 0;
  caseResults.push({ id: c.id, category: c.category, utterance: c.utterance, expect: c.expect, runs, passRate });
}

if (opt["dry-run"]) {
  console.log(`\n（dry-run：以上 ${cases.length * repeat} 條指令未執行）`);
  process.exit(0);
}

const summary = summarize(caseResults);
const totalCost = caseResults.flatMap((c) => c.runs).reduce((s, r) => s + (r.costUsd ?? 0), 0);
mkdirSync(RESULTS_DIR, { recursive: true });
const outPath = join(RESULTS_DIR, `${opt.label}.json`);
writeFileSync(
  outPath,
  JSON.stringify(
    {
      label: opt.label, createdAt: new Date().toISOString(), harnessVersion: HARNESS_VERSION, goldenVersion: golden.version, model: opt.model, repeat, schemaHash: hash,
      tools: tools.map((t) => ({ name: t.name, descriptionChars: t.description.length })),
      sampleCommand: `claude ${buildArgs({ utterance: "<utterance>", model: opt.model, mcpConfigPath: "<mcp.json>" }).map((a) => (a === BLOCK_SETTINGS ? "<block-settings.json>" : a)).map(quote).join(" ")}`,
      summary, cases: caseResults,
    },
    null,
    2,
  ),
);

console.log(`\n==== ${opt.label} · schemaHash ${hash} · 模型 ${opt.model} ====`);
console.log(`全部通過的 case：${summary.passedAll}/${summary.total}（${(100 * summary.passedAll / summary.total).toFixed(0)}%） · 平均通過率 ${(100 * summary.meanPassRate).toFixed(1)}%`);
for (const [cat, v] of Object.entries(summary.byCategory)) {
  console.log(`  ${cat.padEnd(20)} ${v.passedAll}/${v.total}`);
}
console.log(`成本約 $${totalCost.toFixed(3)} · 結果 → ${outPath}`);
