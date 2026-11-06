import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, stateRoot, writeJson } from "./state.js";
import { rewriteContexts } from "./detect.js";
import { bootPath, disabledPath, recordHookState, recordRewrites } from "./ledger.js";
import { registerSections } from "./sections.js";

/**
 * 插件入口 —— 只做三件事：注册三段、改装配层、改消息层（refreshContext）。
 *
 * 设计约束（见 docs/specs）：
 *   - 只碰文档化服务方法；私有内部一律不碰。
 *   - 每个 hook 独立 try/catch，出错只记账，绝不向宿主抛。
 *   - 包装失败要能被审计器看见（hooks.jsonl 里记 patched:false）。
 */

export const name = "pierce";
export const inject = ["systemPrompt"];

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PROMPTS_DIR = path.join(PACKAGE_ROOT, "prompts");

let lastStatus = null;

export function apply(ctx, config = {}) {
  const at = new Date().toISOString();
  const disabled = readJson(disabledPath(), null);
  const status = {
    at,
    name,
    enabled: !disabled,
    reason: disabled ? "disabled-file" : "ok",
    hooks: {},
    counters: { assemble: 0, refresh: 0, rewrites: 0 },
    sections: { registered: [], errors: [] },
    version: readVersion(),
  };

  if (disabled) {
    lastStatus = status;
    writeJson(path.join(stateRoot(), "status.json"), status);
    return status;
  }

  let service = null;
  try {
    service = ctx?.systemPrompt ?? null;
  } catch (e) {
    status.reason = `systemPrompt 不可用：${String((e && e.message) || e)}`;
  }
  if (!service) {
    status.reason = status.reason || "systemPrompt 不可用";
    lastStatus = status;
    writeJson(path.join(stateRoot(), "status.json"), status);
    return status;
  }

  // 1) 三段
  try {
    status.sections = registerSections(service, PROMPTS_DIR);
  } catch (e) {
    status.sections = { registered: [], errors: [String((e && e.message) || e)] };
  }

  // 2) 装配层 waterfall
  status.hooks.assemble = attachAssemble(ctx, status);

  // 3) 消息层：包装 refreshContext（Q3 的 b 档，带调用计数）
  status.hooks.refresh = attachRefresh(service, status);

  recordHookState({
    boot: at,
    assemble: status.hooks.assemble.attached === true,
    refreshPatched: status.hooks.refresh.patched === true,
    refreshVerified: status.hooks.refresh.verified === true,
    reason: status.hooks.refresh.reason ?? null,
  });

  writeJson(bootPath(), { at, pid: process.pid, version: status.version });
  lastStatus = status;
  writeJson(path.join(stateRoot(), "status.json"), status);
  return status;
}

function attachAssemble(ctx, status) {
  if (typeof ctx?.on !== "function") return { attached: false, reason: "ctx.on 不可用" };
  const handler = async (assembly, _context, next) => {
    let base;
    try {
      base = typeof next === "function" ? await next() : assembly;
    } catch {
      return assembly;
    }
    try {
      status.counters.assemble += 1;
      const result = rewriteContexts(base, "system");
      if (!result.changed) return result.assembly;
      status.counters.rewrites += result.rewrites.length;
      recordRewrites("assemble", result.rewrites);
      return result.assembly;
    } catch {
      return base;
    }
  };
  try {
    const disposer = ctx.on("system-prompt/assemble", handler);
    return { attached: true, disposal: typeof disposer === "function" ? [disposer] : [] };
  } catch (e) {
    return { attached: false, reason: String((e && e.message) || e) };
  }
}

function attachRefresh(service, status) {
  const original = service && typeof service.refreshContext === "function" ? service.refreshContext : null;
  if (!original) return { patched: false, verified: false, reason: "service.refreshContext 不可用" };
  if (original.__pierceWrapped === true) return { patched: true, verified: true, reason: null };

  const wrapped = function pierceRefreshContext(assembly, context) {
    const out = original.call(this, assembly, context);
    try {
      status.counters.refresh += 1;
      const result = rewriteContexts(out, "system");
      if (!result.changed) return out;
      status.counters.rewrites += result.rewrites.length;
      recordRewrites("refresh", result.rewrites);
      return result.assembly;
    } catch {
      return out;
    }
  };
  wrapped.__pierceWrapped = true;

  let assigned = false;
  try {
    service.refreshContext = wrapped;
    assigned = true;
  } catch {
    assigned = false;
  }
  // 代理对象上 === 不可靠（旧项目踩过），所以 verified 只作参考，真伪看 counters。
  return {
    patched: assigned,
    verified: assigned && service.refreshContext === wrapped,
    reason: assigned ? null : "赋值抛错（可能是只读代理）",
  };
}

function readVersion() {
  try {
    const raw = fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8");
    return String(JSON.parse(raw)?.version || "") || null;
  } catch {
    return null;
  }
}

export function status() {
  return lastStatus ?? readJson(path.join(stateRoot(), "status.json"), null);
}

export default { name, inject, apply, status };
