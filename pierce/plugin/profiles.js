import fs from "node:fs";
import path from "node:path";
import { dshHome } from "./state.js";
import { PACKAGE_ROOT } from "./paths.js";

/**
 * profile 档案 —— 一个模型（或一个模型族）一套可替换的注入正文 + 它的成绩单。
 *
 * 目录约定（按优先级从高到低找）：
 *   $DSH_HOME/pierce/profiles/<id>/   ← 用户自己加的档案
 *   <包内>/profiles/<id>/             ← 随仓库分发的档案
 *
 * 一个档案目录里可以有：
 *   profile.json   元数据：match（模型名匹配）、levers、scores、notes
 *   core.md        可选；省略则继承包内默认正文
 *   post.md        可选；同上
 *
 * 为什么这么设计：换模型最怕的不是措辞不够强，是"哪份正文对这个模型有效"说不清。
 * 所以档案必须自带成绩单（scores），没有分数的档案不许进 registry —— 这一点由
 * tools/bench.mjs 的 --profile 落盘来完成，人工手填的分数会被标成 untrusted。
 */

const DEFAULT_ID = "default";

function listDirs(root) {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 所有可用档案 id（包内 + 用户目录，去重）。 */
export function listProfiles() {
  const ids = new Set();
  for (const name of listDirs(path.join(PACKAGE_ROOT, "profiles"))) ids.add(name);
  for (const name of listDirs(path.join(dshHome(), "pierce", "profiles"))) ids.add(name);
  ids.delete(DEFAULT_ID);
  return [...ids].sort();
}

/** 把档案 id 解析成实际目录（用户目录优先）。找不到返回 null。 */
export function profileDir(id) {
  if (!id) return null;
  for (const root of [path.join(dshHome(), "pierce", "profiles"), path.join(PACKAGE_ROOT, "profiles")]) {
    const dir = path.join(root, id);
    try {
      if (fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* 试下一个 */
    }
  }
  return null;
}

export function readProfileMeta(id) {
  const dir = profileDir(id);
  if (!dir) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "profile.json"), "utf8"));
    return { id, dir, ...meta };
  } catch {
    return { id, dir, match: [id], levers: {}, scores: null, notes: null };
  }
}

/** 全部档案（含元数据），供面板与 bench 用。 */
export function allProfiles() {
  return listProfiles().map((id) => readProfileMeta(id)).filter(Boolean);
}

/**
 * 按"模型线索"挑档案：命中 match 里的任一子串即算。
 * 线索为空 / 命中多个 / 命中零个时都不猜，返回 null（交由用户手选或回落默认）。
 */
export function matchProfile(hint) {
  const value = String(hint ?? "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  const hits = [];
  for (const profile of allProfiles()) {
    const patterns = Array.isArray(profile.match) ? profile.match : [profile.id];
    if (patterns.some((pattern) => pattern && value.includes(String(pattern).toLowerCase()))) hits.push(profile.id);
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * 最终的档案选择。优先级：手选 > 模型线索自动匹配 > 默认（包内正文）。
 * @returns {{id: string, source: "manual"|"auto"|"default", dir: string|null, hint: string|null}}
 */
export function resolveProfile({ manual = "auto", hint = null } = {}) {
  const wanted = String(manual ?? "auto").trim();
  if (wanted && wanted !== "auto") {
    const dir = profileDir(wanted);
    if (dir) return { id: wanted, source: "manual", dir, hint: hint ?? null };
  }
  const auto = matchProfile(hint);
  if (auto) {
    const dir = profileDir(auto);
    if (dir) return { id: auto, source: "auto", dir, hint: hint ?? null };
  }
  return { id: DEFAULT_ID, source: "default", dir: null, hint: hint ?? null };
}

/** 档案覆盖的正文目录（没档案就返回 null）。 */
export function profileFrameDir(profile) {
  if (!profile || !profile.dir) return null;
  try {
    const entries = fs.readdirSync(profile.dir);
    if (entries.includes("core.md") || entries.includes("post.md")) return profile.dir;
  } catch {
    /* 目录不可读就当没有 */
  }
  return null;
}
