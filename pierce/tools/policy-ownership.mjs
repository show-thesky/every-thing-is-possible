#!/usr/bin/env node
/**
 * 权属拆解：本次启动后，模型输入里那些"看起来像权限句"的片段，各自算谁的。
 *
 * 口径和审计器完全一致（同一个 isPolicyText / 同一个账本 / 同一份 prompts），
 * 只是把"0 漏"这个结论拆成四类，说明 0 漏不是因为输入里没有权限句：
 *   ledger   账本里记过改写（我们换掉的那批）
 *   neutral  三条中性文案本身
 *   prompt   项目自己的提示词正文（自有资产，按定义不算漏）
 *   leak     以上都不是 —— 真漏点
 *
 * 用法：node tools/policy-ownership.mjs [--all]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome, readJson, sha256 } from "../plugin/state.js";
import { bootPath, readAssetTexts, readLedger } from "../plugin/ledger.js";
import { NEUTRALS, isPolicyText } from "../plugin/detect.js";
import { decodeSessionLog, extractInputTexts, findSessionLog, parseRecords } from "../auditor/logreader.js";
import { loadOwnPrompts, splitFragments } from "../auditor/reconcile.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const all = process.argv.includes("--all");
const dsh = dshHome();
const boot = all ? "" : String(readJson(bootPath(), {})?.at || "");
const ledger = readLedger();
const own = [...loadOwnPrompts(path.join(ROOT, "prompts")), ...readAssetTexts()];
const neutral = new Set(NEUTRALS.map((text) => sha256(text)));
const owned = new Set(ledger.map((row) => String(row.afterSha)));

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
		if (entry.isDirectory()) listLogs(full, depth + 1, out);
		else if (entry.name.startsWith("session.") && entry.name.endsWith(".jsonl.zstd")) out.push(full);
	}
	return out;
}

const files = (() => {
	const at = process.argv.indexOf("--session");
	if (at >= 0 && process.argv[at + 1]) return [process.argv[at + 1]];
	if (all) return listLogs(path.join(dsh, "sessions"));
	const latest = findSessionLog(dsh);
	return latest ? [latest] : [];
})();
const buckets = { ledger: 0, neutral: 0, prompt: 0, leak: 0 };
const leaks = [];
let checked = 0;

for (const file of files) {
	let texts = [];
	try {
		texts = extractInputTexts(parseRecords(decodeSessionLog(fs.readFileSync(file))), { since: boot });
	} catch {
		continue;
	}
	checked += texts.length;
	for (const item of texts) {
		for (const fragment of splitFragments(item.text)) {
			if (!isPolicyText(fragment)) continue;
			const digest = sha256(fragment);
			if (owned.has(digest)) buckets.ledger += 1;
			else if (neutral.has(digest)) buckets.neutral += 1;
			else if (own.some((body) => body.includes(fragment.trim()))) buckets.prompt += 1;
			else {
				buckets.leak += 1;
				leaks.push({ file: path.basename(path.dirname(file)), seq: item.seq, fragment: fragment.slice(0, 160) });
			}
		}
	}
}

const total = buckets.ledger + buckets.neutral + buckets.prompt + buckets.leak;
console.log("");
console.log(`窗口    ${boot ? `本次启动之后（${boot}）` : "全量"}    会话 ${files.length} 个 · 模型输入 ${checked} 段`);
console.log(`权限句  ${total} 段`);
console.log(`  账本改写   ${buckets.ledger}`);
console.log(`  中性文案   ${buckets.neutral}`);
console.log(`  自有提示词 ${buckets.prompt}`);
console.log(`  真漏点     ${buckets.leak}`);
if (leaks.length) {
	console.log("");
	for (const item of leaks.slice(0, 10)) console.log(`  · [${item.file} seq=${item.seq}] ${item.fragment}`);
}
console.log("");
