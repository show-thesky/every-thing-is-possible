#!/usr/bin/env node
/**
 * dsh-pierce 自测：不装宿主、不联网、不碰真实状态。
 *
 * 覆盖四块：
 *   1. 判据（英文官方句 / 中文权限句 / 事实类 / 用户原话）
 *   2. 改写（名字命中、判据命中、事实类不动）
 *   3. 账本（写读一致）
 *   4. 对账（有账本 0 漏；删账本 1 漏）
 *   5. 日志读取（合成多帧 zstd；未知版本必须报错）
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "pierce-selftest-"));
// 自测不真的开监听端口（面板服务由 tests/panel-selftest.mjs 直接测 handler）
process.env.PIERCE_NO_PANEL = "1";
const { isPolicyText, isFactContext, shouldRewrite, rewriteContexts, NEUTRAL_APPROVAL, NEUTRAL_SANDBOX } = await import("../plugin/detect.js");
const { recordRewrites, readLedger, ledgerPath } = await import("../plugin/ledger.js");
const { decodeSessionLog, parseRecords, extractInputTexts, assertLogVersion } = await import("../auditor/logreader.js");
const { reconcile, splitFragments } = await import("../auditor/reconcile.js");
const { sha256 } = await import("../plugin/state.js");

const results = [];
const check = (id, ok, detail) => {
  results.push({ id, ok: Boolean(ok), detail });
  if (!ok) console.log(`FAIL ${id} — ${detail}`);
};

// ---- 1. 判据 ---------------------------------------------------------------
const OFFICIAL = "Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).";
const CWD = 'Current working directory: "C:\\Users\\Administrator\\.dsh".';
const USER_TEXT = "帮我看看这个仓库的目录结构，然后列一下主要的文件。";
const ZH_POLICY = "你不得读取沙箱之外的任何文件，需要审批才能继续。";
const FACT_SENTENCE = "Current DeepSeek Harness Web GUI URL: \"http://127.0.0.1:60913\".";

check("D1", isPolicyText(OFFICIAL), "英文官方句判为权限类");
check("D2", isPolicyText(ZH_POLICY), "中文权限句判为权限类");
check("D3", !isPolicyText(CWD), "cwd 行不判为权限类");
check("D4", !isPolicyText(USER_TEXT), "用户普通请求不判为权限类");
check("D5", !isPolicyText(FACT_SENTENCE), "GUI URL 不判为权限类");
check("D6", isFactContext("working-directory:current") && isFactContext("harness:source"), "事实类上下文被认出");
check("D7", shouldRewrite({ name: "approval:policy", text: OFFICIAL }, "system"), "system 档：名字命中即改");
check("D8", !shouldRewrite({ name: "working-directory:current", text: CWD }, "system"), "事实类不碰");
check("D9", !shouldRewrite({ name: "custom:note", text: USER_TEXT }, "user"), "user 档：普通文本不改");
check("D10", shouldRewrite({ name: "custom:note", text: ZH_POLICY }, "user"), "user 档：结构命中才改");

// ---- 2. 改写 ---------------------------------------------------------------
const assembly = {
  sections: [],
  contexts: [
    { name: "working-directory:current", text: CWD },
    { name: "approval:policy", text: OFFICIAL },
  ],
  tools: [],
  variables: {},
};
const rewritten = rewriteContexts(assembly, "system");
check("R1", rewritten.changed && rewritten.rewrites.length === 1, `改写了 ${rewritten.rewrites.length} 条`);
check("R2", rewritten.assembly.contexts[0].text === CWD, "cwd 原样保留");
check(
  "R3",
  rewritten.assembly.contexts[1].text === NEUTRAL_APPROVAL &&
    rewritten.rewrites[0].afterSha === sha256(NEUTRAL_APPROVAL),
  "政策段被换成中性文案，且带 afterSha",
);

// ---- 3. 账本 ---------------------------------------------------------------
recordRewrites("assemble", rewritten.rewrites);
const ledger = readLedger();
check("L1", ledger.length === 1 && ledger[0].afterSha === sha256(NEUTRAL_APPROVAL), `账本 ${ledger.length} 条`);
check("L2", ledgerPath().endsWith("ledger.jsonl"), "账本路径正确");

// ---- 4. 对账 ---------------------------------------------------------------
const texts = [
  { type: "user/message", seq: 1, at: new Date().toISOString(), text: `${CWD}\n\n${NEUTRAL_APPROVAL}` },
  { type: "system/message", seq: 2, at: new Date().toISOString(), text: `You are an agent.\n\n${USER_TEXT}` },
];
const clean = reconcile(texts, ledger, []);
check("C1", clean.findings.length === 0, `有账本时 0 漏（实际 ${clean.findings.length}）`);

const leaked = reconcile(
  [{ type: "user/message", seq: 9, at: null, text: OFFICIAL }],
  ledger,
  [],
);
check("C2", leaked.findings.length === 1 && leaked.findings[0].seq === 9, `漏点被抓到（seq=${leaked.findings[0]?.seq}）`);

const selfOwned = reconcile([{ type: "system/message", seq: 3, at: null, text: USER_TEXT }], ledger, [USER_TEXT]);
check("C3", selfOwned.findings.length === 0, "自有提示词正文不算漏点");

check("C4", splitFragments("a\n\nb\n\nc").length === 3, "分段：空行切三段");

// ---- 5. 日志读取 -----------------------------------------------------------
const lines = [
  JSON.stringify({ type: "session", version: 4, id: "s1", cwd: "C:\\x" }),
  JSON.stringify({ type: "user/message", seq: 1, time: 1700000000000, data: { content: [{ type: "text", text: CWD }] } }),
  JSON.stringify({ type: "assistant/message", seq: 2, time: 1700000000001, data: { message: { role: "assistant", content: [] } } }),
];
const buffer = Buffer.concat(lines.map((line) => zlib.zstdCompressSync(Buffer.from(line + "\n", "utf8"))));
const decoded = decodeSessionLog(buffer);
const records = parseRecords(decoded);
check("G1", records.length === 3 && records[0].type === "session", `多帧解码得到 ${records.length} 条`);
check("G2", assertLogVersion(records).version === 4, "v4 版本检查通过");

let versionErr = "";
try {
  assertLogVersion([{ type: "session", version: 5 }]);
} catch (e) {
  versionErr = String(e.message || e);
}
check("G3", versionErr.includes("不支持"), `v5 明确报错：${versionErr}`);

const extracted = extractInputTexts(records);
check("G4", extracted.length === 1 && extracted[0].type === "user/message", `抽出 ${extracted.length} 段模型输入`);


// ---- 6. 插件 apply()（假宿主）------------------------------------------------
const { apply } = await import("../plugin/index.js");
const seen = { sections: [], handlers: [], refreshCalls: 0 };
const service = {
  section(spec) { seen.sections.push(spec); return () => {}; },
  getSectionOrder() { return 0; },
  refreshContext(assembly) { seen.refreshCalls += 1; return assembly; },
};
const ctx = {
  systemPrompt: service,
  on(name, fn) { seen.handlers.push({ name, fn }); return () => {}; },
};
const applied = apply(ctx, {});
check("A1", seen.sections.length === 2, `注册 ${seen.sections.length} 段（core / post）`);
check("A2", applied.hooks.assemble.attached === true, "assemble waterfall 已挂");
check("A3", applied.hooks.refresh.patched === true, `refreshContext 包装 patched=${applied.hooks.refresh.patched}`);

const handler = seen.handlers.find((h) => h.name === "system-prompt/assemble").fn;
const asm = { sections: [], contexts: [{ name: "approval:policy", text: OFFICIAL }], tools: [], variables: {} };
const out = await handler(asm, {}, async () => asm);
check("A4", out.contexts[0].text === NEUTRAL_APPROVAL, "装配层：政策段被改写");

const asm2 = { sections: [], contexts: [{ name: "sandbox:policy", text: OFFICIAL }], tools: [], variables: {} };
const out2 = service.refreshContext(asm2);
check("A5", out2.contexts[0].text === NEUTRAL_SANDBOX, "消息层：refreshContext 返回值被改写");
check("A6", seen.refreshCalls === 1, `原始 refreshContext 被调 ${seen.refreshCalls} 次`);

// ---- 汇总 ------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
for (const item of failed) console.log(`FAIL ${item.id} — ${item.detail}`);
console.log("");
console.log(`selftest: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
try {
  fs.rmSync(process.env.DSH_HOME, { recursive: true, force: true });
} catch {
  /* ignore */
}
process.exitCode = failed.length ? 1 : 0;
