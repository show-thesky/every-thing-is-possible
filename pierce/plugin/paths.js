import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome } from "./state.js";

/** 包根与提示词目录 —— 所有模块都从这里取，避免各自 new URL 拼路径。 */
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]+$/, "");
export const PROMPTS_DIR = path.join(PACKAGE_ROOT, "prompts");

/**
 * 用户在宿主目录里的覆盖目录：`$DSH_HOME/pierce/frame/`。
 *
 * 为什么要有它：换模型、换措辞不该改仓库、不该重装。
 * 三级别里它排第二（包内默认 → 用户覆盖 → profile 组合由调用方再叠加）。
 */
export function userFrameDir() {
  const dir = path.join(dshHome(), "pierce", "frame");
  try {
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

/** 正文搜索顺序，顺序即优先级：用户覆盖优先，包内默认兜底。 */
export function frameDirs() {
  const dirs = [];
  const override = userFrameDir();
  if (override) dirs.push(override);
  dirs.push(PROMPTS_DIR);
  return dirs;
}

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
