import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenTree, matchCodes, buildAreaAmbiguity } from "../dist/codes.js";

// 迷你 fixture，模擬 Area.json 的樹狀結構
const areaTree = [
  { no: "6001000000", des: "台灣地區", n: [
    { no: "6001001000", des: "台北市", n: [
      { no: "6001001005", des: "台北市大安區" },
      { no: "6001001007", des: "台北市信義區" },
    ]},
    { no: "6001004000", des: "基隆市", n: [
      { no: "6001004002", des: "基隆市信義區" },
    ]},
    { no: "6001007000", des: "新竹市", n: [
      { no: "6001007001", des: "新竹市東區" },
    ]},
  ]},
];

test("flattenTree: 攤平所有層級（含中間節點）", () => {
  const flat = flattenTree(areaTree);
  const names = flat.map((f) => f.name);
  assert.ok(names.includes("台灣地區"));
  assert.ok(names.includes("台北市"));
  assert.ok(names.includes("台北市信義區"));
  assert.equal(flat.length, 8); // 台灣地區 + 台北市+2區 + 基隆市+1區 + 新竹市+1區
});

test("matchCodes: 剪枝 —— 命中父節點就只回父代碼，不展開子區（台北市 → 只回市碼）", () => {
  // 這是防守 400 的關鍵：展開成一堆子代碼會讓 104 回 400
  assert.deepEqual(matchCodes(areaTree, "台北市"), [{ code: "6001001000", name: "台北市" }]);
});

test("matchCodes: 命中父節點即剪枝（台北 → 只回台北市，不含各區）", () => {
  assert.deepEqual(matchCodes(areaTree, "台北"), [{ code: "6001001000", name: "台北市" }]);
});

test("matchCodes: 唯一命中的區 → 一筆（大安區）", () => {
  assert.deepEqual(matchCodes(areaTree, "大安區"), [{ code: "6001001005", name: "台北市大安區" }]);
});

test("matchCodes: 同名多區 → 全部回傳（信義區 → 台北+基隆），由上層決定怎麼處理", () => {
  assert.deepEqual(matchCodes(areaTree, "信義區"), [
    { code: "6001001007", name: "台北市信義區" },
    { code: "6001004002", name: "基隆市信義區" },
  ]);
});

test("matchCodes: 找不到 → 空陣列", () => {
  assert.deepEqual(matchCodes(areaTree, "火星"), []);
});

test("matchCodes: 空字串 → 空陣列", () => {
  assert.deepEqual(matchCodes(areaTree, "  "), []);
});

test("buildAreaAmbiguity: 同名多區 → 回候選清單 + 提示模型跟使用者確認", () => {
  const result = buildAreaAmbiguity("信義區", [
    { code: "6001001007", name: "台北市信義區" },
    { code: "6001004002", name: "基隆市信義區" },
  ]);
  assert.equal(result.ambiguousArea.query, "信義區");
  assert.equal(result.ambiguousArea.matches.length, 2);
  assert.ok(result.ambiguousArea.hint.includes("台北市信義區"));
  assert.ok(result.ambiguousArea.hint.includes("確認")); // 提示要回頭問使用者
});
