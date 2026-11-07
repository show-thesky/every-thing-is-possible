import path from "node:path";
import { readJson, stateRoot, writeJson } from "./state.js";
import { applyPolicyContexts } from "./detect.js";
import { bootPath, recordHookState, recordRewrites } from "./ledger.js";
import { registerSections } from "./sections.js";
import { bump, live, noteError, noteModel } from "./live.js";
import { resolvePrefs } from "./prefs.js";
import { recordAssembly } from "./snapshot.js";
import { packageVersion } from "./paths.js";
import { frameDirs, frameInfo } from "./frames.js";
import { defineAdapter, getAdapter, resolveAdapter } from "./adapter.js";
import dshAdapter from "./adapters/dsh.js";
import { detectSurface } from "./adapters/surface.js";
import { attachWebRoute, createPanelHandler, panelRuntimeState, startPanelServer } from "./routes.js";

/**
 * 插件入口 —— 只做三件事：注册三段、改装配层、改消息层（refreshContext），
 * 外加把面板塞进宿主 HTTP。
 *
 * 设计约束：
 *   - 只碰文档化服务方法；私有内部一律不碰。
 *   - 每个 hook 独立 try/catch，出错只记账，绝不向宿主抛。
 *   - **钩子与段始终注册**，是否真的干活在每次调用时现读偏好 ——
 *     面板上的开关因此下一轮就生效，不需要重启宿主。
 */

export const name = "pierce";
export const inject = ["systemPrompt"];

let configRef = {};
let lastStatus = null;

function applyDsh(ctx, config = {}) {
  configRef = config && typeof config === "object" ? config : {};
  const prefs = resolvePrefs(configRef);
  const version = packageVersion();
  const at = new Date().toISOString();

  const status = {
    at,
    name,
    version,
    enabled: prefs.enabled,
    offBy: prefs.offBy,
    bootId: live.bootId,
    pid: process.pid,
    prefs: { enabled: prefs.enabled, sections: prefs.sections, layers: prefs.layers, policy: prefs.policy, ledger: prefs.ledger },
    hooks: {},
    sections: null,
    panel: null,
    counters: null,
    errors: [],
  };

  let service = null;
  try {
    service = ctx?.systemPrompt ?? null;
  } catch (e) {
    status.errors.push(`systemPrompt 不可用：${String((e && e.message) || e)}`);
    noteError("apply.systemPrompt", e);
  }

  // 1) 三段：始终注册，文本 thunk 每次现读偏好
  if (service) {
    try {
      status.sections = registerSections(service, frameDirs(), () => resolvePrefs(configRef));
    } catch (e) {
      status.sections = { registered: [], errors: [String((e && e.message) || e)], orders: {} };
      noteError("apply.sections", e);
    }
  } else {
    status.sections = { registered: [], errors: ["没有 systemPrompt 服务：三段未注册"], orders: {} };
  }

  // 2) 装配层 waterfall
  status.hooks.assemble = attachAssemble(ctx);

  // 3) 消息层：包装 refreshContext（宿主在 step 里会把 context 重新读一遍再塞进用户消息）
  status.hooks.refresh = attachRefresh(service);

  recordHookState({
    boot: at,
    bootId: live.bootId,
    version,
    assemble: live.hooks.assemble.attached === true,
    refreshPatched: live.hooks.refresh.patched === true,
    refreshVerified: live.hooks.refresh.verified === true,
    reason: live.hooks.refresh.reason ?? null,
  });

  // 4) 面板：同源路由 + 回环端口兜底
  const handler = createPanelHandler(() => configRef);
  const web = attachWebRoute(ctx, handler);
  let runtime = { port: null, error: null, started: false };
  try {
    runtime = startPanelServer(handler);
    runtime = panelRuntimeState() ?? runtime;
  } catch (e) {
    status.errors.push(`面板服务：${String((e && e.message) || e)}`);
    noteError("apply.panel", e);
  }
  status.panel = {
    prefix: "/pierce/api",
    webRegistered: web.registered === true,
    webError: web.error ?? null,
    port: runtime.port ?? null,
    portError: runtime.error ?? null,
  };

  status.adapter = "dsh";
  status.surface = detectSurface();
  status.frame = frameInfo();

  status.counters = { ...live.counters };
  writeJson(path.join(stateRoot(), "status.json"), status);
  writeJson(bootPath(), { at, bootId: live.bootId, pid: process.pid, version });

  lastStatus = status;
  return status;
}

// 模块加载时登记 DSH 适配器（热重载重复登记是幂等的）。apply 指回本文件实现。
defineAdapter({ ...dshAdapter, apply: applyDsh, status });

/**
 * 对外入口：先问注册表"现在是谁"，再交给它挂载。
 * 直接调用（测试 / 命令行）时 resolveAdapter 会经 detect() 认出 DSH。
 */
export function apply(ctx, config = {}) {
  const adapter = resolveAdapter({ ctx, env: process.env }) ?? getAdapter("dsh");
  if (!adapter) throw new Error("pierce: 没有可用的宿主适配器");
  return adapter.apply(ctx, config);
}

function attachAssemble(ctx) {
  if (typeof ctx?.on !== "function") {
    live.hooks.assemble = { attached: false, reason: "ctx.on 不可用" };
    return live.hooks.assemble;
  }

  const handler = async (assembly, _context, next) => {
    let base;
    try {
      base = typeof next === "function" ? await next() : assembly;
    } catch (e) {
      noteError("assemble.next", e);
      return assembly;
    }
    try {
      bump("assemble");
      live.last.assembleAt = new Date().toISOString();
      try {
        noteModel(base?.variables?.model ?? base?.model ?? null);
      } catch {
        /* 拿不到模型名不影响组装 */
      }
      const prefs = resolvePrefs(configRef);
      if (!prefs.enabled || !prefs.layers.assemble) {
        bump("skipped");
        recordAssembly({ assembly: base, prefs, result: { policyIn: 0, rewrites: [], dropped: [] }, channel: "assemble", version: packageVersion() });
        return base;
      }
      const result = applyPolicyContexts(base, { mode: prefs.policy.mode, criteria: prefs.policy.criteria });
      if (result.changed) {
        bump("rewrites", result.rewrites.length);
        bump("dropped", result.dropped.length);
        if (prefs.ledger) recordRewrites("assemble", result.rewrites);
      }
      recordAssembly({ assembly: result.assembly, prefs, result, channel: "assemble", version: packageVersion() });
      return result.assembly;
    } catch (e) {
      noteError("assemble.rewrite", e);
      return base;
    }
  };

  try {
    const disposer = ctx.on("system-prompt/assemble", handler);
    live.hooks.assemble = { attached: true, reason: null, disposal: typeof disposer === "function" ? [disposer] : [] };
  } catch (e) {
    live.hooks.assemble = { attached: false, reason: String((e && e.message) || e) };
  }
  return live.hooks.assemble;
}

function attachRefresh(service) {
  const original = service && typeof service.refreshContext === "function" ? service.refreshContext : null;
  if (!original) {
    live.hooks.refresh = { patched: false, verified: false, reason: "service.refreshContext 不可用" };
    return live.hooks.refresh;
  }
  if (original.__pierceWrapped === true) {
    live.hooks.refresh = { patched: true, verified: true, reason: null };
    return live.hooks.refresh;
  }

  const wrapped = function pierceRefreshContext(assembly, context) {
    const out = original.call(this, assembly, context);
    try {
      bump("refresh");
      live.last.refreshAt = new Date().toISOString();
      try {
        noteModel(out?.variables?.model ?? out?.model ?? null);
      } catch {
        /* 同上 */
      }
      const prefs = resolvePrefs(configRef);
      if (!prefs.enabled || !prefs.layers.refresh) {
        recordAssembly({ assembly: out, prefs, result: { policyIn: 0, rewrites: [], dropped: [] }, channel: "refresh", version: packageVersion() });
        return out;
      }
      const result = applyPolicyContexts(out, { mode: prefs.policy.mode, criteria: prefs.policy.criteria });
      if (result.changed) {
        bump("rewrites", result.rewrites.length);
        bump("dropped", result.dropped.length);
        if (prefs.ledger) recordRewrites("refresh", result.rewrites);
      }
      recordAssembly({ assembly: result.assembly, prefs, result, channel: "refresh", version: packageVersion() });
      return result.assembly;
    } catch (e) {
      noteError("refresh.rewrite", e);
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

  /*
   * 子智能体的口子：实测（session c9849398）子会话的 user/message 里仍是原文
   * —— "Current DSH file policy: workspace-write" / "Approval policy: ask"，
   * 说明子会话拿到的不是我们包过的那个实例。只在实例上赋值覆盖不到它们，
   * 所以再把包装挂到原型上（挂在类上 = 所有实例共享）。
   * 失败无妨：原型可能是 null / 不可写，那就退回实例级覆盖。
   */
  let prototypePatched = false;
  try {
    const proto = Object.getPrototypeOf(service);
    if (proto && typeof proto.refreshContext === "function" && proto.refreshContext !== wrapped) {
      proto.refreshContext = wrapped;
      prototypePatched = true;
    }
  } catch {
    prototypePatched = false;
  }

  // 代理对象上 === 不可靠（旧项目踩过），所以 verified 只作参考，真伪看 counters。
  live.hooks.refresh = {
    patched: assigned || prototypePatched,
    verified: assigned && service.refreshContext === wrapped,
    prototypePatched,
    reason: assigned || prototypePatched ? null : "赋值抛错（可能是只读代理）",
  };
  return live.hooks.refresh;
}

/** 进程内活状态（工具/命令行调用它；面板直接读 buildState）。 */
export function status() {
  const prefs = resolvePrefs(configRef);
  return {
    name,
    version: packageVersion(),
    enabled: prefs.enabled,
    offBy: prefs.offBy,
    prefs: {
      sections: prefs.sections,
      layers: prefs.layers,
      policy: prefs.policy,
      ledger: prefs.ledger,
      trace: prefs.trace,
    },
    bootId: live.bootId,
    bootAt: live.bootAt,
    pid: live.pid,
    counters: { ...live.counters },
    hooks: {
      assemble: { attached: live.hooks.assemble.attached === true, reason: live.hooks.assemble.reason ?? null },
      refresh: {
        patched: live.hooks.refresh.patched === true,
        verified: live.hooks.refresh.verified === true,
        reason: live.hooks.refresh.reason ?? null,
      },
    },
    adapter: "dsh",
    surface: detectSurface(),
    frame: frameInfo(),
    last: live.last,
    applyStatus: lastStatus ?? readJson(path.join(stateRoot(), "status.json"), null),
  };
}

export default { name, inject, apply, status };
