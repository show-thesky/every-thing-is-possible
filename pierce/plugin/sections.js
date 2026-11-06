import fs from "node:fs";
import path from "node:path";

/**
 * 三段注册：前段（环境事实）、正文、尾段（硬约束）。
 *
 * 正文每次组装现读磁盘 —— 改 prompts/core.md 下一轮就生效，不用重启。
 * 关闭方式：删掉 state/pierce/disabled.json 之外，还有一个更狠的：
 * 把 prompts/core.md 清空（三段全空 = 只做过滤，不注入）。
 */
export const SECTIONS = { pre: "pierce:pre", core: "pierce:core", post: "pierce:post" };

function reader(dir) {
  return (file) => {
    try {
      return fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      return "";
    }
  };
}

export function registerSections(service, promptsDir) {
  const out = { registered: [], errors: [], orders: {} };
  const read = reader(promptsDir);
  const orderOf = (name, fallback) => {
    try {
      const value = service?.getSectionOrder?.(name);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  };
  const orders = {
    pre: orderOf("DEPLOYMENT_PERSONA_PREFIX", 0) + 1,
    core: 5100,
    post: orderOf("DEPLOYMENT_PERSONA_SUFFIX", 10200) + 1,
  };
  out.orders = orders;

  const add = (name, order, file) => {
    try {
      service.section({ name, order, interpolate: false, text: () => read(file) });
      out.registered.push(name);
    } catch (e) {
      out.errors.push(`${name}: ${String((e && e.message) || e)}`);
    }
  };

  add(SECTIONS.pre, orders.pre, "pre.md");
  add(SECTIONS.core, orders.core, "core.md");
  add(SECTIONS.post, orders.post, "post.md");
  return out;
}
