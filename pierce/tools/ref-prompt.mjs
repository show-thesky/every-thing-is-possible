#!/usr/bin/env node
/**
 * 把 dsh-purge 装在本机的那份提示词解出来，只用于**比对**，不进版本库。
 *
 * 它的默认提示词在 npm 包里是封过的：lib/asset-table.js 存 SLOT/MASK/TAG/IV，
 * 封装算法就在同一包的 lib/table-key.js 里（AES-256-GCM，key = sha256(固定串 + MASK)）。
 * 这不是"破解加密"，是它自己的运行时解密路径 —— 我们要的是同一台机器上已安装的
 * 原文，用来回答"新框架和原作有没有重合"。
 *
 * 输出：$DSH_HOME/docs/ref/dsh-purge-<version>.md（不进仓库）
 *
 * 用法：node tools/ref-prompt.mjs [--purge <包目录>]
 */

import fs from "node:fs";
import path from "node:path";
import { createDecipheriv } from "node:crypto";
import { inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { dshHome } from "../plugin/state.js";

const argv = process.argv.slice(2);
const at = argv.indexOf("--purge");
const purgeDir =
	at >= 0 && argv[at + 1]
		? argv[at + 1]
		: path.join(dshHome(), "profiles", "default", "node_modules", "dsh-purge");

function readVersion(dir) {
	try {
		return String(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version || "unknown");
	} catch {
		return "unknown";
	}
}

async function unpack(dir) {
	const tablePath = path.join(dir, "lib", "asset-table.js");
	const keyPath = path.join(dir, "lib", "table-key.js");
	if (!fs.existsSync(tablePath)) throw new Error(`找不到 ${tablePath}`);
	if (!fs.existsSync(keyPath)) throw new Error(`找不到 ${keyPath}`);

	const table = await import(pathToFileURL(tablePath).href);
	const { mixKey } = await import(pathToFileURL(keyPath).href);
	const decipher = createDecipheriv("aes-256-gcm", mixKey(table.MASK), Buffer.from(table.IV, "base64"));
	decipher.setAuthTag(Buffer.from(table.TAG, "base64"));
	const body = Buffer.concat([decipher.update(Buffer.from(table.SLOT, "base64")), decipher.final()]);
	return inflateSync(body).toString("utf8");
}

const version = readVersion(purgeDir);
const text = await unpack(purgeDir);
const outDir = path.join(dshHome(), "docs", "ref");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `dsh-purge-${version}.md`);
fs.writeFileSync(out, text, "utf8");

console.log("");
console.log(`来源    ${purgeDir}`);
console.log(`版本    ${version}`);
console.log(`正文字符 ${text.length}`);
console.log(`写出    ${out}`);
console.log("");
console.log(text.slice(0, 240).split("\n").map((line) => `  ${line}`).join("\n"));
console.log("");
