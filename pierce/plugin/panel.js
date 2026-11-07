import fs from "node:fs";
import path from "node:path";
import { dshHome, readJson, sha256, stateRoot, writeJson } from "./state.js";
import { counters, live, uptimeSeconds } from "./live.js";
import {
  DEFAULT_PREFS,
  PRESETS,
  activePreset,
  prefsPath,
  readPrefsFile,
  readSwitchLog,
  resolvePrefs,
} from "./prefs.js";
import { SECTIONS, SECTION_FILES, expectedText, sectionEnabled, sectionLabel } from "./sections.js";
import { assemblyPath, readAssemblySnapshot } from "./snapshot.js";
import { bootPath, ledgerPath, readAssetTexts, readLedger } from "./ledger.js";
import { findRefusals } from "./refusal.js";
import { PACKAGE_ROOT, PROMPTS_DIR, packageVersion } from "./paths.js";
import { REPO, applyUpdate, checkVersion, installInfo, readUpdateCache, writeRestartScript } from "./update.js";
import { PANEL_PREFIX, PORT_BASE, SERVICE_ID } from "./protocol.js";

/**
 * 面板的数据层：把"运行中的事实"整理成一张自证的表。
 *
 * 设计取向（这是与旧项目最大的差别）：面板上的每一格都要能追到来源。
 *   - 期望值只从偏好 + 磁盘上的 prompts 算；
 *   - 实际值只从装配快照 / 活计数 / 账本算；
 *   - 两者不一致就明说"不一致"，不用一个绿点糊过去。
 */

export function auditPath() {
  return path.join(stateRoot(), "audit.json");
}

function bytesLabel(text) {
  const value = String(text ?? "");
  const bytes = Buffer.byteLength(value, "utf8");
  if (!bytes) return "空";
  return `${bytes} B · ${sha256(value).slice(0, 10)}`;
}

function partLabel(part) {
  if (!part) return "未出现";
  if (!part.bytes) return "空";
  return `${part.bytes} B · ${String(part.sha256 || "").slice(0, 10)}`;
}

function sectionRow(key, prefs, snapshot) {
  const expected = expectedText(PROMPTS_DIR, key, prefs);
  const on = sectionEnabled(prefs, key);
  const wanted = on && expected.trim() !== "";
  const offLabel = "关闭";
  const expectedTextLabel = on ? bytesLabel(expected) : offLabel;
  const hit = snapshot ? (snapshot.sections || []).find((section) => section.name === SECTIONS[key]) : null;
  const actualLabel = !snapshot ? "未组装" : hit ? partLabel(hit) : "未出现";
  let ok = null;
  // 总开关关掉时不下判断：快照是历史，期望是"不贡献内容"，两者本来就不该比。
  if (snapshot && prefs.enabled) ok = wanted ? Boolean(hit) && hit.sha256 === sha256(expected) : !hit || !hit.bytes;
  return { part: key, label: sectionLabel(key), expectedText: expectedTextLabel, actualText: actualLabel, ok };
}

function layerRow(key, prefs) {
  const label = key === "assemble" ? "装配层改写" : "消息层改写";
  const hook = key === "assemble" ? live.hooks.assemble : live.hooks.refresh;
  const attached = key === "assemble" ? hook.attached === true : hook.patched === true;
  const seen = key === "assemble" ? counters().assemble : counters().refresh;
  const want = Boolean(prefs.enabled) && prefs.layers[key];
  const expectedTextLabel = !prefs.enabled ? "关闭（总开关）" : want ? "开 · 每轮处理" : "关 · 原样放行";
  const actualTextLabel = !attached
    ? `未挂上${hook.reason ? `（${hook.reason}）` : ""}`
    : `${want ? "已挂" : "待机"} · 调用 ${seen}`;
  let ok = false;
  if (attached) ok = want ? (seen > 0 ? true : null) : true;
  return { part: key, label, expectedText: expectedTextLabel, actualText: actualTextLabel, ok };
}

function policyRow(prefs, snapshot) {
  const mode = prefs.policy.mode;
  const counts = snapshot?.counts || null;
  const policyIn = counts ? counts.policyIn : null;
  const done = counts ? (mode === "drop" ? counts.dropped : counts.rewritten) : null;
  const layersOn = Boolean(prefs.layers.assemble) || Boolean(prefs.layers.refresh);
  const wanted = Boolean(prefs.enabled) && layersOn;
  const expectedTextLabel = !wanted ? "不改写（层已关）" : mode === "drop" ? "删除权限类上下文" : "改写为中性文案";
  const actualTextLabel = !snapshot ? "未组装" : `入参 ${policyIn} 段 · ${mode === "drop" ? "删除" : "改写"} ${done} 条`;
  let ok = null;
  if (snapshot) ok = wanted ? policyIn === done : true;
  return { part: "policy", label: "政策句处置", expectedText: expectedTextLabel, actualText: actualTextLabel, ok };
}

function auditRow() {
  const audit = readJson(auditPath(), null);
  if (!audit) return { part: "audit", label: "审计（对账）", expectedText: "0 漏点", actualText: "未运行", ok: null };
  if (audit.error) {
    return { part: "audit", label: "审计（对账）", expectedText: "0 漏点", actualText: `无法下结论：${audit.error}`, ok: null };
  }
  const findings = Number(audit.findingsTotal ?? (audit.findings || []).length);
  const refusals = Number(audit.refusals?.total ?? 0);
  return {
    part: "audit",
    label: "审计（对账）",
    expectedText: "0 漏点",
    actualText: `${findings} 漏 · 检查 ${audit.checked ?? 0} 段输入${refusals ? ` · 拒答 ${refusals}` : ""}`,
    ok: findings === 0,
  };
}

function warningsFor(prefs, snapshot) {
  const warnings = [];
  if (prefs.offBy?.includes("disabled-file")) warnings.push("disabled.json 存在：插件被硬关闭，面板开关不生效");
  if (prefs.offBy?.includes("config")) warnings.push("cordis 配置 enabled:false：面板开关不生效");
  if (!prefs.enabled) return warnings;
  if (!prefs.ledger) warnings.push("账本已关：审计无法对账，会把权限句全判成漏点");
  if (!prefs.layers.refresh) warnings.push("消息层已关：用户消息里那份 runtime-context 不会被改写");
  if (!prefs.layers.assemble) warnings.push("装配层已关：系统提示词里的政策句会原样留下");
  if (!prefs.sections.core) warnings.push("正文已关：只剩 pre/post 与政策句改写");
  if (!snapshot) warnings.push("还没有装配快照：在 GUI 里发任何一句话就会触发一次组装");

  // 送达全绿却还是被拒 → 这是内容层面的事，不该再去动机制。
  const audit = readJson(auditPath(), null);
  const refusals = Number(audit?.refusals?.total ?? 0);
  if (refusals > 0) {
    warnings.push(`上次审计里有 ${refusals} 次拒答：送达没问题，是模型在内容层面收口 —— 看下面的拒答片段判断是措辞还是尺度`);
  }
  return warnings;
}

function presetList(prefs) {
  const current = activePreset(prefs);
  return Object.entries(PRESETS).map(([id, preset]) => ({
    id,
    label: preset.label,
    hint: preset.hint,
    patch: preset.patch,
    active: current === id,
  }));
}

function ledgerSummary() {
  const rows = readLedger();
  const bootAt = Date.parse(live.bootAt || "");
  const bootRows = rows.filter((row) => {
    const at = Date.parse(row.at || "");
    return Number.isFinite(at) && Number.isFinite(bootAt) ? at >= bootAt : false;
  });
  return {
    path: ledgerPath(),
    enabled: null,
    rows: rows.length,
    bootRows: bootRows.length,
    last: rows.slice(-6).reverse().map((row) => ({
      at: row.at || null,
      channel: row.channel || null,
      name: row.name || null,
      afterSha: String(row.afterSha || "").slice(0, 10),
    })),
  };
}

function versionBlock() {
  const cache = readUpdateCache();
  return {
    local: packageVersion(),
    package: "dsh-pierce",
    repo: REPO.url,
    releases: `${REPO.url}/releases`,
    latest: cache?.latest ?? null,
    latestTag: cache?.latestTag ?? null,
    publishedAt: cache?.publishedAt ?? null,
    releaseUrl: cache?.releaseUrl ?? `${REPO.url}/releases`,
    checkedAt: cache?.at ?? null,
    stale: cache ? Boolean(cache.stale) : null,
    checkOk: cache ? cache.ok !== false : null,
    error: cache?.error ?? null,
    updateAvailable: cache?.updateAvailable === true,
    behind: cache?.behind === true,
    install: installInfo(PACKAGE_ROOT),
  };
}

/** 面板的完整状态。纯读，不改任何东西。 */
export function buildState(config = {}) {
  const prefs = resolvePrefs(config);
  const snapshot = readAssemblySnapshot();
  const status = readJson(path.join(stateRoot(), "status.json"), null);
  const rows = [
    sectionRow("core", prefs, snapshot),
    sectionRow("post", prefs, snapshot),
    layerRow("assemble", prefs),
    layerRow("refresh", prefs),
    policyRow(prefs, snapshot),
  ];
  const audit = auditRow();
  rows.push(audit);

  const graded = rows.filter((row) => row.part !== "audit");
  const allOk = graded.every((row) => row.ok === true);
  const unknown = graded.some((row) => row.ok === null);
  const prefsNewer = Boolean(prefs.mtime && snapshot?.at) && Date.parse(prefs.mtime) > Date.parse(snapshot.at) + 500;
  const matched = Boolean(snapshot) && allOk;
  const pending = Boolean(prefs.enabled) && !matched && (!snapshot || prefsNewer || unknown);

  const badge = !prefs.enabled
    ? { text: "已关闭", tone: "off" }
    : pending
      ? { text: "待组装", tone: "warn" }
      : matched
        ? { text: "已生效", tone: "ok" }
        : { text: "不一致", tone: "bad" };

  const preset = activePreset(prefs);
  const dock = !prefs.enabled ? "破甲·关" : preset === "inject" ? "破甲·注入" : preset === "filter" ? "破甲·过滤" : "破甲·开";

  const summary = !prefs.enabled
    ? `已关闭${prefs.offBy?.length ? `（${prefs.offBy.join(" + ")}）` : ""}：两段不贡献内容，两层改写原样放行`
    : !snapshot
      ? "还没有装配快照：发任意一句话即触发一次组装"
      : pending
        ? prefsNewer
          ? "已切换，等下一轮组装（在 GUI 里发一句话）"
          : "已挂上，但还没看到这一轮的组装证据"
        : matched
          ? `已生效：快照与期望逐项一致（组装 ${snapshot.counts?.contexts ?? 0} 段上下文）`
          : "不一致：见下表逐项对照";

  const ledger = ledgerSummary();
  ledger.enabled = prefs.ledger;

  return {
    at: new Date().toISOString(),
    service: SERVICE_ID,
    prefix: PANEL_PREFIX,
    version: versionBlock(),
    prefs: {
      effective: {
        enabled: prefs.enabled,
        sections: prefs.sections,
        layers: prefs.layers,
        policy: prefs.policy,
        ledger: prefs.ledger,
        trace: prefs.trace,
      },
      file: readPrefsFile(),
      defaults: DEFAULT_PREFS,
      source: prefs.source,
      offBy: prefs.offBy,
      mtime: prefs.mtime,
      preset,
      presets: presetList(prefs),
      switchLog: readSwitchLog(5),
    },
    runtime: {
      bootAt: live.bootAt,
      bootId: live.bootId,
      pid: live.pid,
      uptimeSeconds: uptimeSeconds(),
      counters: counters(),
      hooks: {
        assemble: { attached: live.hooks.assemble.attached === true, reason: live.hooks.assemble.reason ?? null },
        refresh: {
          patched: live.hooks.refresh.patched === true,
          verified: live.hooks.refresh.verified === true,
          reason: live.hooks.refresh.reason ?? null,
        },
      },
      last: live.last,
    },
    applyStatus: status
      ? {
          at: status.at || null,
          version: status.version || null,
          sections: status.sections || null,
          hooks: status.hooks || null,
        }
      : null,
    sections: ["core", "post"].map((key) => {
      const text = expectedText(PROMPTS_DIR, key, prefs);
      return {
        key,
        name: SECTIONS[key],
        file: SECTION_FILES[key],
        label: sectionLabel(key),
        enabled: sectionEnabled(prefs, key),
        bytes: Buffer.byteLength(text, "utf8"),
        sha256: sha256(text).slice(0, 12),
      };
    }),
    snapshot: snapshot
      ? {
          at: snapshot.at,
          channel: snapshot.channel,
          bootId: snapshot.bootId,
          sameBoot: snapshot.bootId === live.bootId,
          counts: snapshot.counts || null,
          prefs: snapshot.prefs || null,
          sections: snapshot.sections || [],
          contexts: (snapshot.contexts || []).filter((entry) => entry.policy || entry.rewritten).slice(0, 8),
          rewrites: (snapshot.rewrites || []).slice(-6),
        }
      : null,
    rows,
    evidence: { matched, pending, unknown, prefsNewer, summary, badge, dock },
    warnings: warningsFor(prefs, snapshot),
    ledger,
    audit: readJson(auditPath(), null),
    paths: {
      state: stateRoot(),
      prefs: prefsPath(),
      prompts: PROMPTS_DIR,
      snapshot: assemblyPath(),
      ledger: ledgerPath(),
      audit: auditPath(),
      boot: bootPath(),
      dshHome: dshHome(),
      panelPort: PORT_BASE,
    },
  };
}

/**
 * 跑一次对账（读最新会话日志 + 账本 → 逐段判定）。
 * 在宿主进程里跑，不加子进程：它是纯读 + 纯计算，几百毫秒级。
 */
export async function runAudit({ all = false } = {}) {
  const { assertLogVersion, decodeSessionLog, extractAssistantTexts, extractInputTexts, findSessionLog, parseRecords } = await import("../auditor/logreader.js");
  const { loadOwnPrompts, reconcile } = await import("../auditor/reconcile.js");

  const at = new Date().toISOString();
  const bootAt = all ? "" : String(readJson(bootPath(), {})?.at || "");
  const session = findSessionLog(dshHome());
  const fail = (error) => {
    const payload = { at, ok: false, error, mode: all ? "all" : "boot", session, bootAt: bootAt || null };
    writeJson(auditPath(), payload);
    return payload;
  };

  if (!session) return fail("找不到会话日志（~/.dsh/sessions/**/session.*.jsonl.zstd）");
  if (!fs.existsSync(session)) return fail(`日志不存在：${session}`);

  let records;
  try {
    records = parseRecords(decodeSessionLog(fs.readFileSync(session)));
    assertLogVersion(records);
  } catch (e) {
    return fail(`读日志失败：${String((e && e.message) || e)}`);
  }

  const ledger = readLedger();
  const ledgerMissing = !fs.existsSync(ledgerPath());
  const texts = extractInputTexts(records, { since: bootAt });
  const ownPrompts = [...loadOwnPrompts(path.join(PACKAGE_ROOT, "prompts")), ...readAssetTexts()];
  const result = reconcile(texts, ledger, ownPrompts);
  // 第二条轴：送达 0 漏但仍然被拒 = 内容层面收口，不是机制问题。
  const replies = extractAssistantTexts(records, { since: bootAt });
  const refusals = findRefusals(replies);

  const payload = {
    at,
    mode: all ? "all" : "boot",
    ok: result.findings.length === 0 && !ledgerMissing,
    error: null,
    session,
    bootAt: bootAt || null,
    ledgerRows: ledger.length,
    ledgerMissing,
    checked: result.checked,
    policyFragments: result.policyFragments,
    findingsTotal: result.findings.length,
    findings: result.findings.slice(0, 30),
    replies: replies.length,
    refusals,
  };
  writeJson(auditPath(), payload);
  return payload;
}

/** 查一次更新（网络）。结果写缓存，面板下一轮直接显示。 */
export async function checkVersionNow() {
  const result = await checkVersion(packageVersion());
  return { ...result, install: installInfo(PACKAGE_ROOT) };
}

/** 更新：能 pull 就 pull，不能就返回要手动跑的命令。 */
export function applyUpdateNow() {
  return applyUpdate(PACKAGE_ROOT);
}

/** 只生成 restart.cmd，不动进程。 */
export function makeRestartScript() {
  return writeRestartScript();
}
