import fs from "node:fs";
import path from "node:path";
import { appendJsonl, ensureDir, fileBytes, sha256, stateRoot } from "./state.js";

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

/* ── 自有资产账本 ────────────────────────────────────────────────────────
 * 我们注入过的每一版段文本都要留档：审计器判"这段权限句算不算漏"时，除了看
 * 当前 prompts/ 目录，还要认**历史上我们自己写过的版本**。
 *
 * 不这么做的话，每次改提示词，旧版本残留在会话里的文本就会被判成漏点 ——
 * 实测换框架当天就报了 9 处假漏点（own 文本找不到归属）。这不是覆盖失败，
 * 是对账口径少了"历史自有资产"这一档。
 */
const SEEN_ASSETS = new Set();

function assetsPath() {
  return path.join(stateRoot(), "assets.jsonl");
}

/** 记一版段文本（同 sha 只记一次，内存去重）。 */
export function recordAssetText(name, text, at = new Date().toISOString()) {
  const value = String(text ?? "");
  if (!value.trim()) return false;
  const sha = sha256(value);
  if (SEEN_ASSETS.has(sha)) return false;
  SEEN_ASSETS.add(sha);
  appendJsonl(assetsPath(), { at, name: String(name ?? ""), bytes: Buffer.byteLength(value, "utf8"), sha256: sha, text: value });
  return true;
}

/** 记一个 assembly 里属于我们的段（名字以 pierce: 开头）。 */
export function recordSectionAssets(sections = []) {
  let added = 0;
  for (const section of sections) {
    const name = String(section?.name ?? "");
    if (!name.startsWith("pierce:")) continue;
    if (recordAssetText(name, section?.text ?? "")) added += 1;
  }
  return added;
}

/** 读历史自有资产正文（给审计器当"这是什么"的白名单）。 */
export function readAssetTexts(limit = 60) {
  let rows = [];
  try {
    rows = fs
      .readFileSync(assetsPath(), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((row) => row && typeof row.text === "string" && row.text.trim());
  } catch {
    return [];
  }
  return rows.slice(-limit).map((row) => row.text);
}

