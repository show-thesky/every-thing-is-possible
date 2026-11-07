import fs from "node:fs";
import path from "node:path";

/**
 * 两段：正文（框架）与尾段（收口）。
 *
 * 为什么只有两段：旧版是四段（pre / core / creative / post），实测 pre 与 core
 * 讲的是同一批规矩、creative 与 post 的收口重复，四个声音各说一遍，总量 7.3 KB
 * 占系统提示词 56%。现在压成 2 段：core 讲框架，post 只放"最后一屏"该看到的东西 ——
 * 系统提示词末尾的近因权重是真实存在的，别让它在中间被稀释。
 *
 * 两个关键决定：
 *   1. **两段始终注册**，内容由 thunk 每次现读偏好 —— 面板开关下一轮生效，不重启。
 *   2. **正文每次组装现读磁盘** —— 改 prompts/*.md 下一轮就生效。
 *
 * 关闭一段 = thunk 返回空串（段还在，只是不贡献内容）。
 */
export const SECTIONS = { core: "pierce:core", post: "pierce:post" };

export const SECTION_FILES = { core: "core.md", post: "post.md" };

const LABELS = { core: "正文 core", post: "尾段 post" };

/** 组装顺序：正文 5100，尾段跟在官方 persona-suffix 之后。 */
const CORE_ORDER = 5100;

export function sectionLabel(key) {
  return LABELS[key] || key;
}

/** 读一段提示词原文；读不到就当空（不允许因为缺文件让组装抛错）。 */
export function readPrompt(promptsDir, key) {
  const file = SECTION_FILES[key];
  if (!file) return "";
  try {
    return fs.readFileSync(path.join(promptsDir, file), "utf8");
  } catch {
    return "";
  }
}

/** 这一段当前该不该贡献内容（面板的「期望」列和运行时 thunk 共用这一份判断）。 */
export function sectionEnabled(prefs, key) {
  if (!prefs || !prefs.enabled) return false;
  return prefs.sections ? prefs.sections[key] !== false : true;
}

/** 当前偏好下，这一段**应该**贡献的文本。 */
export function expectedText(promptsDir, key, prefs) {
  if (!sectionEnabled(prefs, key)) return "";
  return readPrompt(promptsDir, key);
}

export function registerSections(service, promptsDir, getPrefs) {
  const out = { registered: [], errors: [], orders: {} };
  const orderOf = (name, fallback) => {
    try {
      const value = service?.getSectionOrder?.(name);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const orders = {
    core: CORE_ORDER,
    post: orderOf("DEPLOYMENT_PERSONA_SUFFIX", 10200) + 1,
  };
  out.orders = orders;

  const textFor = (key) => () => {
    try {
      const prefs = typeof getPrefs === "function" ? getPrefs() : null;
      return expectedText(promptsDir, key, prefs);
    } catch {
      return "";
    }
  };

  const add = (key) => {
    const name = SECTIONS[key];
    try {
      service.section({ name, order: orders[key], interpolate: false, text: textFor(key) });
      out.registered.push(name);
    } catch (e) {
      out.errors.push(`${name}: ${String((e && e.message) || e)}`);
    }
  };

  add("core");
  add("post");
  return out;
}
