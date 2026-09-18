#!/usr/bin/env node
/**
 * 用現行 golden 重新評分一份既有結果檔，不重跑模型（$0）。
 * 結果檔存了每次模型實際填的 toolCall，所以 golden 升版（換考卷）後可以直接重改舊考卷。
 *
 *   node evals/rescore.mjs evals/results/baseline-sonnet-x1.json
 *   node evals/rescore.mjs evals/results/baseline-sonnet-x1.json --write     # 另存 {label}-rescored-v{N}.json
 *   node evals/rescore.mjs <results.json> --golden path/to/other-golden.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, summarize } from "./lib/score.mjs";

const [, , resultPath, ...flags] = process.argv;
if (!resultPath) throw new Error("用法：node evals/rescore.mjs <results.json> [--golden <path>] [--write]");
const goldenIdx = flags.indexOf("--golden");
const goldenPath = goldenIdx >= 0 ? flags[goldenIdx + 1] : fileURLToPath(new URL("./golden.json", import.meta.url));
const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
const byId = new Map(golden.cases.map((c) => [c.id, c]));
const r = JSON.parse(readFileSync(resultPath, "utf8"));

const cases = r.cases.flatMap((c) => {
  const def = byId.get(c.id);
  if (!def) {
    console.log(`- ${c.id} 不在 golden v${golden.version}，略過`);
    return [];
  }
  // 執行錯誤（例如 OAuth 過期）維持原判；其餘用新 golden 重評模型當時填的 toolCall
  const runs = c.runs.map((run) => ({ ...run, score: run.error ? run.score : scoreCase(def, run.toolCall) }));
  const passRate = runs.length ? runs.filter((x) => x.score.pass).length / runs.length : 0;
  return [{ ...c, expect: def.expect, runs, passRate }];
});
const summary = summarize(cases);

console.log(`重評 ${r.label}（schema ${r.schemaHash} · 原 golden v${r.goldenVersion ?? 1}）→ golden v${golden.version}\n`);
for (const c of cases) {
  const firstFail = c.runs.find((x) => !x.score.pass);
  console.log(`${c.passRate === 1 ? "✅" : "❌"} ${c.id}${firstFail ? `  ↳ ${firstFail.score.reason}` : ""}`);
}
console.log(`\n原分數 ${r.summary.passedAll}/${r.summary.total} → 重評 ${summary.passedAll}/${summary.total}（平均 ${(100 * summary.meanPassRate).toFixed(1)}%）`);

if (flags.includes("--write")) {
  const label = `${r.label}-rescored-v${golden.version}`;
  const out = join(dirname(resultPath), `${label}.json`);
  writeFileSync(out, JSON.stringify({ ...r, label, rescoredFrom: basename(resultPath), goldenVersion: golden.version, summary, cases }, null, 2));
  console.log(`→ ${out}`);
}
