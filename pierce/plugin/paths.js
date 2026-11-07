import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 包根与提示词目录 —— 所有模块都从这里取，避免各自 new URL 拼路径。 */
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]+$/, "");
export const PROMPTS_DIR = path.join(PACKAGE_ROOT, "prompts");

let cache = null;

/** 本地版本：读包清单，读不到就报 "?"（不允许因此抛错）。 */
export function packageVersion() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    cache = String(JSON.parse(raw).version || "") || "?";
  } catch {
    cache = "?";
  }
  return cache;
}
