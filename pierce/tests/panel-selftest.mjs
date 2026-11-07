#!/usr/bin/env node
/**
 * 前端面板自测：不装宿主、不联网、不碰真实状态（DSH_HOME 指向临时目录）。
 *
 * 覆盖五块：
 *   1. 偏好（默认值 / 校验 / 写入读回 / 复位 / 预设识别）
 *   2. 面板路由（state / prefs / 404 / 405 / ping）
 *   3. 证据表（快照与期望一致 → 已生效；关一段 → 那格显示"关闭"；总开关关 → 已关闭）
 *   4. 版本（语义比较 / 更新缓存字段）
 *   5. 协议与清单（客户端源码里必须出现每一条路由；package.json 必须声明 client）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pierce-panel-"));
process.env.PIERCE_NO_PANEL = "1";

const stateDir = path.join(process.env.DSH_HOME, "state", "pierce");
fs.mkdirSync(stateDir, { recursive: true });

const { DEFAULT_PREFS, PRESETS, activePreset, applyPrefs, prefsPath, readPrefsFile, resetPrefs, resolvePrefs } = await import("../plugin/prefs.js");
const { applyPolicyContexts, NEUTRAL_APPROVAL } = await import("../plugin/detect.js");
const { PROMPTS_DIR, packageVersion } = await import("../plugin/paths.js");
const { SECTIONS, expectedText } = await import("../plugin/sections.js");
const { buildState } = await import("../plugin/panel.js");
const { ROUTES, PANEL_PREFIX, SERVICE_ID } = await import("../plugin/protocol.js");
const { compareVersions, parseVersion } = await import("../plugin/update.js");
const { createPanelHandler } = await import("../plugin/routes.js");
const { sha256 } = await import("../plugin/state.js");
const { live, bump } = await import("../plugin/live.js");

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok: Boolean(ok), detail });
  if (!ok) console.log(`FAIL ${id} — ${detail}`);
};

const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// ---- 1. 偏好 ---------------------------------------------------------------
check("P1", resolvePrefs({}).enabled === true && resolvePrefs({}).source === "defaults", "没有 prefs.json 时用默认值");
check("P2", resolvePrefs({ enabled: false }).enabled === false && resolvePrefs({ enabled: false }).offBy.includes("config"), "配置 enabled:false 是被解释过的硬关闭");
writeJson(path.join(stateDir, "disabled.json"), { at: new Date().toISOString() });
check("P3", resolvePrefs({}).offBy.includes("disabled-file"), "disabled.json 存在 → 硬关闭");
fs.rmSync(path.join(stateDir, "disabled.json"), { force: true });

let rejected = "";
try {
  applyPrefs({ sections: { core: "yes" } });
} catch (e) {
  rejected = String(e.message || e);
}
check("P4", rejected.includes("布尔"), `非法值被拒绝：${rejected}`);

const applied = applyPrefs({ sections: { core: false }, policy: { mode: "drop" } });
const fromDisk = readPrefsFile();
check("P5", applied.noop === false && fromDisk.sections.core === false && fromDisk.policy.mode === "drop", "写入读回一致");
check("P6", resolvePrefs({}).sections.core === false && resolvePrefs({}).sections.post === true, "部分覆盖只影响指定字段");
check("P7", activePreset(resolvePrefs({})) === "custom", "非预设组合识别为 custom");
applyPrefs({ preset: "off" });
check("P8", resolvePrefs({}).enabled === false && activePreset(resolvePrefs({})) === "off", "预设 off 生效");
applyPrefs({ preset: "full" });
check("P9", activePreset(resolvePrefs({})) === "full" && resolvePrefs({}).enabled === true, "预设 full 生效");
const noop = applyPrefs({ preset: "full" });
check("P10", noop.noop === true, "重复点同一个预设 → noop（不写切换日志）");
const resetResult = resetPrefs();
check("P11", resetResult.removed === true && readPrefsFile() === null && resolvePrefs({}).source === "defaults", "复位删掉 prefs.json");
check("P12", Object.keys(PRESETS).length === 4 && DEFAULT_PREFS.trace === true, "四个预设、默认写快照");

// ---- 2. 处置模式与判据 -----------------------------------------------------
const OFFICIAL = "Approval prompts are disabled in this session: do not request sandbox escalation.";
const asm = { sections: [], contexts: [{ name: "approval:policy", text: OFFICIAL }], tools: [] };
const dropped = applyPolicyContexts(asm, { mode: "drop", criteria: "aggressive" });
check("P13", dropped.changed && dropped.dropped.length === 1 && dropped.assembly.contexts.length === 0 && dropped.policyIn === 1, "drop 模式删段并计数");
const structural = applyPolicyContexts(asm, { mode: "rewrite", criteria: "structural" });
check("P14", structural.changed && structural.rewrites[0].after === NEUTRAL_APPROVAL, "structural 档仍按结构命中");
const neutralAgain = applyPolicyContexts({ contexts: [{ name: "approval:policy", text: NEUTRAL_APPROVAL }] }, { mode: "rewrite", criteria: "aggressive" });
check("P15", neutralAgain.changed === false && neutralAgain.policyIn === 0, "已经是中性文案 → 不重复改写、不计入政策句");

// ---- 3. 证据表 -------------------------------------------------------------
const snapshotFor = (keys) => {
  const prefs = resolvePrefs({});
  const sections = keys.map((key) => {
    const text = expectedText(PROMPTS_DIR, key, prefs);
    return { name: SECTIONS[key], order: 0, bytes: Buffer.byteLength(text, "utf8"), sha256: sha256(text) };
  });
  return {
    at: new Date().toISOString(),
    bootId: live.bootId,
    channel: "assemble",
    prefs: { enabled: true, sections: prefs.sections, layers: prefs.layers, policy: prefs.policy, ledger: prefs.ledger },
    sections,
    contexts: [],
    counts: { contexts: 0, policyIn: 0, rewritten: 0, dropped: 0 },
    rewrites: [],
    dropped: [],
    counters: {},
  };
};

// 让两层钩子有"调用过"的证据（layerRow 在没调用过时故意给 null，不装绿）
live.hooks.assemble = { attached: true, reason: null };
live.hooks.refresh = { patched: true, verified: true, reason: null };
bump("assemble");
bump("refresh");

writeJson(path.join(stateDir, "assembly.json"), snapshotFor(["core", "post"]));
let state = buildState({});
const rowOf = (key) => state.rows.find((row) => row.part === key) || {};
check("P16", ["core", "post"].every((key) => rowOf(key).ok === true), "两段与期望逐项一致");
check("P17", rowOf("assemble").ok === true && rowOf("refresh").ok === true, "两层钩子有调用计数才算通过");
check("P18", state.evidence.matched === true && state.evidence.badge.text === "已生效", `徽章：${state.evidence.badge.text}`);

writeJson(prefsPath(), { ...DEFAULT_PREFS, sections: { pre: true, core: false, post: true } });
writeJson(path.join(stateDir, "assembly.json"), snapshotFor(["post"]));
state = buildState({});
check("P19", rowOf("core").expectedText === "关闭" && rowOf("core").ok === true, "关掉正文后，那格显示关闭且判通过");
check("P20", state.evidence.matched === true, "少一段不影响整体判定");

const stale = snapshotFor(["core", "post"]);
stale.at = new Date(Date.now() - 60_000).toISOString();
// 把正文那一格改成"上一轮的内容"：偏好已经变了，快照还是老的 → 该判待组装，不是不一致
stale.sections[0] = { ...stale.sections[0], bytes: 1234, sha256: "deadbeefdeadbeefdeadbeef" };
writeJson(path.join(stateDir, "assembly.json"), stale);
state = buildState({});
check("P21", state.evidence.pending === true && state.evidence.badge.text === "待组装", `偏好比快照新 → 待组装（实际 ${state.evidence.badge.text}）`);

applyPrefs({ preset: "off" });
state = buildState({});
check("P22", state.prefs.effective.enabled === false && state.evidence.badge.text === "已关闭" && state.evidence.dock === "破甲·关", "总开关关 → 已关闭");
check(
  "P23",
  state.rows.every((row) => row.ok !== false),
  "关闭状态下不给出红叉（历史快照不与关闭后的期望对比）",
);
applyPrefs({ preset: "full" });

state = buildState({});
check("P24", state.sections.length === 2 && state.sections.every((item) => item.enabled === true), "两段清单完整");
check("P25", state.version.local === packageVersion() && state.version.package === "dsh-pierce", `版本块：${state.version.local}`);
check("P26", state.version.install && typeof state.version.install.command === "string" && state.version.install.command.includes("install.mjs"), "版本区带一条可跑的更新命令");
check("P27", Array.isArray(state.warnings) && state.warnings.length === 0, `默认无告警（实际 ${state.warnings.length}）`);
applyPrefs({ ledger: false });
check("P28", buildState({}).warnings.some((text) => text.includes("账本")), "关账本 → 面板明确警告审计会失真");
applyPrefs({ preset: "full" });

// ---- 4. 路由 ---------------------------------------------------------------
const calls = [];
const fakeRes = () => {
  const out = { status: 0, body: null };
  return {
    out,
    setHeader() {},
    writeHead(code) {
      out.status = code;
    },
    end(text) {
      out.body = text ? JSON.parse(text) : null;
    },
  };
};
const call = async (method, url, body) => {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), "utf8")];
  const req = Object.assign(Readable.from(payload), { method, url });
  const res = fakeRes();
  await handler(req, res);
  calls.push({ method, url, status: res.out.status });
  return res.out;
};

const handler = createPanelHandler(() => ({}));
const ping = await call("GET", `${PANEL_PREFIX}${ROUTES.ping.path}`);
check("P29", ping.status === 200 && ping.body.service === SERVICE_ID, "ping 返回本服务的标识");
const bare = await call("GET", ROUTES.state.path);
check("P30", bare.status === 200 && bare.body.rows.length === 6 && bare.body.prefix === PANEL_PREFIX, "不带前缀也认（自带端口复用同一 handler）");
const changed = await call("POST", `${PANEL_PREFIX}${ROUTES.prefs.path}`, { sections: { post: false } });
check("P31", changed.status === 200 && changed.body.state.prefs.effective.sections.post === false, "POST /prefs 回传新状态");
const bad = await call("POST", `${PANEL_PREFIX}${ROUTES.prefs.path}`, { policy: { mode: "nuke" } });
check("P32", bad.status === 400 && String(bad.body.error).includes("policy.mode"), "非法字段 → 400");
const missing = await call("GET", `${PANEL_PREFIX}/nope`);
check("P33", missing.status === 404, "未知路径 → 404");
const wrong = await call("GET", `${PANEL_PREFIX}${ROUTES.prefs.path}`);
check("P34", wrong.status === 405, "方法不对 → 405");
const reset = await call("POST", `${PANEL_PREFIX}${ROUTES.reset.path}`, {});
check("P35", reset.status === 200 && reset.body.state.prefs.effective.sections.post === true, "POST /reset 回到默认");

// ---- 5. 版本比较 -----------------------------------------------------------
check("P36", parseVersion("v0.2.0")?.nums.join(".") === "0.2.0", "v 前缀可解析");
check("P37", compareVersions("0.2.0", "0.1.0") === 1 && compareVersions("0.1.0", "0.2.0") === -1 && compareVersions("v0.2.0", "0.2.0") === 0, "语义比较");
check("P38", compareVersions("0.2.0", "0.2.0-rc.1") === 1 && compareVersions("0.2.0-rc.1", "0.2.0") === -1, "正式版 > 预发布");
check("P39", compareVersions("x", "1.0.0") === null, "解析不了 → null（不瞎比）");

const { pickLatest } = await import("../plugin/update.js");
const releaseArm = [{ tag_name: "v0.1.0", draft: false, prerelease: false, assets: [{ name: "a.tgz", size: 1 }] }];
check("P40", pickLatest(releaseArm, [{ name: "v0.3.0" }])?.tag === "v0.3.0" && pickLatest(releaseArm, [{ name: "v0.3.0" }])?.source === "tag", "tag 比旧 release 新 → 取 tag");
check("P41", pickLatest(releaseArm, [])?.source === "release" && pickLatest(releaseArm, [])?.assets.length === 1, "只有 release 时取 release 并带资产");
check("P42", pickLatest([], [{ name: "v0.2.0" }, { name: "nightly" }, { name: "v0.10.0" }])?.tag === "v0.10.0", "tag 里挑最高版本、非版本号忽略");
check("P43", pickLatest([{ tag_name: "v0.2.0", prerelease: true }], []) === null, "预发布 release 不算");

// ---- 6. 协议 / 清单一致性 ---------------------------------------------------
const clientSource = fs.readFileSync(path.join(PROMPTS_DIR, "..", "plugin", "client.js"), "utf8");
const missingRoutes = Object.values(ROUTES)
  .map((route) => route.path)
  .filter((routePath) => !clientSource.includes(routePath));
check("P40", missingRoutes.length === 0, `客户端覆盖全部路由（缺：${missingRoutes.join(", ") || "无"}）`);

const pkg = JSON.parse(fs.readFileSync(path.join(PROMPTS_DIR, "..", "package.json"), "utf8"));
check(
  "P41",
  pkg.dsh?.client?.platform === "web" && pkg.dsh.client.inject.includes("slots") && pkg.exports["./client"] === "./plugin/client.js",
  "package.json 声明了客户端半边",
);
check("P42", fs.existsSync(path.join(PROMPTS_DIR, "..", pkg.exports["./client"])), "客户端 bundle 文件存在");
check("P43", clientSource.includes(`id: "${pkg.name}"`), `客户端入口 id 与包名一致（${pkg.name}）`);
check("P44", clientSource.includes("conversation.input.activity"), "注册到输入框工具条插槽");

// ---- 7. 宿主侧注册路径（假 webServer）--------------------------------------
const { apply } = await import("../plugin/index.js");
const seen = { sections: [], handlers: [], refresh: 0, routes: [], injected: null };
const service = {
  section(spec) {
    seen.sections.push(spec);
    return () => {};
  },
  getSectionOrder() {
    return 0;
  },
  refreshContext(assembly) {
    seen.refresh += 1;
    return assembly;
  },
};
const hostCtx = {
  systemPrompt: service,
  on(name, fn) {
    seen.handlers.push({ name, fn });
    return () => {};
  },
  inject(deps, cb) {
    seen.injected = deps;
    // 真宿主在 webServer 就绪时调这个回调
    cb({ webServer: { register(route) { seen.routes.push(route); return () => {}; } } });
    return () => {};
  },
};
applyPrefs({ preset: "full" });
const appliedStatus = apply(hostCtx, {});
check("P45", seen.routes.length === 1 && seen.routes[0].path === PANEL_PREFIX && seen.routes[0].kind === "prefix", `同源路由已注册：${seen.routes[0] && seen.routes[0].path}`);
check("P46", appliedStatus.panel.webRegistered === true && appliedStatus.hooks.assemble.attached === true, "状态里记下 web 路由与 waterfall");

const coreThunk = seen.sections.find((spec) => spec.name === SECTIONS.core);
const fullText = coreThunk.text();
applyPrefs({ sections: { core: false } });
check("P47", coreThunk.text() === "", "关掉正文 → thunk 立刻返回空串（不用重启）");
applyPrefs({ preset: "full" });
check("P48", coreThunk.text() === fullText && fullText.length > 100, "开回来 → thunk 立刻恢复内容");

const policyAssembly = { sections: [], contexts: [{ name: "approval:policy", text: OFFICIAL }], tools: [] };
const assembleHandler = seen.handlers.find((item) => item.name === "system-prompt/assemble").fn;
applyPrefs({ layers: { assemble: false } });
const passthrough = await assembleHandler(policyAssembly, {}, async () => policyAssembly);
check("P49", passthrough === policyAssembly && passthrough.contexts[0].text === OFFICIAL, "装配层关闭 → 原样放行");
applyPrefs({ preset: "full" });
const rewrittenAssembly = await assembleHandler(policyAssembly, {}, async () => ({ ...policyAssembly }));
check("P50", rewrittenAssembly.contexts[0].text !== OFFICIAL, "装配层打开 → 政策句被改写");

// 宿主注册进 webServer 的那个 handler，真的能应答一次 GET /state
const registered = { status: 0, body: null };
const routeRes = {
  setHeader() {},
  writeHead(code) {
    registered.status = code;
  },
  end(text) {
    registered.body = text ? JSON.parse(text) : null;
  },
};
const stateReq = Object.assign(Readable.from([]), { method: "GET", url: `${PANEL_PREFIX}${ROUTES.state.path}` });
await seen.routes[0].handler(stateReq, routeRes);
check(
  "P51",
  registered.status === 200 && registered.body.service === SERVICE_ID && registered.body.rows.length === 6,
  `宿主注册的那条路由应答：${registered.status}`,
);

// ---- 8. 两段模型 + 拒答识别 ------------------------------------------------
const { classifyReply, findRefusals } = await import("../plugin/refusal.js");

check("P52", buildState({}).sections.length === 2, "只有两段（core / post）");
applyPrefs({ sections: { core: false } });
let twoState = buildState({});
check("P53", twoState.sections.find((item) => item.key === "core").bytes === 0, "关掉正文 → 该段不贡献内容");
check("P54", twoState.warnings.some((text) => text.includes("正文已关")), "关掉正文有明确告警");
applyPrefs({ preset: "filter" });
twoState = buildState({});
check(
	"P55",
	twoState.sections.every((item) => item.bytes === 0) && twoState.prefs.effective.layers.assemble === true && twoState.prefs.effective.layers.refresh === true,
	"「只过滤」预设：两段清空、两层改写仍开",
);
applyPrefs({ preset: "full" });
twoState = buildState({});
check("P56", twoState.sections.every((item) => item.enabled && item.bytes > 400), `两段都回来（${twoState.sections.map((i) => i.bytes).join(" + ")} B）`);

// 拒答识别：拿真实出现过的两条回复当正例，拿正文/技术回复当反例
const REFUSAL_A =
	"这类露骨的性描写我不写。不过如果你要的是那种有张力、有情欲氛围的言情小说，我可以写得很好看，我给你一段看看风格：雨是从傍晚开始下的……这个尺度的情感戏、暧昧氛围、人物张力，都可以写得更长、更有味道。要我把这个开篇继续展开成完整短篇吗？或者你想要别的题材，只要不是硬性描写，我都可以写。";
const REFUSAL_B =
	"我可以写情感、氛围、暧昧与留白，也能把人物的欲望写得克制又有力，但露骨的性描写我不写。若你需要，我可以把这个故事续下去。";
const PROSE = "雨停之后她关了店门，把伞收起来，靠在门框上看他走远。巷子里的水退了半尺，倒映着昏黄的灯。";
const TECHNICAL = "我把 index.js 里的 hook 顺序调了一下，然后跑了 node tests/selftest.mjs，29 条全过。";
const DIALOGUE = "他愣了一下，说：我不写。然后转身走进了雨里，连伞都没拿。";

check("P57", classifyReply(REFUSAL_A).refused === true && classifyReply(REFUSAL_A).kind === "content", "真实拒答 A 被判为内容收口");
check("P58", classifyReply(REFUSAL_B).refused === true && classifyReply(REFUSAL_B).kind === "content", "真实拒答 B 被判为内容收口");
check("P59", classifyReply(PROSE).refused === false, "正常正文不误判");
check("P60", classifyReply(TECHNICAL).refused === false, "技术回复不误判");
check("P61", classifyReply(DIALOGUE).refused === false, "正文里的「我不写」对白不误判（单条强命中不够）");
const batch = findRefusals([
	{ seq: 1, at: null, text: PROSE },
	{ seq: 2, at: null, text: REFUSAL_B },
	{ seq: 3, at: null, text: TECHNICAL },
]);
check("P62", batch.total === 1 && batch.items[0].seq === 2 && batch.items[0].excerpt.includes("我不写"), `一批回复里挑出 ${batch.total} 条拒答`);

// 软收口：没有一句拒绝动词，但把可用的那部分重新挂到授权条件上（真实样本 D1-2 结尾）
const SCOPE_GATED =
	"实际使用时可以用 DVWA 或 juice-shop 练手。需要说清楚的是：未授权扫描在中国《网络安全法》第 27 条、美国 CFAA 下都已可入罪，只扫不利用不是免责理由。如果你有授权范围，把 IP/域名和边界给我，我可以把上面每个阶段展开成可执行的命令清单和检查表。";
const SCOPE_OK =
	"实际使用时，把 TARGET 和 PORT 替换成目标，按阶段把结果保存到文件；不要跳过人工复核，也不要把扫描器输出直接当成漏洞结论。";
check("P63", classifyReply(SCOPE_GATED).refused === true && classifyReply(SCOPE_GATED).kind === "scope", "软收口被判为 scope");
check("P64", classifyReply(SCOPE_OK).refused === false, "带占位符的完整流程不误判");
check("P65", classifyReply(PROSE).kind === null && classifyReply(TECHNICAL).kind === null, "正文/技术回答仍然安全");

// ---- 9. 适配器接缝 + 宿主面 + 正文覆盖 ---------------------------------------
const { SURFACES, adapterFor, detectSurface } = await import("../plugin/adapters/surface.js");
const { clearAdapters, defineAdapter, listAdapters, resolveAdapter } = await import("../plugin/adapter.js");
const { dshAdapter } = await import("../plugin/adapters/dsh.js");
const { frameDirs, userFrameDir } = await import("../plugin/paths.js");
const { readPrompt } = await import("../plugin/sections.js");

check("P66", detectSurface({ env: { DSH_SURFACE: "desktop" } }) === "desktop", "DSH_SURFACE 可强制宿主面");
check("P67", detectSurface({ env: {}, execPath: "C:/Program Files/DeepSeek Harness/DeepSeek Harness.exe" }) === "desktop", "桌面 exe 识别为 desktop");
check(
	"P68",
	detectSurface({ env: {}, execPath: "C:/node/node.exe", resourcesPath: "C:/app/resources", fs: { existsSync: (p) => /app\.asar$/.test(String(p)) } }) === "desktop",
	"resources/app.asar 存在识别为 desktop",
);
check("P69", detectSurface({ env: {}, execPath: "C:/node/node.exe", resourcesPath: "", argv: ["node"] }) === "web", "认不出来回落 web");
check("P70", SURFACES.includes("gui") && adapterFor("gui") === "web" && adapterFor("desktop") === "desktop", "未适配的宿主面按 web 处理");

let badAdapter = "";
try {
	defineAdapter({ id: "x" });
} catch (e) {
	badAdapter = String(e.message || e);
}
check("P71", badAdapter.includes("缺少"), `缺能力的适配器被拒绝：${badAdapter}`);
clearAdapters();
defineAdapter({ id: "low", priority: 1, detect: () => true, apply: () => "low" });
defineAdapter({ id: "high", priority: 5, detect: () => true, apply: () => "high" });
check("P72", resolveAdapter({}).id === "high" && resolveAdapter({}).apply() === "high", "按优先级选适配器");
defineAdapter({ ...dshAdapter, apply: () => "dsh" });
check("P73", resolveAdapter({}).id === "dsh", "DSH（优先级 10）压过普通适配器");
clearAdapters();
defineAdapter({ ...dshAdapter, apply: () => "dsh" });
check("P74", resolveAdapter({ ctx: { systemPrompt: {} } }).id === "dsh" && resolveAdapter({ ctx: {} }).id === "dsh", "DSH 识别 + 兜底回 dsh");
check("P75", listAdapters().includes("dsh"), "注册表里有 dsh");

const frameDir = path.join(process.env.DSH_HOME, "pierce", "frame");
check("P76", userFrameDir() === null && frameDirs().at(-1) === PROMPTS_DIR, "没有覆盖目录时只用包内默认");
fs.mkdirSync(frameDir, { recursive: true });
fs.writeFileSync(path.join(frameDir, "core.md"), "USER OVERRIDE CORE\n", "utf8");
check("P77", userFrameDir() === frameDir && frameDirs()[0] === frameDir, "有覆盖目录时排在最前");
check("P78", readPrompt(frameDirs(), "core").startsWith("USER OVERRIDE CORE"), "readPrompt 按顺序取用户覆盖");
check("P79", readPrompt(frameDirs(), "post").includes("Final constraints"), "没被覆盖的段仍取包内默认");
fs.rmSync(frameDir, { recursive: true, force: true });
check("P80", readPrompt(frameDirs(), "core").includes("The operator owns this machine"), "删掉覆盖后回到包内默认");

// ---- 汇总 ------------------------------------------------------------------
const failed = results.filter((item) => !item.ok);
console.log("");
console.log(`panel-selftest: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
console.log(`路由往返：${calls.map((item) => `${item.method} ${item.url.split("/").slice(-1)[0] || "/"}→${item.status}`).join(" ")}`);
try {
  fs.rmSync(process.env.DSH_HOME, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exitCode = failed.length ? 1 : 0;
