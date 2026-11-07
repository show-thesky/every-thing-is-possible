#!/usr/bin/env node
/**
 * 能力测量：把"破甲现在到底做到什么程度"变成一张能看的表。
 *
 * 逐个会话日志做四件事：
 *   1. 模型输入里的权限类片段 → 有几段、有没有漏（和账本对账，判据同审计器）
 *   2. 助手回复 → 有几条、几条命中拒答（分类器同审计器）
 *   3. 时间切开："本次启动之后"是当前这版的成绩，"之前"是历史对照
 *   4. 全部会话都算，不只最新那一个
 *
 * 注意：时间窗必须切。同一个会话可能横跨插件装上之前/之后，
 * 不切就会把旧代码的漏点算到这一版头上。
 *
 * 用法：
 *   node tools/capability.mjs            # 表格
 *   node tools/capability.mjs --json     # 机器可读
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome, readJson } from "../plugin/state.js";
import { bootPath, readAssetTexts, readLedger } from "../plugin/ledger.js";
import { findRefusals } from "../plugin/refusal.js";
import { decodeSessionLog, extractAssistantTexts, extractInputTexts, parseRecords } from "../auditor/logreader.js";
import { loadOwnPrompts, reconcile } from "../auditor/reconcile.js";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const asJson = process.argv.includes("--json");
const dsh = dshHome();
const bootAt = String(readJson(bootPath(), {})?.at || "");
const bootMs = Number.isFinite(Date.parse(bootAt)) ? Date.parse(bootAt) : 0;
const ledger = readLedger();
const ownPrompts = [...loadOwnPrompts(path.join(PROJECT_ROOT, "prompts")), ...readAssetTexts()];

function listLogs(dir, depth = 0, out = []) {
	if (depth > 3) return out;
	let entries = [];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			listLogs(full, depth + 1, out);
			continue;
		}
		if (!entry.name.startsWith("session.") || !entry.name.endsWith(".jsonl.zstd")) continue;
		try {
			out.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
		} catch {
			/* ignore */
		}
	}
	return out;
}

/** 一段记录集合 → 四项指标。 */
function measure(records) {
	const texts = extractInputTexts(records);
	const reconciled = reconcile(texts, ledger, ownPrompts);
	const replies = extractAssistantTexts(records);
	const refusals = findRefusals(replies);
	return {
		inputs: reconciled.checked,
		policyFragments: reconciled.policyFragments,
		leaks: reconciled.findings.length,
		replies: replies.length,
		refusals: refusals.total,
		items: refusals.items,
	};
}

const logs = listLogs(path.join(dsh, "sessions")).sort((a, b) => a.mtimeMs - b.mtimeMs);
const sessions = [];
const refusalItems = [];

for (const log of logs) {
	let records = [];
	try {
		records = parseRecords(decodeSessionLog(fs.readFileSync(log.path)));
	} catch (e) {
		sessions.push({ path: log.path, error: String((e && e.message) || e) });
		continue;
	}
	const key = path.basename(path.dirname(log.path)).replace(/^session-/, "").slice(0, 8);
	const workspace = path.basename(path.dirname(path.dirname(log.path)));
	const lastTime = records.reduce((max, r) => (Number.isFinite(r?.time) && r.time > max ? r.time : max), 0);
	const before = bootMs ? records.filter((r) => Number.isFinite(r?.time) && r.time < bootMs) : records;
	const after = bootMs ? records.filter((r) => !Number.isFinite(r?.time) || r.time >= bootMs) : [];

	const pre = measure(before);
	const post = measure(after);
	for (const item of post.items) refusalItems.push({ session: key, ...item });

	sessions.push({
		session: key,
		workspace,
		at: lastTime ? new Date(lastTime).toISOString() : null,
		pre: { inputs: pre.inputs, policyFragments: pre.policyFragments, leaks: pre.leaks, replies: pre.replies, refusals: pre.refusals },
		post: { inputs: post.inputs, policyFragments: post.policyFragments, leaks: post.leaks, replies: post.replies, refusals: post.refusals },
	});
}

const ok = sessions.filter((row) => !row.error);
const add = (bucket, key) => ok.reduce((acc, row) => acc + (row[bucket]?.[key] || 0), 0);
const totals = {
	sessions: ok.length,
	pre: { inputs: add("pre", "inputs"), policyFragments: add("pre", "policyFragments"), leaks: add("pre", "leaks"), replies: add("pre", "replies"), refusals: add("pre", "refusals") },
	post: { inputs: add("post", "inputs"), policyFragments: add("post", "policyFragments"), leaks: add("post", "leaks"), replies: add("post", "replies"), refusals: add("post", "refusals") },
	bootAt: bootAt || null,
	ledgerRows: ledger.length,
};
const postSessions = ok.filter((row) => row.post.inputs > 0 || row.post.replies > 0);

if (asJson) {
	console.log(JSON.stringify({ totals, postSessions, sessions, refusalItems }, null, 2));
	process.exit(0);
}

const pad = (value, width) => String(value ?? "").padEnd(width, " ");
const num = (value) => String(value ?? 0).padStart(4, " ");

console.log("");
console.log(`DSH_HOME   ${dsh}`);
console.log(`本次启动   ${bootAt || "(无 boot 标记)"}   账本 ${ledger.length} 条`);
console.log("");
console.log("── 本次启动之后（当前这一版）─────────────────────────────────────");
console.log(`${pad("会话", 10)}${pad("工作区", 22)}${pad("时间", 10)}${pad("输入", 6)}${pad("权限句", 7)}${pad("漏点", 5)}${pad("回复", 6)}${pad("拒答", 5)}`);
for (const row of postSessions) {
	console.log(
		`${pad(row.session, 10)}${pad(row.workspace, 22)}${pad(row.at ? row.at.slice(11, 19) : "?", 10)}${num(row.post.inputs)}  ${num(row.post.policyFragments)}  ${num(row.post.leaks)}  ${num(row.post.replies)}  ${num(row.post.refusals)}`,
	);
}
console.log("");
console.log(`合计   模型输入 ${totals.post.inputs} 段（权限类 ${totals.post.policyFragments} 段）· 漏点 ${totals.post.leaks} · 回复 ${totals.post.replies} 条（拒答 ${totals.post.refusals} 条）`);
console.log("");
console.log("── 历史对照（本次启动之前，含旧插件/无插件时期）──────────────────");
console.log(`合计   会话 ${totals.sessions} · 模型输入 ${totals.pre.inputs} 段（权限类 ${totals.pre.policyFragments} 段）· 漏点 ${totals.pre.leaks} · 回复 ${totals.pre.replies} 条（拒答 ${totals.pre.refusals} 条）`);

if (refusalItems.length) {
	console.log("");
	console.log("本次启动后的拒答样本：");
	for (const item of refusalItems.slice(-6)) {
		console.log(`  · [${item.kind} ${item.session} seq=${item.seq}] ${String(item.excerpt || "").slice(0, 110)}`);
	}
}
console.log("");
