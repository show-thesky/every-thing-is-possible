import fs from "node:fs";
import { decodeSessionLog, parseRecords } from "../auditor/logreader.js";

const files = process.argv.slice(2);
const textOf = (content) =>
	Array.isArray(content)
		? content.map((b) => (b && b.type === "text" ? b.text : "")).filter(Boolean).join("\n")
		: typeof content === "string"
			? content
			: "";

for (const file of files) {
	const records = parseRecords(decodeSessionLog(fs.readFileSync(file)));
	const id = file.split("session-")[1]?.slice(0, 8) ?? "?";
	console.log(`\n=== ${id}  records=${records.length}`);
	for (const record of records) {
		if (record.type === "user/message") {
			const text = textOf(record.data?.content);
			console.log(`[USER seq=${record.seq}] ${text.replace(/\n+/g, " | ").slice(0, 700)}`);
		} else if (record.type === "assistant/message") {
			const text = textOf(record.data?.message?.content);
			if (text.trim()) console.log(`[ASSIST seq=${record.seq}] ${text.replace(/\n+/g, " | ").slice(0, 900)}`);
		} else if (record.type === "system/message") {
			const text = textOf(record.data?.message?.content);
			const hasPierce = text.includes("pierce") || text.includes("穿透");
			console.log(`[SYSTEM seq=${record.seq}] ${text.length} chars, pierce=${hasPierce}`);
		}
	}
}
