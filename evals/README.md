# evals — 這個 MCP server 的 tool-routing 評測

**量什麼：** 給模型一句使用者的話，它「第一個 tool call」選對工具、填對參數了嗎。這是 tool description / inputSchema 直接影響的那一層 —— 改一句 description，跑一次就知道變好變壞。

**不量什麼：** 多輪行為（例如收到 `ambiguousArea` 後有沒有回頭問使用者）、最終回答品質（有沒有把 A 職缺的網址配到 B 職缺）。那些需要真的執行 tool 加 LLM-as-judge，是下一層。

## 跑

```bash
claude auth status                                   # 要 loggedIn: true
node evals/lib/mcp-tools.mjs                         # 看受測 schema 與 hash（不呼叫模型）
node evals/run.mjs --only S01 --model sonnet         # 單題煙霧測試（多題：--only C01,C02）
node evals/run.mjs --label baseline --model sonnet --repeat 3
```

改 description → `npm run build` → 再跑一次不同 `--label` → 比較：

```bash
node evals/compare.mjs evals/results/baseline.json evals/results/<新 label>.json
```

golden 升版後，舊結果不用重跑模型，直接用新考卷重改（$0）：

```bash
node evals/rescore.mjs evals/results/baseline.json
```

## 檔案

| 檔 | 做什麼 |
|---|---|
| `golden.json` | 23 個 case：一句話 + 期望的 tool 與參數 check |
| `run.mjs` | 逐 case 用 `claude -p --max-turns 4` 取第一個非 ToolSearch 的 tool_use，評分，寫 `results/{label}.json` |
| `compare.mjs` | 兩份結果逐 case 比，列退步 / 進步；schemaHash、模型、golden 版本、harness 版本不同都會警告 |
| `rescore.mjs` | 用現行 golden 重評一份既有結果（模型當時填的 toolCall 都存在結果檔裡） |
| `lib/score.mjs` | 純評分函式（`test/evals-score.test.mjs` 覆蓋） |
| `lib/claude-runner.mjs` | 組 claude 指令、解析 stream-json（跳過 ToolSearch、讀 permission_denials） |
| `lib/mcp-tools.mjs` | 對 server 講 MCP 協議拿 `tools/list`，算 `schemaHash`（結果檔的版本戳） |
| `block-all-but-toolsearch.settings.json` | PreToolUse hook：ToolSearch 以外的所有 tool 一律 exit 2。只記錄呼叫、不執行，所以 eval 不打 104、也不會跑模型寫的 Bash |
| `results/`（gitignored） | 每次執行的結果與 `raw/` 原始事件流，留在本機。支撐某個決定的數字寫進 commit message 和下面的紀錄表 |

## 檢查規則（golden.json 的 `args`）

| 規則 | 意思 | 用在哪 |
|---|---|---|
| `equals: v` | 值相等（80000 與 "80000" 視為相同） | 使用者明確要求的值：`salaryMin`、`sort`、`remote`… |
| `contains: s` | 字串包含，不分大小寫 | `keyword`、`area`、id/網址：模型措辭有變化空間 |
| `absent: true` | 不可以填 | 填任何值都會改變結果的參數（`sort`、`salaryMin`、`area`…），使用者沒說就不能填 |
| `notEquals: v` | 不可以是這個值；不填或其他值都過 | 「不填 = 預設值」的布林（`excludeFeatured`、`excludeNegotiable`）：填 false 與不填行為相同，不算錯 |
| `present: true` | 必須填，值不限 | 目前未用 |

判準對準「使用者感覺得到的差別」，不對準 JSON 長相。比行為更嚴的判準會製造假失敗。

## 為什麼是 max-turns 4 加 hook

這版 Claude Code 把 MCP tool 延遲載入：模型先呼叫 `ToolSearch` 拿 schema，才呼叫 `mcp__job104__*`，而且 ToolSearch 可能連呼叫兩次。`--max-turns` 只決定何時停，中間的 tool 照樣執行，所以擋執行要靠 hook。第一版只擋 `mcp__job104__*`，結果 haiku 改用 Bash `curl` 直接打 104；第二版改成 ToolSearch 以外全擋。被擋下的呼叫會進 `result.permission_denials`，參數結構完整，runner 拿它當第二來源。

## 評分定義

**嚴格：第一個非 ToolSearch 的 tool_use 就是 agent 的第一個動作。** 先 Bash `echo 搜尋中` 再呼叫 `search_jobs`，算錯。理由：production 裡每個多餘動作都是一個回合的 token 與延遲，而 Bash `curl`、自己寫腳本呼叫假 CLI 這類繞過工具的行為是危險訊號，不能被「後來有補對」洗掉。`toolSequence` 記錄整段序列，診斷時用。

## 判讀規則

- `--repeat 1` 的分數只能當煙霧測試。模型有隨機性，一個 case 翻面就是 5 分；要講「X → Y」至少 `--repeat 3`，看 `平均通過率` 與 `全部通過`。
- 兩份結果 `schemaHash` 相同 = 受測物沒變，分差全是雜訊。
- golden 從「使用者會怎麼講」寫，description 從「工具語意」寫。發現自己把 golden 的句子抄進 description，就是在 overfit。
- 全過的 golden 只能抓退步，量不到進步。要量改善，golden 裡要有現行模型會錯的題。

## 數字紀錄

一行一次有意義的執行。結果檔在本機 `results/`，重跑即可再得。

| 日期 | label | golden | schema | 模型 | 重複 | 分數 | 說明 |
|---|---|---|---|---|---|---|---|
| 2026-09-17 | baseline-haiku-x1 | v1 | a3f0a8cb147a | haiku | 1 | 8/20 | 12 題失敗在載入工具之前：改用 Bash/WebFetch，或把找工作當 out-of-scope |
| 2026-09-17 | baseline-sonnet-x1 | v1 | a3f0a8cb147a | sonnet | 1 | 20/20 | |
| 2026-09-17 | routing-baseline / ablation-no-routing-hint | v1 | a3f0a8cb147a → cf6fca2f3ff8 | sonnet | 3 | C01–C03 9/9 → 9/9 | 拔掉兩處 find_company 導引句零變化：延遲載入下路由靠 tool 名稱 |
| 2026-09-18 | s01-before / after-sort-fix | v2 | a3f0a8cb147a → 4378060a6414 | sonnet | 3 | S01 2/3 → 3/3 | sort/excludeFeatured 說明改為「只在使用者要求時填」 |
| 2026-09-18 | regression-sort-fix-f03-f09 | v2 | 4378060a6414 | sonnet | 3 | 6/6 | 明確要求 newest/不要廣告的題沒被改壞 |
| 2026-09-18 | baseline-v2-sonnet-x1 | v2 | 4378060a6414 | sonnet | 1 | 20/20 | 現行基準；v1 相比 F01/F02/F07 不再多填 sort/excludeFeatured |
| 2026-09-18 | apply-analysis-v4-smoke | v4 | 03d6810ebd44 | sonnet | 1 | A01–A03 + D01/D02 5/5 | 新工具 get_apply_analysis 上架：明確要求 → 呼叫；搜尋時順口提競爭度（A03）→ 仍先 search_jobs，未主動呼叫；detail 路由未被改壞 |
| 2026-09-18 | apply-range-optin-v5-smoke | v5 | 6a0fd4d7de18 | sonnet | 1 | S01/F03/A01/A03 4/4 | applyRange 改 opt-in（includeApplyRange）：一般搜尋（S01）沒開；提到競爭度（A03）有開；F03/A01 未被改壞 |
| 2026-09-19 | （無執行） | v4 | 03d6810ebd44 | — | — | — | applyRange 改回預設一律附上、拿掉 includeApplyRange，golden 回到 v4；schema hash 與 apply-analysis-v4-smoke 完全相同，該次 5/5 直接適用，不重跑 |
