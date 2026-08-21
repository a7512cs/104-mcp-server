/**
 * HTTP client：懶啟動 + 全程共用一個 cycletls 實例。
 *
 * 為什麼共用：initCycleTLS 會啟一個 Go 子程序（偽裝 TLS 指紋用），
 * 啟動很貴，所以整個 server 生命週期只開一次。
 *
 * 註：cycletls 是 CommonJS 套件，型別匯出在 TS7 + NodeNext 下有相容問題，
 * 因此用 createRequire 載入 runtime、用 import type 拿型別，兩者分開最穩。
 */
import { createRequire } from "node:module";
import type { CycleTLSClient } from "cycletls";

const require = createRequire(import.meta.url);
const initCycleTLS = require("cycletls") as (
  initOptions?: unknown,
) => Promise<CycleTLSClient>;

const log = (...args: unknown[]) => console.error("[104-mcp:http]", ...args);

let clientPromise: Promise<CycleTLSClient> | null = null;

/** 取得共用的 cycletls client（第一次呼叫才啟動） */
export async function getClient(): Promise<CycleTLSClient> {
  if (!clientPromise) {
    log("starting cycletls...");
    clientPromise = initCycleTLS();
  }
  return clientPromise;
}

/** 關掉 client 子程序（程式結束時呼叫，避免留殭屍程序） */
export async function closeClient(): Promise<void> {
  if (clientPromise) {
    const client = await clientPromise;
    await client.exit();
    clientPromise = null;
    log("cycletls closed");
  }
}
