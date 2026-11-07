/**
 * 宿主面探测 —— 同一套机制在不同宿主形态（网页 / 桌面 / 未来 gui、tui）上跑。
 *
 * 为什么需要它：DSH 自己就有 web 与 desktop 两种启动方式，路径、重启方式、
 * 静态资源位置都不同。机制层不该知道这些，只该问"我现在在哪个面"。
 *
 * 判定顺序：显式环境变量 > 可执行文件/资源目录的形状 > 默认 web。
 * 只做保守判定：认不出来就当 web（网页面是最通用的兜底）。
 */
export const SURFACES = Object.freeze(["web", "desktop", "gui", "tui"]);

const norm = (value) => String(value ?? "").trim().toLowerCase();
const slash = (value) => String(value ?? "").replace(/\\/g, "/").toLowerCase();

function exeStem(execPath) {
  const base = String(execPath ?? "").split(/[\\/]/).pop() ?? "";
  return norm(base.replace(/\.(exe|app|cmd|bat)$/i, ""));
}

const DESKTOP_EXES = new Set([
  "deepseek harness",
  "deepseek-harness",
  "deepseekharness",
  "dsh desktop",
  "dsh-desktop",
  "dsh desktop",
  "electron",
]);

/** 资源目录像不像桌面安装：resources/ 下有 app.asar 或 app/dsh。 */
function looksLikeDesktopResources(resourcesPath, fs) {
  const value = slash(resourcesPath);
  if (!value) return false;
  if (!(value.endsWith("/resources") || value.includes("/contents/resources"))) return false;
  try {
    if (fs.existsSync(`${resourcesPath}/app.asar`)) return true;
    if (fs.existsSync(`${resourcesPath}/app/dsh`)) return true;
    if (fs.existsSync(`${resourcesPath}/app.asar.unpacked/dsh`)) return true;
  } catch {
    /* 探测失败就当不是 */
  }
  return false;
}

/**
 * @param {object} input
 * @param {Record<string,string>} [input.env]        默认 process.env
 * @param {string} [input.execPath]                  默认 process.execPath
 * @param {string} [input.resourcesPath]             默认 process.resourcesPath
 * @param {string[]} [input.argv]                    默认 process.argv
 * @param {object} [input.fs]                        便于测试注入口
 */
export function detectSurface(input = {}) {
  const env = input.env ?? process.env;
  const fs = input.fs ?? { existsSync: (fp) => false };
  const forced = norm(env?.DSH_SURFACE);
  if (SURFACES.includes(forced)) return forced;

  const execPath = input.execPath ?? process.execPath;
  if (DESKTOP_EXES.has(exeStem(execPath))) return "desktop";
  if (looksLikeDesktopResources(input.resourcesPath ?? process.resourcesPath, fs)) return "desktop";

  const argv = Array.isArray(input.argv) ? input.argv : process.argv;
  if (argv.some((arg) => /app\.asar|resources[\\/](app|runtime)/i.test(String(arg ?? "")))) return "desktop";

  return "web";
}

/** 未来 gui / tui 有专属实现时在这里分流；现在全部按 web 处理。 */
export function adapterFor(surface) {
  return surface === "desktop" ? "desktop" : "web";
}
