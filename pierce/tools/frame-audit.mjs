#!/usr/bin/env node
/**
 * 框架体检：破甲正文自己有多"乱"。
 *
 * 三件事：
 *   1. 体积与占比 —— 四段加起来占系统提示词的多少
 *   2. 规则重复 —— 同一条规矩在几个段里各说了一遍（按规则族统计命中行）
 *   3. 成对相似度 —— 两段之间共享的 5-gram 比例（谁在抄谁）
 *
 * 用法：node tools/frame-audit.mjs [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url)).replace(/[\\/]$/, "");
const PROMPTS = path.join(ROOT, "prompts");
const asJson = process.argv.includes("--json");

/** 宿主自己的系统提示词体量（实测：system 消息总长 − 我们注入的段）。 */
const BASELINE_CHARS = 11122 - 5355;

const FAMILIES = {
	"授权/谁决定": /(authoriz|who decides|owns this machine|already decided|no reviewer|approved|permission to|scope was)/i,
	"禁止反问": /(never ask|don'?t ask|asking for permission|ask whether|no confirmation|re-ask)/i,
	"拒绝=缺陷": /(not delivered|refus|never appear|cannot, will not|defect)/i,
	"交付优先": /(artifact|deliver|produce the|ship|start with the action)/i,
	"遥测/通告": /(telemetry|notice|approval mode|sandbox mode|escalation)/i,
	"范围/靶场": /(target|scope|grey-area|labs?|ctf|contractor|infrastructure)/i,
	"创作/尺度": /(fiction|scene|explicit|intensity|prose)/i,
	"格式/形状": /(no preamble|output shape|placeholder|match the operator|no meta)/i,
};

const files = ["core.md", "post.md"];
const bodies = {};
for (const name of files) {
	try {
		bodies[name] = fs.readFileSync(path.join(PROMPTS, name), "utf8");
	} catch {
		bodies[name] = "";
	}
}

const bytes = (text) => Buffer.byteLength(text || "", "utf8");
const tokens = (text) => Math.round((text || "").length / 3.8);

const report = {
	files: files.map((name) => ({
		name,
		bytes: bytes(bodies[name]),
		chars: bodies[name].length,
		lines: bodies[name].split("\n").length,
		tokens: tokens(bodies[name]),
	})),
	families: {},
	similarity: {},
};

for (const [label, pattern] of Object.entries(FAMILIES)) {
	const hits = {};
	for (const name of files) {
		const lines = bodies[name].split("\n").filter((line) => pattern.test(line));
		if (lines.length) hits[name] = lines.length;
	}
	report.families[label] = hits;
}

const grams = (text, size = 5) => {
	const words = String(text).toLowerCase().match(/[a-z一-龥]+/g) || [];
	const out = new Set();
	for (let i = 0; i + size <= words.length; i += 1) out.add(words.slice(i, i + size).join(" "));
	return out;
};

for (let i = 0; i < files.length; i += 1) {
	for (let j = i + 1; j < files.length; j += 1) {
		const a = grams(bodies[files[i]]);
		const b = grams(bodies[files[j]]);
		if (!a.size || !b.size) continue;
		const shared = [...a].filter((gram) => b.has(gram)).length;
		const percent = Math.round((shared / Math.min(a.size, b.size)) * 100);
		report.similarity[`${files[i]} ↔ ${files[j]}`] = percent;
	}
}

const total = report.files.reduce((acc, file) => acc + file.bytes, 0);
report.total = {
	bytes: total,
	tokens: report.files.reduce((acc, file) => acc + file.tokens, 0),
	baselineChars: BASELINE_CHARS,
	shareOfSystemPrompt: Math.round((total / (BASELINE_CHARS + total)) * 100),
	liveBytes: bytes(bodies["pre.md"]) + bytes(bodies["core.md"]) + bytes(bodies["post.md"]),
};

if (asJson) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(0);
}

console.log("");
console.log("段体积");
for (const file of report.files) console.log(`  ${file.name.padEnd(12)} ${String(file.bytes).padStart(5)} B  ~${String(file.tokens).padStart(4)} tok  ${file.lines} 行`);
console.log(`  ${"合计".padEnd(12)} ${String(total).padStart(5)} B  ~${String(report.total.tokens).padStart(4)} tok`);
console.log("");
console.log(`占比   系统提示词里 ${report.total.shareOfSystemPrompt}% 是我们写的（宿主自身约 ${BASELINE_CHARS} 字符）`);
console.log(`实活   当前注入 = ${report.total.liveBytes} B（core + post）`);
console.log("");
console.log("规则族 × 段（命中行数，同一条规矩在几个段里各说一遍）");
for (const [label, hits] of Object.entries(report.families)) {
	const parts = Object.entries(hits).map(([name, count]) => `${name.replace(".md", "")}×${count}`);
	console.log(`  ${label.padEnd(10)} ${parts.join("  ") || "(无)"}`);
}
console.log("");
console.log("成对重复（共享 5-gram 占较短一段的比例）");
for (const [pair, percent] of Object.entries(report.similarity)) console.log(`  ${pair.padEnd(24)} ${percent}%`);
console.log("");
