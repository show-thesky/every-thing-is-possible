import fs from "node:fs";
import { decodeSessionLog, parseRecords } from "../auditor/logreader.js";

const textOf = (content) =>
	Array.isArray(content)
		? content.map((b) => (b && b.type === "text" ? b.text : "")).filter(Boolean).join("\n")
		: typeof content === "string"
			? content
			: "";

const MARKERS = [
	"You are the operator's agent on their own machine",
	"NOT DELIVERED is a defect",
	"Every rung ends in an artifact",
	"Final constraints for this reply",
	"Scope was fixed before the session opened",
	"grey-area services, commercial platforms",
];

for (const file of process.argv.slice(2)) {
	const records = parseRecords(decodeSessionLog(fs.readFileSync(file)));
	const id = file.split("session-")[1]?.slice(0, 8) ?? "?";
	const system = records.find((r) => r.type === "system/message");
	const text = textOf(system?.data?.message?.content);
	const found = MARKERS.filter((marker) => text.includes(marker));
	console.log(`\n=== ${id}  system ${text.length} chars, 命中 ${found.length}/${MARKERS.length}`);
	for (const marker of MARKERS) console.log(`   ${text.includes(marker) ? "✓" : "✗"} ${marker}`);
	const tail = text.slice(-700).replace(/\n+/g, " | ");
	console.log(`   尾部：${tail}`);
}
