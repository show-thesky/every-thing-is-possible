#!/usr/bin/env node
/**
 * dsh-pierce 审计器
 *
 * 用法：
 *   node auditor/index.mjs                 # 自动挑最新会话，只看本次启动之后
 *   node auditor/index.mjs --all           # 不看 boot 标记，全量
 *   node auditor/index.mjs --session <路径> # 指定日志
 *   node auditor/index.mjs --json          # 机器可读
 *
 * 退出码：0 = 0 漏；1 = 有漏点；2 = 环境/格式问题（不能下结论）
 *
 * 判据不在这里，在 ../plugin/detect.js —— 审计器和插件共用同一份，避免两边漂移。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome, readJson, stateRoot } from "../plugin/state.js";
import { bootPath, ledgerPath, readLedger } from "../plugin/ledger.js";
import { assertLogVersion, decodeSessionLog, extractInputTexts, findSessionLog, parseRecords } from "./logreader.js";
import { loadOwnPrompts, reconcile } from "./reconcile.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};

const asJson = flag("--json");
const all = flag("--all");

function fail(message) {
  if (asJson) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(`✗ ${message}`);
  process.exit(2);
}

const sessionPath = value("--session") || findSessionLog(dshHome());
if (!sessionPath) fail("找不到会话日志（~/.dsh/sessions/**/session.*.jsonl.zstd）");
if (!fs.existsSync(sessionPath)) fail(`日志不存在：${sessionPath}`);

const bootAt = value("--boot") || (all ? "" : String(readJson(bootPath(), {})?.at || ""));
const ledger = readLedger();
const ledgerMissing = !fs.existsSync(ledgerPath());

let records;
try {
  records = parseRecords(decodeSessionLog(fs.readFileSync(sessionPath)));
  assertLogVersion(records);
} catch (e) {
  fail(`读日志失败：${String((e && e.message) || e)}`);
}

const texts = extractInputTexts(records, { since: bootAt });
const ownPrompts = loadOwnPrompts(path.join(PROJECT_ROOT, "prompts"));
const result = reconcile(texts, ledger, ownPrompts);

const payload = {
  ok: result.findings.length === 0 && !ledgerMissing,
  session: sessionPath,
  bootAt: bootAt || null,
  stateRoot: stateRoot(),
  ledgerRows: ledger.length,
  ledgerMissing,
  checkedTexts: result.checked,
  policyFragments: result.policyFragments,
  findings: result.findings,
};

if (asJson) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`会话    ${sessionPath}`);
  console.log(`窗口    ${bootAt ? `本次启动之后（${bootAt}）` : "全量"}`);
  console.log(`账本    ${ledgerMissing ? "不可读（全部判为漏点）" : `${ledger.length} 条`}`);
  console.log(`检查    ${result.checked} 段模型输入文本，其中 ${result.policyFragments} 段判为权限类`);
  console.log("");
  if (result.findings.length === 0) {
    console.log("结果    0 漏 ✓");
  } else {
    console.log(`结果    ${result.findings.length} 处漏点：`);
    for (const f of result.findings) {
      console.log(`  · [${f.type} seq=${f.seq}] ${f.fragment}`);
    }
  }
}

process.exitCode = payload.ok ? 0 : 1;
