#!/usr/bin/env node
/**
 * 客户端半边的渲染冒烟测试：不开浏览器、不装宿主。
 *
 * 做法：用假的 __ModuleLoader__ 抓住 factory，用假 React 把 useState 的初值
 * 换掉（先把面板打开、再塞一份真实的 buildState() 结果），然后真跑一遍
 * PierceBar()。目的是把整棵渲染树执行一次 —— 少写一个属性、引错一个变量，
 * 这里就当场红，而不是等用户重启后对着空白面板猜。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pierce-render-"));
process.env.PIERCE_NO_PANEL = "1";

const { buildState } = await import("../plugin/panel.js");

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok: Boolean(ok), detail });
  if (!ok) console.log(`FAIL ${id} — ${detail}`);
};

// ---- 假宿主环境 ------------------------------------------------------------
const captured = [];
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured.push(spec);
    },
  },
};

const fakeReact = {
  useState(initial) {
    return [initial, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
};

const fixture = buildState({});
const queue = [true, fixture, null, false, null]; // open / state / error / busy / notice
let cursor = 0;
fakeReact.useState = (initial) => {
  const value = cursor < queue.length ? queue[cursor] : initial;
  cursor += 1;
  return [value, () => {}];
};

// ---- 载入客户端 bundle -----------------------------------------------------
const source = fs.readFileSync(new URL("../plugin/client.js", import.meta.url), "utf8");
// 客户端 bundle 是 CJS 风格的 window 全局注册：在隔离作用域里跑一遍
const runner = new Function("window", "require", source);
const requireStub = (name) => {
  if (name === "react") return fakeReact;
  throw new Error(`未预期的模块请求：${name}`);
};
runner(globalThis.window, requireStub);

check("R1", captured.length === 1 && captured[0].id === "dsh-pierce", `注册 id：${captured[0] && captured[0].id}`);
const mod = captured[0].factory(requireStub);
check("R2", typeof mod.PierceBar === "function" && typeof mod.apply === "function", "导出 PierceBar / apply");
check("R3", Array.isArray(mod.inject) && mod.inject.includes("slots"), `inject：${JSON.stringify(mod.inject)}`);

// ---- 真跑一遍渲染 ----------------------------------------------------------
let tree = null;
let renderError = null;
try {
  tree = mod.PierceBar();
} catch (e) {
  renderError = `${(e && e.stack) || e}`;
}
check("R4", renderError === null, `渲染不抛错${renderError ? `：${renderError.split("\n")[0]}` : ""}`);

const textOf = (node) => {
  if (node === null || node === undefined || node === true || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return ` ${node}`;
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = node.props || {};
  const extra = [props.title, props["aria-label"], props["data-text"]].filter(Boolean).join(" ");
  return `${extra ? ` ${extra}` : ""}${textOf(node.children)}`;
};
const text = textOf(tree);

const wants = [
  ["R5", "pierce 穿透台", "标题"],
  ["R6", "破甲已启用", "总开关状态"],
  ["R7", "自由开关", "开关区"],
  ["R9", "装配层", "装配层开关"],
  ["R10", "消息层", "消息层开关"],
  ["R11", "账本", "账本开关"],
  ["R12", "处置", "处置方式"],
  ["R13", "改写", "处置选项"],
  ["R14", "判据", "判据档位"],
  ["R15", "结构", "判据选项"],
  ["R16", `版本 ${fixture.version.local}`, "版本号"],
  ["R17", "检查更新", "更新按钮"],
  ["R18", "检查项", "证据表表头"],
  ["R19", "装配层改写", "证据表行"],
  ["R20", "审计", "审计区"],
  ["R21", "运行审计", "审计按钮"],
  ["R22", "重置", "占位检查用的无关词——不该出现"], // 见下方反例
  ["R23", "复位", "复位按钮"],
  ["R24", "学习与研究用途", "声明行"],
  ["R25", "全开", "预设"],
  ["R26", "关闭", "预设"],
];
for (const [id, needle, label] of wants) {
  const hit = text.includes(needle);
  if (id === "R22") {
    // 反例：这个词不该出现在面板上（防止把"重置"这种旧文案又写回来）
    check(id, hit === false, hit ? `不该出现「${needle}」` : "反例成立（面板里没有「重置」）");
    continue;
  }
  check(id, hit, `${label}：${hit ? "出现" : "没出现"}「${needle}」`);
}

// 关掉总开关时：应显示"已停用"、且给出"点此启用"
cursor = 0;
queue[1] = { ...fixture, prefs: { ...fixture.prefs, effective: { ...fixture.prefs.effective, enabled: false } }, evidence: { ...fixture.evidence, dock: "破甲·关", badge: { text: "已关闭", tone: "off" } } };
const offTree = mod.PierceBar();
const offText = textOf(offTree);
check("R27", offText.includes("破甲已停用") && offText.includes("点此启用"), "停用状态有对应文案");
check("R28", offText.includes("破甲·关"), "停用状态下的按钮标签");

// 出错时：错误信息必须原样显示在面板里，而不是静默
cursor = 0;
queue[2] = "面板服务没响应：宿主没注册 /pierce/api";
const errText = textOf(mod.PierceBar());
check("R29", errText.includes("面板服务没响应"), "错误信息可见");

// ---- 交互：按钮点下去真的会发对应请求 --------------------------------------
const requests = [];
globalThis.fetch = async (url, init) => {
  const path = String(url);
  requests.push({ path, method: (init && init.method) || "GET", body: init && init.body ? JSON.parse(init.body) : null });
  let payload = { ok: true, service: "pierce-panel" };
  if (path.endsWith("/state")) payload = fixture;
  else if (path.endsWith("/prefs")) payload = { ok: true, applied: { noop: false }, state: fixture };
  else if (path.endsWith("/reset")) payload = { ok: true, applied: { noop: false }, state: fixture };
  else if (path.endsWith("/audit")) payload = { ok: true, audit: { findingsTotal: 0, checked: 60, findings: [] }, state: fixture };
  else if (path.endsWith("/update/check")) payload = { ok: true, update: { ok: true, latest: "0.2.0", local: "0.2.0", updateAvailable: false }, state: fixture };
  else if (path.endsWith("/update/apply")) payload = { ok: true, result: { ok: false, mode: "manual", error: "开发挂载" }, state: fixture };
  else if (path.endsWith("/restart")) payload = { ok: true, restart: { path: "C:\\x\\restart.cmd" } };
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
};

// 换回"启用中"的那份 fixture（前面的用例把队列改成了关闭态）
queue[1] = fixture;
queue[2] = null;
cursor = 0;
const liveTree = mod.PierceBar();
const buttons = [];
const collect = (node) => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach(collect);
    return;
  }
  if (node.type === "button" && node.props && typeof node.props.onClick === "function") buttons.push(node);
  collect(node.children || []);
};
collect(liveTree);
const ownText = (node) => textOf(node.children).replace(/\s+/g, " ").trim();
const click = async (needle) => {
  const button = buttons.find((item) => ownText(item) === needle) || buttons.find((item) => ownText(item).includes(needle));
  if (!button) throw new Error(`找不到按钮：${needle}（现有：${buttons.map(ownText).join(" / ")}）`);
  await button.props.onClick();
};
const find = (needle) => requests.filter((item) => item.path.includes(needle));

let clickError = null;
try {
  await click("只注入");
  await click("运行审计");
  await click("检查更新");
  await click("正文");
  await click("复位");
  await click("尾段");
  await click("刷新");
  await click("破甲已启用");
} catch (e) {
  clickError = String((e && e.message) || e);
}
check("R33", clickError === null, `按钮可点${clickError ? `：${clickError}` : ""}`);
check("R34", find("/prefs").some((item) => item.body && item.body.sections && item.body.sections.core === false), "点「正文」→ POST /prefs {sections:{core:false}}");
check("R35", find("/prefs").some((item) => item.body && item.body.preset === "inject"), "点「只注入」→ POST /prefs {preset:inject}");
check("R36", find("/prefs").some((item) => item.body && item.body.enabled === false), "点总开关 → POST /prefs {enabled:false}");
check("R37", find("/audit").length >= 1 && find("/audit")[0].method === "POST", "点「运行审计」→ POST /audit");
check("R38", find("/update/check").length >= 1, "点「检查更新」→ POST /update/check");
check("R39", find("/reset").length >= 1 && find("/reset")[0].method === "POST", "点「复位」→ POST /reset");
check("R40", find("/state").some((item) => item.method === "GET"), "点「刷新」→ GET /state");
check("R41", find("/ping").length === 1, "同源基址只探测一次（之后走缓存）");
check("R42", requests.every((item) => item.path.startsWith("/pierce/api") || item.path.startsWith("http://127.0.0.1:73")), "所有请求都指向面板服务");
check("R43", find("/state").length === 1, "动作后用返回的 state 刷新，只有点「刷新」才重新拉取（少一次往返）");
check("R47", find("/prefs").some((item) => item.body && item.body.sections && item.body.sections.post === false), "点「尾段」→ POST /prefs {sections:{post:false}}");

// ---- 插槽注册 --------------------------------------------------------------
const registrations = [];
const ctx = {
  effect(fn) {
    fn();
    return () => {};
  },
  slots: {
    inject(name, factory) {
      registrations.push({ name, factory });
      factory(); // 真宿主在插槽就绪时会调用它
    },
    register(spec, component) {
      registrations.push({ spec, component });
      return () => {};
    },
  },
};
globalThis.document = { head: { appendChild() {} }, createElement: () => ({ setAttribute() {}, textContent: "" }) };
mod.apply(ctx);
const injected = registrations.find((item) => item.name === "conversation.input.activity");
const registered = registrations.find((item) => item.spec);
check("R30", Boolean(injected) && typeof injected.factory === "function", "注入 conversation.input.activity");
check("R31", registered && registered.spec.name === "conversation.input.activity" && registered.spec.key === "pierce", `注册键：${registered && registered.spec.key}`);
check("R32", registered && registered.component === mod.PierceBar, "注册的就是面板组件");

const failed = results.filter((item) => !item.ok);
console.log("");
console.log(`client-render: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
try {
  fs.rmSync(process.env.DSH_HOME, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exitCode = failed.length ? 1 : 0;
