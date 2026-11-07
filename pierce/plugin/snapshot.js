import path from "node:path";
import { readJson, sha256, stateRoot, writeJson } from "./state.js";
import { live } from "./live.js";
import { isPolicyText } from "./detect.js";
import { recordSectionAssets } from "./ledger.js";

/**
 * 装配快照：每完成一次组装，把「宿主这一轮实际拿到什么」写一份。
 *
 * 面板的证据表要拿它和"按当前偏好应该是什么"对比 —— 没有它，所有绿灯都是猜的
 * （旧项目正是靠这份快照才发现"面板显示已生效、实际一次没跑"）。
 *
 * 写入策略：签名变了才写（内容没变就不动文件），另外最多每 3 秒刷一次 `at`
 * 与计数，让面板看到的"最近组装"不是化石。
 */
const REFRESH_MS = 3000;
const state = { signature: "", lastWriteMs: 0, writes: 0 };

export function assemblyPath() {
  return path.join(stateRoot(), "assembly.json");
}

export function readAssemblySnapshot() {
  return readJson(assemblyPath(), null);
}

function describeSection(section) {
  const text = String(section?.text ?? "");
  return {
    name: String(section?.name ?? ""),
    order: Number.isFinite(section?.order) ? Number(section.order) : null,
    bytes: Buffer.byteLength(text, "utf8"),
    sha256: sha256(text),
  };
}

function describeContext(entry) {
  const text = String(entry?.text ?? "");
  return {
    name: String(entry?.name ?? ""),
    chars: text.length,
    sha256: sha256(text),
    policy: isPolicyText(text),
    preview: text.slice(0, 160),
  };
}

/**
 * @param {object} input
 * @param {object} input.assembly  改写之后的 assembly
 * @param {object} input.prefs     本轮生效偏好
 * @param {object} input.result    applyPolicyContexts 的返回值（policyIn / rewrites / dropped）
 * @param {string} input.channel   "assemble" | "refresh"
 * @param {string|null} input.version
 * @param {boolean} input.force    忽略节流与签名，强制写
 */
export function recordAssembly({ assembly, prefs, result, channel, version = null, force = false }) {
  // 先记自有资产（不跟随 trace 开关）：关掉快照不该让旧版本提示词失去归属。
  try {
    recordSectionAssets(Array.isArray(assembly?.sections) ? assembly.sections : []);
  } catch {
    /* 记账失败不影响组装 */
  }
  if (!prefs || prefs.trace === false) return null;
  const sections = (Array.isArray(assembly?.sections) ? assembly.sections : []).map(describeSection);
  const contexts = (Array.isArray(assembly?.contexts) ? assembly.contexts : []).map(describeContext);
  const rewrites = (result?.rewrites || []).map((item) => ({
    channel,
    name: item.name,
    beforeSha: item.beforeSha,
    afterSha: item.afterSha,
  }));
  const dropped = (result?.dropped || []).map((item) => ({
    channel,
    name: item.name,
    beforeSha: item.beforeSha,
  }));

  const signature = [
    channel,
    JSON.stringify(prefs.sections),
    JSON.stringify(prefs.layers),
    JSON.stringify(prefs.policy),
    String(Boolean(prefs.enabled)),
    sections.map((s) => `${s.name}:${s.sha256.slice(0, 12)}`).join("|"),
    contexts.map((c) => `${c.name}:${c.sha256.slice(0, 12)}`).join("|"),
    rewrites.map((r) => `${r.name}:${r.afterSha.slice(0, 8)}`).join("|"),
    String(dropped.length),
    String(live.hooks.assemble.attached),
    String(live.hooks.refresh.patched),
  ].join("#");

  const now = Date.now();
  if (!force && signature === state.signature && now - state.lastWriteMs < REFRESH_MS) return null;

  const payload = {
    at: new Date().toISOString(),
    bootId: live.bootId,
    pid: live.pid,
    version,
    channel,
    prefs: {
      enabled: Boolean(prefs.enabled),
      sections: prefs.sections,
      layers: prefs.layers,
      policy: prefs.policy,
      ledger: prefs.ledger,
    },
    sections,
    contexts,
    counts: {
      contexts: contexts.length,
      policyIn: Number(result?.policyIn ?? 0),
      rewritten: rewrites.length,
      dropped: dropped.length,
    },
    rewrites,
    dropped,
    counters: { ...live.counters },
  };

  if (writeJson(assemblyPath(), payload)) {
    state.writes += 1;
    state.signature = signature;
    state.lastWriteMs = now;
  }
  return payload;
}

export function snapshotStats() {
  return { writes: state.writes, lastWriteMs: state.lastWriteMs || null, signature: state.signature || null };
}
