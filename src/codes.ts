/**
 * 地區 / 職類「名稱 → 官方代碼」解析。
 *
 * 104 的搜尋 API 篩地區、職類要用官方代碼（例如台北市=6001001000）。
 * 代碼表是樹狀 JSON，放在 static.104（沒有 Cloudflare），一般 fetch 就能拿。
 * 抓一次快取在記憶體，之後查詢直接用。
 */
import { CONFIG } from "./config.js";

const log = (...args: unknown[]) => console.error("[104-mcp:codes]", ...args);

/** 代碼表節點（樹狀，n 是子節點） */
export interface CodeNode {
  no: string;
  des: string;
  n?: CodeNode[];
}

/** 攤平後的單筆代碼 */
export interface FlatCode {
  code: string;
  name: string;
}

/** 把樹狀代碼表攤平成一維陣列（含所有層級） */
export function flattenTree(nodes: CodeNode[]): FlatCode[] {
  const out: FlatCode[] = [];
  const walk = (list: CodeNode[]) => {
    for (const node of list) {
      if (node.no && node.des) out.push({ code: node.no, name: node.des });
      if (node.n?.length) walk(node.n);
    }
  };
  walk(nodes);
  return out;
}

/** 太多筆表示查詢字太模糊（例如「市」），回空陣列讓上層改用其他方式 */
const MAX_MATCHES = 30;

/**
 * 用名稱在樹上找代碼，關鍵是「剪枝」：
 * 一旦某節點名稱命中，就用它的代碼、且不再往下展開子節點
 * —— 因為父節點（例如「新竹縣市」）本身就涵蓋所有子區，
 * 展開成一堆子代碼反而會讓 104 回 400（代碼數量有上限）。
 * 太模糊（>30 筆）就放棄，回空陣列讓上層改用 client 端子字串過濾。
 */
export function matchCodes(nodes: CodeNode[], query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const out: string[] = [];
  const walk = (list: CodeNode[]) => {
    for (const node of list) {
      if (node.des?.includes(q)) {
        if (node.no) out.push(node.no); // 命中 → 收代碼、剪枝（不進子節點）
      } else if (node.n?.length) {
        walk(node.n); // 沒中才往下找更細的
      }
    }
  };
  walk(nodes);
  if (out.length === 0 || out.length > MAX_MATCHES) return [];
  return out;
}

// ── 快取 + 抓取 ──────────────────────────────────────────────

let areaTree: Promise<CodeNode[]> | null = null;
let jobCatTree: Promise<CodeNode[]> | null = null;

async function fetchTree(url: string): Promise<CodeNode[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": CONFIG.userAgent, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`抓取代碼表失敗 ${url}: ${res.status}`);
  return (await res.json()) as CodeNode[];
}

/** 解析地區名稱 → 官方代碼陣列（抓不到表時回空陣列，不讓整個搜尋失敗） */
export async function resolveAreaCodes(query: string): Promise<string[]> {
  if (!areaTree) {
    log("fetching Area.json...");
    areaTree = fetchTree(CONFIG.areaJsonUrl);
  }
  try {
    return matchCodes(await areaTree, query);
  } catch (err) {
    areaTree = null; // 失敗就清掉快取，下次重試
    log("resolveAreaCodes failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

/** 解析職類名稱 → 官方代碼陣列 */
export async function resolveJobCatCodes(query: string): Promise<string[]> {
  if (!jobCatTree) {
    log("fetching JobCat.json...");
    jobCatTree = fetchTree(CONFIG.jobCatJsonUrl);
  }
  try {
    return matchCodes(await jobCatTree, query);
  } catch (err) {
    jobCatTree = null;
    log("resolveJobCatCodes failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
