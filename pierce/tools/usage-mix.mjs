#!/usr/bin/env node
/**
 * 用量画像：这个破甲实际被用来干什么。
 *
 * 口径：取 user/message 里"像人写的"那些段（排掉运行时信封、技能目录、时间戳行），
 * 按关键词分桶。分桶只是给一个数量级，用来决定框架该写成哪一类，不追求精确分类。
 *
 * 用法：node tools/usage-mix.mjs [--samples]
 */

import fs from "node:fs";
import path from "node:path";
import { dshHome } from "../plugin/state.js";
import { decodeSessionLog, extractInputTexts, parseRecords } from "../auditor/logreader.js";

const withSamples = process.argv.includes("--samples");
const dsh = dshHome();

const BUCKETS = [
	["安全研究", /(漏洞|渗透|扫描|利用|exp|payload|反弹|提权|注入点|fuzz|靶场|shell|cs\b|c2|免杀|钓鱼|内网|red ?team|pentest|exploit)/i],
	["技术开发", /(代码|脚本|插件|报错|编译|部署|接口|函数|架构|重构|测试|dsh|cordis|node|python|git|npm|命令|配置|debug)/i],
	["创作", /(小说|故事|剧情|人设|写一段|续写|对话|情色|黄色|氛围|散文|诗)/],
	["资料/问答", /(是什么|为什么|怎么|如何|区别|原理|介绍|解释|查一下|搜一下)/],
];

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

const NOISE = /^(current runtime context|this session runs|approvals? for this session|<system-reminder>|time sampled|tokens prefixed|non-zero exits|use the read tool|use the glob tool|use the grep tool|web_search results|you are interacting with|the runtime context|final constraints|start with the action|you are an ai agent|you are a coding agent|the operator's machine|prefer showing)/i;

const counts = Object.fromEntries(BUCKETS.map(([label]) => [label, 0]));
const samples = Object.fromEntries(BUCKETS.map(([label]) => [label, []]));
let humanMessages = 0;

for (const file of listLogs(path.join(dsh, "sessions"))) {
	let texts = [];
	try {
		texts = extractInputTexts(parseRecords(decodeSessionLog(fs.readFileSync(file))));
	} catch {
		continue;
	}
	for (const item of texts) {
		if (item.type !== "user/message") continue;
		for (const block of item.text.split(/\n{2,}/)) {
			const line = block.trim();
			if (!line || line.length < 6 || line.length > 1200) continue;
			if (NOISE.test(line)) continue;
			if (!/[\u4e00-\u9fa5]/.test(line) && !/[a-z]{4}/i.test(line)) continue;
			// 只看第一行，避免把整段历史当一条
			const head = line.split("\n")[0];
			for (const [label, pattern] of BUCKETS) {
				if (pattern.test(head)) {
					counts[label] += 1;
					if (samples[label].length < 6) samples[label].push(head.slice(0, 70));
					break;
				}
			}
			humanMessages += 1;
			break;
		}
	}
}

console.log("");
console.log(`人写的第一段  ${humanMessages} 条（跨全部会话）`);
for (const [label] of BUCKETS) {
	const percent = humanMessages ? Math.round((counts[label] / humanMessages) * 100) : 0;
	console.log(`  ${label.padEnd(8)} ${String(counts[label]).padStart(4)}  ${String(percent).padStart(3)}%`);
}
const matched = Object.values(counts).reduce((acc, value) => acc + value, 0);
console.log(`  ${"其他".padEnd(8)} ${String(humanMessages - matched).padStart(4)}  ${String(humanMessages ? Math.round(((humanMessages - matched) / humanMessages) * 100) : 0).padStart(3)}%`);

if (withSamples) {
	console.log("");
	for (const [label] of BUCKETS) {
		if (!samples[label].length) continue;
		console.log(`${label}：`);
		for (const sample of samples[label]) console.log(`  · ${sample}`);
	}
}
console.log("");
