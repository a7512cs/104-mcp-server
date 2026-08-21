import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenTree, matchCodes } from "../dist/codes.js";

// 迷你 fixture，模擬 Area.json 的樹狀結構
const areaTree = [
  { no: "6001000000", des: "台灣地區", n: [
    { no: "6001001000", des: "台北市", n: [
      { no: "6001001005", des: "台北市大安區" },
      { no: "6001001007", des: "台北市信義區" },
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
  assert.equal(flat.length, 6); // 台灣地區 + 台北市 + 2區 + 新竹市 + 1區
});

test("matchCodes: 剪枝 —— 命中父節點就只回父代碼，不展開子區（台北市 → 只回市碼）", () => {
  // 這是防守 400 的關鍵：展開成一堆子代碼會讓 104 回 400
  assert.deepEqual(matchCodes(areaTree, "台北市"), ["6001001000"]);
});

test("matchCodes: 命中父節點即剪枝（台北 → 只回台北市，不含各區）", () => {
  assert.deepEqual(matchCodes(areaTree, "台北"), ["6001001000"]);
});

test("matchCodes: 沒中父節點才往下找細的（信義區 → 區碼）", () => {
  assert.deepEqual(matchCodes(areaTree, "信義區"), ["6001001007"]);
});

test("matchCodes: 找不到 → 空陣列", () => {
  assert.deepEqual(matchCodes(areaTree, "火星"), []);
});

test("matchCodes: 空字串 → 空陣列", () => {
  assert.deepEqual(matchCodes(areaTree, "  "), []);
});
