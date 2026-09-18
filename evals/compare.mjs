#!/usr/bin/env node
/**
 * 比較兩次 evals 結果（A = 基準、B = 候選），逐 case 印通過率變化，列出退步與進步。
 *
 *   node evals/compare.mjs evals/results/baseline.json evals/results/no-routing-hint.json
 */
import { readFileSync } from "node:fs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) throw new Error("用法：node evals/compare.mjs <A.json> <B.json>");
const A = JSON.parse(readFileSync(aPath, "utf8"));
const B = JSON.parse(readFileSync(bPath, "utf8"));

if (A.schemaHash === B.schemaHash) {
  console.log(`⚠️ 兩次 schemaHash 相同（${A.schemaHash}）：受測 description/schema 沒變，差異只反映模型隨機性。`);
}
if (A.model !== B.model) console.log(`⚠️ 模型不同：A=${A.model} B=${B.model}，比較不對等。`);
if ((A.goldenVersion ?? 1) !== (B.goldenVersion ?? 1)) console.log(`⚠️ golden set 版本不同：A=v${A.goldenVersion ?? 1} B=v${B.goldenVersion ?? 1}，題目不同不能直接比。`);
if ((A.harnessVersion ?? 1) !== (B.harnessVersion ?? 1)) console.log(`⚠️ harness 版本不同：A=v${A.harnessVersion ?? 1} B=v${B.harnessVersion ?? 1}，評分定義或擋執行方式可能不同。`);

const pct = (x) => `${(100 * x).toFixed(0).padStart(3)}%`;
const bById = new Map(B.cases.map((c) => [c.id, c]));
const regressions = [];
const improvements = [];

console.log(`\n${"case".padEnd(6)}${"類別".padEnd(20)}${"A".padStart(6)}${"B".padStart(6)}   說明`);
for (const a of A.cases) {
  const b = bById.get(a.id);
  if (!b) { console.log(`${a.id.padEnd(6)}${a.category.padEnd(20)}${pct(a.passRate).padStart(6)}     -   B 缺此 case`); continue; }
  const delta = b.passRate - a.passRate;
  const mark = delta < 0 ? "🔻" : delta > 0 ? "🔺" : "  ";
  const lastFail = b.runs.find((r) => !r.score.pass)?.score.reason ?? "";
  console.log(`${a.id.padEnd(6)}${a.category.padEnd(20)}${pct(a.passRate).padStart(6)}${pct(b.passRate).padStart(6)} ${mark} ${delta < 0 ? lastFail : ""}`);
  if (delta < 0) regressions.push(a.id);
  if (delta > 0) improvements.push(a.id);
}

console.log(`\nA ${A.label}（${A.schemaHash}）：${A.summary.passedAll}/${A.summary.total} 全過 · 平均 ${pct(A.summary.meanPassRate)}`);
console.log(`B ${B.label}（${B.schemaHash}）：${B.summary.passedAll}/${B.summary.total} 全過 · 平均 ${pct(B.summary.meanPassRate)}`);
console.log(`退步 ${regressions.length} 題 ${regressions.join(", ") || "-"} · 進步 ${improvements.length} 題 ${improvements.join(", ") || "-"}`);
