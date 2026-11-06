import fs from "node:fs";
import path from "node:path";
import { appendJsonl, ensureDir, fileBytes, stateRoot } from "./state.js";

/**
 * 账本：每次改写落一条 `{at, channel, name, beforeSha, afterSha}`。
 *
 * 审计器只信这个账本 + 日志里的实际文本，两边对得上才算“处理过”。
 * 上限 2MB：超了就轮转成 .1（只留一代，够查当下这一轮）。
 */
const MAX_BYTES = 2 * 1024 * 1024;

export function ledgerPath() {
  return path.join(stateRoot(), "ledger.jsonl");
}

export function bootPath() {
  return path.join(stateRoot(), "boot.json");
}

export function disabledPath() {
  return path.join(stateRoot(), "disabled.json");
}

/** 记一批改写。channel 是 "assemble" | "refresh"。 */
export function recordRewrites(channel, rewrites, at = new Date().toISOString()) {
  const fp = ledgerPath();
  const size = fileBytes(fp) ?? 0;
  if (size > MAX_BYTES) {
    try {
      fs.renameSync(fp, `${fp}.1`);
    } catch {
      /* 轮转失败就继续写，账本比整洁重要 */
    }
  }
  for (const item of rewrites || []) {
    appendJsonl(fp, {
      at,
      channel,
      name: item.name,
      beforeSha: item.beforeSha,
      afterSha: item.afterSha,
    });
  }
}

/** 读账本；解析不了的行跳过（损坏由审计器另行报告）。 */
export function readLedger(fp = ledgerPath()) {
  let text = "";
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.afterSha) rows.push(row);
    } catch {
      /* 跳过坏行 */
    }
  }
  return rows;
}

/** 记录“包装到底挂上没有”——审计器把它当漏点的一种。 */
export function recordHookState(state) {
  ensureDir(stateRoot());
  appendJsonl(path.join(stateRoot(), "hooks.jsonl"), { at: new Date().toISOString(), ...state });
}
