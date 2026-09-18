/**
 * 評分核心：把模型「實際呼叫的 tool」對到 golden case 的期望。
 * 純函式，不連網、不碰模型 —— 用 node --test 驗證（test/evals-score.test.mjs）。
 *
 * 一個 case 通過的條件：tool 名稱正確，且 expect.args 裡每一條 check 都通過。
 * check 四種：
 *   { arg, equals: v }     值相等（寬鬆：80000 與 "80000"、true 與 "true" 視為相同）
 *   { arg, contains: s }   字串包含，不分大小寫（"DevOps 工程師" 含 "devops"）
 *   { arg, absent: true }  模型不得填這個參數 —— 抓「使用者沒說卻自己加條件」（用在填任何值都會改變結果的參數：sort、salaryMin、area…）
 *   { arg, notEquals: v }  不可以是這個值；不填或填其他值都通過 —— 用在「不填 = 預設值」的布林參數（excludeFeatured、excludeNegotiable）：
 *                          填 false 跟不填行為相同，不算錯；判準對準使用者感覺得到的差別，不對準 JSON 長相
 *   { arg, present: true } 模型必須填這個參數，值不限
 */

const isAbsent = (v) => v === undefined || v === null || v === "";

export function checkArg(input, check) {
  const actual = input?.[check.arg];
  const base = { arg: check.arg, actual };
  if ("equals" in check) {
    const pass = !isAbsent(actual) && String(actual) === String(check.equals);
    return { ...base, kind: "equals", expected: check.equals, pass };
  }
  if ("contains" in check) {
    const pass =
      typeof actual === "string" && actual.toLowerCase().includes(String(check.contains).toLowerCase());
    return { ...base, kind: "contains", expected: check.contains, pass };
  }
  if ("absent" in check) {
    return { ...base, kind: "absent", expected: "(不填)", pass: isAbsent(actual) };
  }
  if ("notEquals" in check) {
    const pass = isAbsent(actual) || String(actual) !== String(check.notEquals);
    return { ...base, kind: "notEquals", expected: check.notEquals, pass };
  }
  if ("present" in check) {
    return { ...base, kind: "present", expected: "(任意值)", pass: !isAbsent(actual) };
  }
  throw new Error(`未知的 check 型別：${JSON.stringify(check)}`);
}

const fmt = (v) => (isAbsent(v) ? "(未填)" : JSON.stringify(v));

function describeFail(c) {
  return `${c.arg} 期望 ${c.kind} ${fmt(c.expected)}，實際 ${fmt(c.actual)}`;
}

/** toolCall = { name, input } 或 null（模型沒呼叫任何 tool） */
export function scoreCase(caseDef, toolCall) {
  if (!toolCall) {
    return { id: caseDef.id, pass: false, toolPass: false, checks: [], reason: "模型沒有呼叫任何 tool" };
  }
  const toolPass = toolCall.name === caseDef.expect.tool;
  const checks = (caseDef.expect.args ?? []).map((c) => checkArg(toolCall.input, c));
  const failed = checks.filter((c) => !c.pass);
  const pass = toolPass && failed.length === 0;
  const reason = !toolPass
    ? `tool 錯：期望 ${caseDef.expect.tool}，實際 ${toolCall.name}`
    : failed.length
      ? failed.map(describeFail).join("；")
      : "通過";
  return { id: caseDef.id, pass, toolPass, checks, reason };
}

/**
 * 彙總。caseResults = [{ id, category, passRate }]，passRate = 該 case 重跑 N 次的通過比例。
 * passedAll = 每一次都過的 case 數（嚴格）；meanPassRate = 所有 case 的平均通過率（看穩定度）。
 */
export function summarize(caseResults) {
  const total = caseResults.length;
  const passedAll = caseResults.filter((c) => c.passRate === 1).length;
  const meanPassRate = total ? caseResults.reduce((s, c) => s + c.passRate, 0) / total : 0;
  const byCategory = {};
  for (const c of caseResults) {
    const cur = byCategory[c.category] ?? { total: 0, passedAll: 0 };
    byCategory[c.category] = {
      total: cur.total + 1,
      passedAll: cur.passedAll + (c.passRate === 1 ? 1 : 0),
    };
  }
  return { total, passedAll, meanPassRate, byCategory };
}
