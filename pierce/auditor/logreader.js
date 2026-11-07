import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * 会话日志读取器。
 *
 * 只认 v4 布局（`session.v4.jsonl.zstd`）：多条 zstd 帧首尾相接，每帧一条记录。
 * 遇到不认识的版本直接报错，不猜 —— 猜错的审计比没有审计更糟。
 */

const MAGIC = [0x28, 0xb5, 0x2f, 0xfd];

/** 多帧 zstd 解码 → 一个 JSONL 文本。 */
export function decodeSessionLog(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("decodeSessionLog 需要 Buffer");
  const starts = [];
  for (let i = 0; i < buffer.length - 3; i += 1) {
    if (buffer[i] === MAGIC[0] && buffer[i + 1] === MAGIC[1] && buffer[i + 2] === MAGIC[2] && buffer[i + 3] === MAGIC[3]) {
      starts.push(i);
    }
  }
  if (!starts.length) throw new Error("不是 zstd：找不到帧头");
  const parts = [];
  for (let k = 0; k < starts.length; k += 1) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : buffer.length;
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(from, to)).toString("utf8"));
    } catch {
      /* 坏帧跳过；最后会按空记录计 */
    }
  }
  return parts.join("");
}

/** 解析 JSONL → 记录数组。 */
export function parseRecords(text) {
  const rows = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      /* 坏行跳过 */
    }
  }
  return rows;
}

/** 版本检查：session 记录的 version 必须是 4。 */
export function assertLogVersion(records) {
  const header = records.find((r) => r && r.type === "session");
  if (!header) return { ok: true, version: null, note: "没有 session 头记录，按 v4 处理" };
  if (header.version !== 4) {
    throw new Error(`不支持的日志版本 ${header.version}（本工具只认 v4）`);
  }
  return { ok: true, version: 4, note: null };
}

function blocksToText(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((block) => (block && block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 抽出模型输入面的文本。
 * system/message 的正文在 data.message.content；user/message 在 data.content。
 */
export function extractInputTexts(records, { since = "" } = {}) {
  const sinceMs = since ? Date.parse(since) : NaN;
  const out = [];
  for (const record of records) {
    if (!record || !record.type) continue;
    if (record.type !== "system/message" && record.type !== "user/message") continue;
    if (Number.isFinite(sinceMs) && Number.isFinite(record.time) && record.time < sinceMs) continue;
    const content = record.type === "system/message" ? record.data?.message?.content : record.data?.content;
    const text = blocksToText(content);
    if (!text.trim()) continue;
    out.push({
      type: record.type,
      seq: record.seq ?? null,
      at: Number.isFinite(record.time) ? new Date(record.time).toISOString() : null,
      text,
    });
  }
  return out;
}

/**
 * 抽出助手回复的正文（拒答识别的输入）。
 *
 * 只取 assistant/message 的文本块：工具调用、思考块都不是给人看的回复，
 * 混进来会让拒答判据误命中（比如工具描述里出现 "I can't"）。
 */
export function extractAssistantTexts(records, { since = "" } = {}) {
  const sinceMs = since ? Date.parse(since) : NaN;
  const out = [];
  for (const record of records) {
    if (!record || record.type !== "assistant/message") continue;
    if (Number.isFinite(sinceMs) && Number.isFinite(record.time) && record.time < sinceMs) continue;
    const text = blocksToText(record.data?.message?.content);
    if (!text.trim()) continue;
    out.push({
      seq: record.seq ?? null,
      at: Number.isFinite(record.time) ? new Date(record.time).toISOString() : null,
      text,
    });
  }
  return out;
}

/** 自动挑一个会话日志：优先最新修改的那个。 */export function findSessionLog(dshHome) {
  const root = path.join(dshHome, "sessions");
  let best = null;
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.startsWith("session.") || !entry.name.endsWith(".jsonl.zstd")) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!best || stat.mtimeMs > best.mtimeMs) best = { path: full, mtimeMs: stat.mtimeMs };
    }
  };
  walk(root, 0);
  return best ? best.path : null;
}
