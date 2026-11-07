import http from "node:http";
import path from "node:path";
import { stateRoot, writeJson } from "./state.js";
import { PANEL_PREFIX, PORT_BASE, PORT_TRIES, ROUTES, SERVICE_ID } from "./protocol.js";
import { applyUpdateNow, buildState, checkVersionNow, makeRestartScript, runAudit } from "./panel.js";
import { applyPrefs, resetPrefs } from "./prefs.js";
import { packageVersion } from "./paths.js";

/**
 * 面板 HTTP 层。两条入口，同一套 handler：
 *   A. 宿主 webServer 的 /pierce/api/*  —— 与 GUI **同源**，浏览器侧没有跨域。
 *   B. 自带 127.0.0.1 端口的服务         —— A 注册失败时的兜底；只回环，且校验 Origin。
 *
 * 旧项目在这里栽过一次：`ctx.get("webServer")` 拿到 undefined，A 静默失效，
 * 面板表现为"点了没反应"。所以注册结果要落 panel-web.json，面板能显示到底挂没挂。
 */

const MAX_BODY = 64 * 1024;

function sendJson(res, code, value) {
  if (!res || typeof res.writeHead !== "function") return;
  const body = JSON.stringify(value);
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks.map((chunk) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error(`JSON 解析失败：${String((e && e.message) || e)}`));
      }
    });
    req.on("error", reject);
  });
}

/** 只认回环来源：跨站页面拿不到这些数据，也不能拿它当开关。 */
export function originAllowed(origin) {
  const value = String(origin ?? "").trim();
  if (!value || value === "null") return true;
  try {
    const url = new URL(value);
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function applyCors(res, origin) {
  if (!res || typeof res.setHeader !== "function") return;
  if (origin && originAllowed(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
}

/** 把 /pierce/api/state 与 /state 都归一到 /state，方便自带端口与同源路由共用。 */
function normalizeRoute(url) {
  let pathname = "/";
  try {
    pathname = new URL(String(url ?? "/"), "http://x").pathname;
  } catch {
    pathname = "/";
  }
  if (pathname === PANEL_PREFIX || pathname.startsWith(`${PANEL_PREFIX}/`)) {
    return pathname.slice(PANEL_PREFIX.length) || "/";
  }
  return pathname;
}

function routeOf(pathname) {
  return Object.entries(ROUTES).find(([, route]) => route.path === pathname) || null;
}

/**
 * @param {() => object} getConfig  读当前插件配置（`enabled:false` 用来解释"开关不生效"）
 */
export function createPanelHandler(getConfig = () => ({})) {
  return async function handler(req, res) {
    const pathname = normalizeRoute(req?.url);
    const found = routeOf(pathname);

    if (req?.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!found) {
      return sendJson(res, 404, { ok: false, error: `未知路径：${pathname}`, routes: Object.values(ROUTES).map((r) => `${r.method} ${r.path}`) });
    }

    const [key, route] = found;
    if (req.method !== route.method) {
      return sendJson(res, 405, { ok: false, error: `${pathname} 只接受 ${route.method}` });
    }

    const config = (() => {
      try {
        return getConfig() || {};
      } catch {
        return {};
      }
    })();

    try {
      if (key === "ping") {
        return sendJson(res, 200, {
          ok: true,
          service: SERVICE_ID,
          prefix: PANEL_PREFIX,
          version: packageVersion(),
          at: new Date().toISOString(),
        });
      }

      if (key === "state") return sendJson(res, 200, buildState(config));

      if (key === "prefs") {
        const body = await readBody(req);
        const applied = applyPrefs(body, config);
        return sendJson(res, 200, { ok: true, applied: { patch: applied.patch, before: applied.before, after: applied.after, noop: applied.noop }, state: buildState(config) });
      }

      if (key === "reset") {
        const applied = resetPrefs(config);
        return sendJson(res, 200, { ok: true, applied: { before: applied.before, after: applied.after, noop: applied.noop }, state: buildState(config) });
      }

      if (key === "audit") {
        const body = await readBody(req);
        const audit = await runAudit({ all: body.all === true });
        return sendJson(res, 200, { ok: audit.ok === true, audit, state: buildState(config) });
      }

      if (key === "updateCheck") {
        const update = await checkVersionNow();
        return sendJson(res, 200, { ok: update.ok !== false, update, state: buildState(config) });
      }

      if (key === "updateApply") {
        const result = applyUpdateNow();
        return sendJson(res, 200, { ok: result.ok === true, result, state: buildState(config) });
      }

      if (key === "restart") {
        const restart = makeRestartScript();
        return sendJson(res, 200, { ok: Boolean(restart.path), restart });
      }

      return sendJson(res, 404, { ok: false, error: `未实现：${key}` });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: String((e && e.message) || e) });
    }
  };
}

/* ── A. 宿主 webServer 上的同源路由 ───────────────────────────────────── */

function panelWebPath() {
  return path.join(stateRoot(), "panel-web.json");
}

export function attachWebRoute(ctx, handler) {
  const out = { registered: false, error: null, path: PANEL_PREFIX, kind: "prefix", disposal: [] };
  const note = (patch) => writeJson(panelWebPath(), { at: new Date().toISOString(), path: PANEL_PREFIX, kind: "prefix", ...patch });

  if (typeof ctx?.inject !== "function") {
    out.error = "ctx.inject 不可用";
    note({ registered: false, error: out.error });
    return out;
  }
  // 先落一条"等回调"：三种状态必须能区分开（没文件=旧代码 / false=回调没跑 / true=已注册）。
  note({ registered: false, error: "等待 webServer 注入回调" });
  try {
    const release = ctx.inject(["webServer"], (webCtx) => {
      try {
        const disposer = webCtx.webServer.register({ kind: "prefix", path: PANEL_PREFIX, handler });
        out.registered = true;
        out.error = null;
        if (typeof disposer === "function") out.disposal.push(disposer);
        note({ registered: true });
      } catch (e) {
        out.error = String((e && e.message) || e);
        note({ registered: false, error: out.error });
      }
    });
    if (typeof release === "function") out.disposal.push(release);
  } catch (e) {
    out.error = String((e && e.message) || e);
    note({ registered: false, error: out.error });
  }
  return out;
}

/* ── B. 自带回环端口（兜底） ──────────────────────────────────────────── */

const panelRuntime = { server: null, port: null, error: null, starting: false };

export function panelPortPath() {
  return path.join(stateRoot(), "panel-port.json");
}

export function startPanelServer(handler) {
  if (process.env.PIERCE_NO_PANEL === "1") {
    panelRuntime.error = "PIERCE_NO_PANEL=1：已跳过面板服务";
    return panelRuntime;
  }
  if (panelRuntime.server || panelRuntime.starting) return panelRuntime;

  const server = http.createServer((req, res) => {
    const origin = String(req.headers.origin ?? "");
    applyCors(res, origin);
    if (!originAllowed(origin)) {
      const body = JSON.stringify({ ok: false, error: "跨站请求已拒绝" });
      res.writeHead(403, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    handler(req, res);
  });

  let attempt = 0;
  const tryListen = () => {
    if (attempt >= PORT_TRIES) {
      panelRuntime.error = `端口 ${PORT_BASE}..${PORT_BASE + PORT_TRIES - 1} 都被占用`;
      panelRuntime.starting = false;
      return;
    }
    const port = PORT_BASE + attempt;
    attempt += 1;
    const onError = (e) => {
      server.removeListener("listening", onListening);
      if (e && e.code === "EADDRINUSE") return tryListen();
      panelRuntime.error = String((e && e.message) || e);
      panelRuntime.starting = false;
      return undefined;
    };
    const onListening = () => {
      server.removeListener("error", onError);
      panelRuntime.server = server;
      panelRuntime.port = server.address().port;
      panelRuntime.error = null;
      panelRuntime.starting = false;
      // 不让这个监听吊住宿主/测试的事件循环。
      if (typeof server.unref === "function") server.unref();
      writeJson(panelPortPath(), { port: panelRuntime.port, at: new Date().toISOString() });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    try {
      server.listen(port, "127.0.0.1");
    } catch (e) {
      panelRuntime.error = String((e && e.message) || e);
      panelRuntime.starting = false;
    }
    return undefined;
  };

  panelRuntime.starting = true;
  tryListen();
  return panelRuntime;
}

export function panelRuntimeState() {
  return { port: panelRuntime.port, error: panelRuntime.error, started: Boolean(panelRuntime.server) };
}
