/**
 * 禮貌性節流：確保兩次對 104 的請求之間，至少間隔一段隨機時間。
 *
 * 為什麼隨機：固定間隔（例如每 2 秒一次）本身就是一種機器人特徵，
 * 在 min~max 間隨機更像真人操作，降低被偵測/封鎖的機率。
 */
import { CONFIG } from "../config.js";

let lastRequestAt = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 呼叫後保證距離上一次請求已間隔隨機 min~max 毫秒 */
export async function waitForTurn(): Promise<void> {
  const span = CONFIG.throttleMaxMs - CONFIG.throttleMinMs;
  const gap = CONFIG.throttleMinMs + Math.random() * span;
  const elapsed = Date.now() - lastRequestAt;
  if (lastRequestAt > 0 && elapsed < gap) {
    await sleep(gap - elapsed);
  }
  lastRequestAt = Date.now();
}
