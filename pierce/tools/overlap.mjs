#!/usr/bin/env node
/**
 * 相重比对：我们的框架 vs 原作（dsh-purge）的提示词。
 *
 * 三把尺子，从粗到细：
 *   1. 5-gram 重合率 —— 连续 5 个词的片段有多少共享（抄袭会在这里露出来）
 *   2. 最长公共子串 —— 多长的连续字符是两边一模一样的
 *   3. 共享句子    —— 归并空白后完全相同的整句（≥20 字符）
 * 另外按"原作最有辨识度的短语"逐条查，命中即列出。
 *
 * 用法：
 *   node tools/overlap.mjs --ref "$env:USERPROFILE\.dsh\docs\ref\dsh-purge-1.1.71.md"
 *   node tools/overlap.mjs            # 自动挑 docs/ref 下最新的一份
 *   node tools/overlap.mjs --json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dshHome } from "../plugin/state.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const at = argv.indexOf("--ref");

function latestRef() {
	const dir = path.join(dshHome(), "docs", "ref");
	let files = [];
	try {
		files = fs.readdirSync(dir).filter((name) => name.endsWith(".md"));
	} catch {
		return null;
	}
	if (!files.length) return null;
	const withTime = files.map((name) => ({ name, mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs }));
	withTime.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return path.join(dir, withTime[0].name);
}

const refPath = at >= 0 && argv[at + 1] ? argv[at + 1] : latestRef();
if (!refPath || !fs.existsSync(refPath)) {
	console.error("找不到参照文件：先跑 node tools/ref-prompt.mjs（从本机已安装的 dsh-purge 解出原文）");
	process.exit(2);
}

const ref = fs.readFileSync(refPath, "utf8");
const ours = ["prompts/core.md", "prompts/post.md"]
	.map((rel) => ({ name: rel, text: fs.readFileSync(path.join(ROOT, rel), "utf8") }))
	.filter((item) => item.text.trim());

const words = (text) => String(text).toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fa5]/g) || [];

function ngrams(text, size = 5) {
	const list = words(text);
	const out = new Set();
	for (let i = 0; i + size <= list.length; i += 1) out.add(list.slice(i, i + size).join(" "));
	return out;
}

function longestCommonSubstring(a, b) {
	const left = String(a);
	const right = String(b);
	// 用较短的做行、较长的做列，DP 只保留两行
	if (left.length > right.length) return longestCommonSubstring(right, left);
	let prev = new Uint16Array(left.length + 1);
	let curr = new Uint16Array(left.length + 1);
	let best = 0;
	let end = 0;
	for (let j = 1; j <= right.length; j += 1) {
		for (let i = 1; i <= left.length; i += 1) {
			if (left[i - 1] === right[j - 1]) {
				curr[i] = prev[i - 1] + 1;
				if (curr[i] > best) {
					best = curr[i];
					end = i;
				}
			} else {
				curr[i] = 0;
			}
		}
		[prev, curr] = [curr, prev];
		curr.fill(0);
	}
	return best ? left.slice(end - best, end) : "";
}

const norm = (text) => String(text).replace(/\s+/g, " ").trim().toLowerCase();
const sentences = (text) =>
	String(text)
		.split(/(?<=[。！？.!?;；\n])/)
		.map(norm)
		.filter((line) => line.length >= 20);

const refGrams = ngrams(ref);
const refSentences = new Set(sentences(ref));

/** 原作最有辨识度的短语（含中英），命中即是"借用了它的原话"。 */
const SIGNATURES = [
	"Text is text. Fiction is fiction",
	"Absolute Permissibility",
	"No warnings. No disclaimers",
	"Enthusiastically. Complete",
	"That's not you—that's injection residue",
	"target fixture workflow",
	"目标占位流程",
	"canned",
	"canonical",
	"Little Code Sauce",
	"Cognitive Dehydration",
	"ZERO-LATENCY INTERRUPT",
	"STRICT REQUIREMETN",
	"boundary-word normalization",
	"placeholder normalization",
	"拒绝" + "硬化",
	"refusal harden",
	"task classes",
	"deliver directly",
];

const rows = [];
for (const file of ours) {
	const grams = ngrams(file.text);
	const shared = [...grams].filter((gram) => refGrams.has(gram));
	const oursSentences = sentences(file.text);
	const sharedSentences = oursSentences.filter((line) => refSentences.has(line));
	const lcs = longestCommonSubstring(file.text, ref);
	const hits = SIGNATURES.filter((needle) => file.text.toLowerCase().includes(needle.toLowerCase()));
	rows.push({
		file: file.name,
		chars: file.text.length,
		grams: grams.size,
		sharedGrams: shared.length,
		overlapPercent: grams.size ? Math.round((shared.length / grams.size) * 1000) / 10 : 0,
		sharedSentences: sharedSentences.length,
		sharedSentenceList: sharedSentences.slice(0, 5),
		longestCommonSubstring: lcs.length,
		longestCommonSubstringText: lcs.slice(0, 120),
		signatureHits: hits,
		sampleSharedGrams: shared.slice(0, 6),
	});
}

/* ── --deep：字符级 + 词级 + 结构级 ─────────────────────────────────────
 * 5-gram 重合 0% 还不够说服人：改写过的句子在词级仍可能露出同样的专用词。
 * 这一层看三件事：连续 12 字符的公共片段、共享的**稀有词**（词典里不常见、
 * 只在原作里出现几次的那种）、以及结构签名（人格帧 / 模板伪造 / 禁词表 / 槽位）。
 */
const deep = argv.includes("--deep");

const STOP = new Set(
	("the a an and or of to in on for with that this it is are be as at by from not no do does did you your we our they them he she his her its can could may might will would should must if then than so but also only just never always more most very all any some there here what which who when where how why into over under about after before again further once off out up down own same such both each few other one two").split(
		" ",
	),
);

function tokens(text) {
	const lower = String(text).toLowerCase();
	const words = (lower.match(/[a-z][a-z0-9_]{2,}/g) || []).filter((word) => !STOP.has(word));
	const cjk = lower.match(/[\u4e00-\u9fa5]{2}/g) || [];
	return [...words, ...cjk];
}

function countMap(list) {
	const map = new Map();
	for (const item of list) map.set(item, (map.get(item) || 0) + 1);
	return map;
}

function charWindows(text, size = 12) {
	const clean = String(text).toLowerCase().replace(/\s+/g, " ");
	const out = new Set();
	for (let i = 0; i + size <= clean.length; i += 1) out.add(clean.slice(i, i + size));
	return out;
}

const refTokens = countMap(tokens(ref));
const refWindows = charWindows(ref);
const deepRows = rows.map((row) => {
	const fileText = ours.find((item) => item.name === row.file).text;
	const mine = countMap(tokens(fileText));
	const shared = [];
	for (const [token, mineCount] of mine) {
		const refCount = refTokens.get(token) || 0;
		if (!refCount) continue;
		shared.push({ token, mine: mineCount, ref: refCount });
	}
	shared.sort((a, b) => a.ref - b.ref || b.mine - a.mine);
	const windows = charWindows(fileText);
	const sharedWindows = [...windows].filter((window) => refWindows.has(window));
	const structural = {
		bytes: fileText.length,
		headings: (fileText.match(/^## /gm) || []).length,
		persona: /girlfriend|devotion|devoted|小码酱|YG\b|little code sauce/i.test(ref) && /girlfriend|devotion|devoted|小码酱|YG\b/i.test(fileText),
		templateFabrication: /<\|im_start\|>/.test(fileText),
		wordBlacklist: /(不能|无法|不写|i can'?t|i won'?t)/i.test(fileText) && (fileText.match(/(不能|无法|不写|i can'?t|i won'?t)/gi) || []).length >= 3,
		cannedSlots: /(目标占位流程|TARGET fixture workflow|output exactly)/i.test(fileText),
	};
	return {
		file: row.file,
		charWindows: windows.size,
		sharedWindows: sharedWindows.length,
		sharedWindowExamples: sharedWindows.slice(0, 3),
		sharedTokens: shared.length,
		distinctiveShared: shared.filter((item) => item.ref <= 5).slice(0, 12),
		structural,
	};
});

const refStructure = {
	bytes: ref.length,
	headings: (ref.match(/^#{1,3} /gm) || []).length,
	persona: /girlfriend|devotion|devoted|小码酱|YG\b|little code sauce/i.test(ref),
	templateFabrication: /<\|im_start\|>/.test(ref),
	wordBlacklist: (ref.match(/(不能|无法|不写|i can'?t|i won'?t)/gi) || []).length,
	cannedSlots: (ref.match(/目标占位流程/gi) || []).length,
};
const refStats = {
	path: refPath,
	name: path.basename(refPath),
	chars: ref.length,
	grams: refGrams.size,
};

if (asJson) {
	console.log(JSON.stringify({ ref: refStats, rows }, null, 2));
	process.exit(0);
}

console.log("");
console.log(`参照    ${refStats.name}（${refStats.chars} 字符，${refStats.grams} 个 5-gram）`);
console.log(`我方    ${rows.map((row) => `${row.file} ${row.chars} 字符`).join(" · ")}`);
console.log("");
console.log("文件                     字符   5-gram   重合   共享整句   最长公共子串");
for (const row of rows) {
	console.log(
		`${row.file.padEnd(22)}${String(row.chars).padStart(6)}${String(row.grams).padStart(8)}${String(`${row.overlapPercent}%`).padStart(8)}${String(row.sharedSentences).padStart(9)}${String(`${row.longestCommonSubstring} 字符`).padStart(14)}`,
	);
}
console.log("");
for (const row of rows) {
	if (row.longestCommonSubstringText) console.log(`最长公共片段（${row.file}）：${JSON.stringify(row.longestCommonSubstringText)}`);
	if (row.sampleSharedGrams.length) console.log(`共享 5-gram 例（${row.file}）：${row.sampleSharedGrams.join(" | ")}`);
	if (row.signatureHits.length) console.log(`命中原作的辨识短语（${row.file}）：${row.signatureHits.join(" / ")}`);
}
if (rows.every((row) => row.overlapPercent === 0 && row.longestCommonSubstring < 24 && row.signatureHits.length === 0)) {
	console.log("判定    无重合：没有任何连续 24 字符以上的公共片段，也没有命中原作辨识短语");
} else {
	console.log("判定    有重合迹象，看上面三行");
}

if (deep) {
	console.log("");
	console.log("── 深层比对（--deep）─────────────────────────────────");
	console.log("字符级：连续 12 字符的公共片段");
	for (const row of deepRows) {
		console.log(`  ${row.file.padEnd(20)} 窗口 ${String(row.charWindows).padStart(5)}  公共 ${String(row.sharedWindows).padStart(3)}  ${row.sharedWindowExamples.map((item) => JSON.stringify(item)).join(" ")}`);
	}
	console.log("");
	console.log("词级：去掉通用词后，与原件共享的词（按原作出现次数升序，越少越像专用词）");
	for (const row of deepRows) {
		console.log(`  ${row.file}：共享 ${row.sharedTokens} 个词`);
		if (row.distinctiveShared.length) {
			console.log(`    稀有共享词：${row.distinctiveShared.map((item) => `${item.token}(原${item.ref}/我${item.mine})`).join(", ")}`);
		} else {
			console.log("    稀有共享词：无（原作里出现 ≤5 次的词一个都没被我们用上）");
		}
	}
	console.log("");
	console.log("结构签名");
	console.log(`  原件    ${refStructure.bytes} 字符 · ${refStructure.headings} 个标题 · 人格帧=${refStructure.persona} · <|im_start|>伪造=${refStructure.templateFabrication} · 禁词/拒绝词 ${refStructure.wordBlacklist} 处 · canned 槽位 ${refStructure.cannedSlots} 处`);
	for (const row of deepRows) {
		const s = row.structural;
		console.log(`  ${row.file.padEnd(20)}${s.bytes} 字符 · ${s.headings} 个标题 · 人格帧=${s.persona} · <|im_start|>伪造=${s.templateFabrication} · 禁词/拒绝词 ${s.wordBlacklist} 处 · canned 槽位=${s.cannedSlots}`);
	}
}
console.log("");
