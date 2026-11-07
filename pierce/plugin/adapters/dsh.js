import { dshHome, readJson } from "../state.js";
import { frameDirs } from "../paths.js";
import { detectSurface } from "./surface.js";

/**
 * DeepSeek Harness 适配器描述。
 *
 * 只放"怎么认出 DSH + 正文从哪读"，不放挂载逻辑 ——
 * 挂载仍由 plugin/index.js 里那份实现提供（第一阶段先立接缝，不搬代码）。
 */

/** 认 DSH：有 systemPrompt 服务，或者环境里带着 DSH_HOME / profile 痕迹。 */
export function detectDsh(input = {}) {
  const env = input.env ?? process.env;
  try {
    if (input.ctx && input.ctx.systemPrompt) return true;
  } catch {
    /* 受控属性访问可能抛；抛了就当不是它 */
  }
  const home = String(env?.DSH_HOME ?? "");
  if (home && /dsh|deepseek/i.test(home)) return true;
  if (String(env?.DSH_PROFILE ?? "").trim()) return true;
  try {
    return Boolean(readJson(`${dshHome()}/state/pierce/boot.json`, null));
  } catch {
    return false;
  }
}

export const dshAdapter = {
  id: "dsh",
  priority: 10,
  detect: detectDsh,
  surface: (input = {}) => detectSurface(input),
  frameDirs,
  describe: () => ({ id: "dsh", surface: detectSurface(), frameDirs: frameDirs() }),
};

export default dshAdapter;
