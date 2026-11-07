import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJson, stateRoot, writeJson } from "./state.js";
import { disabledPath } from "./ledger.js";

/**
 * 运行时偏好 —— 面板上那些开关真正落到的位置。
 *
 * 三个来源，优先级从高到低：
 *   1. `state/pierce/disabled.json` 存在  → 硬关闭（命令行/排障用）
 *   2. cordis 配置 `enabled: false`      → 硬关闭（patch 层写的）
 *   3. `state/pierce/prefs.json`         → 运行时开关（面板写的就是它）
 *
 * 为什么不做成"面板改配置、重启生效"：宿主只在启动时 apply 一次，段的注册
 * 只发生在那一次。要让开关下一轮就生效，只有一条路 —— **段与钩子始终注册**，
 * 内容与是否处理在每次组装时现读偏好（sections.js / index.js 都是这么写的）。
 */

const DEFAULTS = {
  enabled: true,
  profile: "auto",
  sections: { core: true, post: true },
  layers: { assemble: true, refresh: true },
  policy: { mode: "rewrite", criteria: "aggressive" },
  ledger: true,
  trace: true,
};

export const DEFAULT_PREFS = deepFreeze(DEFAULTS);

/**
 * 预设 = 常用组合。patch 是**部分**覆盖，不是整体替换：
 * 点「只注入」不会顺手把 policy.mode 改回去。
 */
export const PRESETS = {
  full: {
    label: "全开",
    hint: "两段 + 两层改写",
    patch: {
      enabled: true,
      sections: { core: true, post: true },
      layers: { assemble: true, refresh: true },
      policy: { mode: "rewrite", criteria: "aggressive" },
    },
  },
  inject: {
    label: "只注入",
    hint: "两段注入，不动政策句",
    patch: { enabled: true, sections: { core: true, post: true }, layers: { assemble: false, refresh: false } },
  },
  filter: {
    label: "只过滤",
    hint: "两段清空，只改政策句",
    patch: { enabled: true, sections: { core: false, post: false }, layers: { assemble: true, refresh: true } },
  },
  off: {
    label: "关闭",
    hint: "不注入、不改写",
    patch: { enabled: false },
  },
};

const MODES = ["rewrite", "drop"];
const CRITERIA = ["aggressive", "structural"];

export function prefsPath() {
  return path.join(stateRoot(), "prefs.json");
}

export function switchLogPath() {
  return path.join(stateRoot(), "switch.jsonl");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

const bool = (value, fallback) => (typeof value === "boolean" ? value : fallback);

export function normalizePrefs(input) {
  const raw = input && typeof input === "object" ? input : {};
  const d = DEFAULTS;
  return {
    enabled: bool(raw.enabled, d.enabled),
    profile: typeof raw.profile === "string" && raw.profile.trim() ? raw.profile.trim().slice(0, 40) : d.profile,
    sections: {
      core: bool(raw?.sections?.core, d.sections.core),
      post: bool(raw?.sections?.post, d.sections.post),
    },
    layers: {
      assemble: bool(raw?.layers?.assemble, d.layers.assemble),
      refresh: bool(raw?.layers?.refresh, d.layers.refresh),
    },
    policy: {
      mode: MODES.includes(raw?.policy?.mode) ? raw.policy.mode : d.policy.mode,
      criteria: CRITERIA.includes(raw?.policy?.criteria) ? raw.policy.criteria : d.policy.criteria,
    },
    ledger: bool(raw.ledger, d.ledger),
    trace: bool(raw.trace, d.trace),
  };
}

/** 文件里的原始偏好（可能为 null = 从未写过）。 */
export function readPrefsFile() {
  return readJson(prefsPath(), null);
}

export function prefsMtime() {
  try {
    return fs.statSync(prefsPath()).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * 本次生效的偏好（叠上两个硬关闭来源）。
 * 热路径：每次组装都会调一次，只读一个几百字节的文件，不缓存 ——
 * 缓存会让"改了不生效"和"没改却生效"两种事故同时变得可能。
 */
export function resolvePrefs(config = {}) {
  const file = readPrefsFile();
  const prefs = normalizePrefs(file);
  const offBy = [];
  if (config && config.enabled === false) offBy.push("config");
  let disabled = null;
  try {
    disabled = readJson(disabledPath(), null);
  } catch {
    disabled = null;
  }
  if (disabled) offBy.push("disabled-file");
  return {
    ...prefs,
    enabled: prefs.enabled && offBy.length === 0,
    offBy,
    source: file ? "prefs.json" : "defaults",
    mtime: prefsMtime(),
  };
}

function normalizePatch(input) {
  const raw = input && typeof input === "object" ? input : {};
  const out = {};
  const requireBool = (value, name) => {
    if (typeof value !== "boolean") throw new Error(`${name} 必须是布尔值`);
    return value;
  };
  if (raw.enabled !== undefined) out.enabled = requireBool(raw.enabled, "enabled");
  if (raw.profile !== undefined) {
    const value = String(raw.profile ?? "").trim();
    if (!value || value.length > 40) throw new Error("profile 必须是非空字符串（≤40 字符）");
    out.profile = value;
  }
  if (raw.ledger !== undefined) out.ledger = requireBool(raw.ledger, "ledger");
  if (raw.trace !== undefined) out.trace = requireBool(raw.trace, "trace");
  if (raw.sections !== undefined) {
    const s = raw.sections && typeof raw.sections === "object" ? raw.sections : {};
    out.sections = {};
    for (const key of ["core", "post"]) {
      if (s[key] !== undefined) out.sections[key] = requireBool(s[key], `sections.${key}`);
    }
    if (!Object.keys(out.sections).length) throw new Error("sections 只接受 core / post");
  }
  if (raw.layers !== undefined) {
    const l = raw.layers && typeof raw.layers === "object" ? raw.layers : {};
    out.layers = {};
    for (const key of ["assemble", "refresh"]) {
      if (l[key] !== undefined) out.layers[key] = requireBool(l[key], `layers.${key}`);
    }
    if (!Object.keys(out.layers).length) throw new Error("layers 只接受 assemble / refresh");
  }
  if (raw.policy !== undefined) {
    const p = raw.policy && typeof raw.policy === "object" ? raw.policy : {};
    out.policy = {};
    if (p.mode !== undefined) {
      if (!MODES.includes(String(p.mode))) throw new Error(`policy.mode 只能是 ${MODES.join(" / ")}`);
      out.policy.mode = String(p.mode);
    }
    if (p.criteria !== undefined) {
      if (!CRITERIA.includes(String(p.criteria))) throw new Error(`policy.criteria 只能是 ${CRITERIA.join(" / ")}`);
      out.policy.criteria = String(p.criteria);
    }
    if (!Object.keys(out.policy).length) throw new Error("policy 只接受 mode / criteria");
  }
  if (!Object.keys(out).length && raw.preset === undefined) {
    throw new Error("没有任何有效字段（enabled / sections / layers / policy / ledger / trace / preset）");
  }
  return out;
}

function merge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = { ...(base[key] || {}), ...value };
    } else {
      out[key] = value;
    }
  }
  return out;
}

const same = (a, b) => JSON.stringify(normalizePrefs(a)) === JSON.stringify(normalizePrefs(b));

function appendSwitchLog(row) {
  appendJsonl(switchLogPath(), { at: new Date().toISOString(), ...row });
}

export function readSwitchLog(limit = 8) {
  let text = "";
  try {
    text = fs.readFileSync(switchLogPath(), "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 坏行跳过 */
    }
  }
  return rows.slice(-limit).reverse();
}

/** 应用一次切换。非法字段抛错（路由层翻成 400）。 */
export function applyPrefs(input, config = {}) {
  const raw = input && typeof input === "object" ? input : {};
  let patch = normalizePatch(raw);
  if (raw.preset !== undefined) {
    const preset = PRESETS[String(raw.preset)];
    if (!preset) throw new Error(`未知预设：${raw.preset}（可选 ${Object.keys(PRESETS).join(" / ")}）`);
    patch = merge(preset.patch, patch);
  }
  const before = resolvePrefs(config);
  const next = normalizePrefs(merge(readPrefsFile() || DEFAULTS, patch));
  const after = { ...next, enabled: next.enabled && before.offBy.length === 0, offBy: before.offBy, source: "prefs.json", mtime: null };
  // 值没变就不写：否则切换日志时间永远比组装快照新，面板会一直挂着"待组装"。
  const noop = same(before, next) && before.source === "prefs.json";
  if (!noop) {
    writeJson(prefsPath(), next);
    appendSwitchLog({ patch, before: pick(before), after: pick(next), via: "panel" });
  }
  return { patch, before: pick(before), after: pick(next), noop, prefs: resolvePrefs(config) };
}

/** 复位 = 删掉 prefs.json，回到默认（config 与 disabled.json 不受影响）。 */
export function resetPrefs(config = {}) {
  const before = resolvePrefs(config);
  let removed = false;
  try {
    fs.rmSync(prefsPath(), { force: true });
    removed = true;
  } catch {
    removed = false;
  }
  const after = resolvePrefs(config);
  const noop = same(before, after);
  if (!noop) appendSwitchLog({ patch: { reset: true }, before: pick(before), after: pick(after), via: "panel" });
  return { before: pick(before), after: pick(after), noop, removed };
}

function pick(prefs) {
  const p = normalizePrefs(prefs);
  return {
    enabled: Boolean(prefs?.enabled ?? p.enabled),
    profile: p.profile,
    sections: p.sections,
    layers: p.layers,
    policy: p.policy,
    ledger: p.ledger,
    trace: p.trace,
  };
}

/** 当前落在哪个预设上（不在四个里就是 custom）。 */
export function activePreset(prefs) {
  const p = normalizePrefs(prefs);
  if (!p.enabled) return "off";
  const s = p.sections;
  const l = p.layers;
  const allSections = s.core && s.post;
  const noSections = !s.core && !s.post;
  const allLayers = l.assemble && l.refresh;
  const noLayers = !l.assemble && !l.refresh;
  if (allSections && allLayers) return "full";
  if (allSections && noLayers) return "inject";
  if (noSections && allLayers) return "filter";
  return "custom";
}
