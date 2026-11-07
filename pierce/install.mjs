#!/usr/bin/env node
/**
 * 安装 / 卸载 dsh-pierce。
 *
 * 这个 profile 的插件不是靠 package.json 依赖挂的，而是：
 *   1. 包目录出现在 `profiles/<profile>/node_modules/<包名>`
 *   2. `cordis.patch.yml` 里有一条 `- id: X / name: <包名>`
 * 所以安装 = 建链接 + 改 patch，不需要 pnpm（本机也没装）。
 *
 * 冲突处理：profile 里的旧破甲（bingbing）会被**注释掉**而不是删除 ——
 * 两个插件挂同一批 hook，同时生效会互相覆盖。注释掉之后随时能恢复。
 *
 * 用法：
 *   node install.mjs --dry-run
 *   node install.mjs
 *   node install.mjs --remove
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url)).replace(/[\\/]$/, "");
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const PROFILE = process.env.DSH_PROFILE || "desktop";
const PROFILE_DIR = path.join(DSH_HOME, "profiles", PROFILE);
const MODULES = path.join(PROFILE_DIR, "node_modules");
const LINK = path.join(MODULES, "dsh-pierce");
const PATCH = path.join(PROFILE_DIR, "cordis.patch.yml");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const remove = argv.includes("--remove");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function log(msg) {
  console.log(msg);
}
function die(msg) {
  console.error(`  ✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(PROFILE_DIR)) die(`找不到 profile：${PROFILE_DIR}`);

/* ── 定位一个 patch 条目块：从 "- id: X" 到下一个顶格 "- " 之前 ──────────── */
function findBlock(lines, id) {
  const start = lines.findIndex((line) => new RegExp(`^- id:\\s*${id}\\b`).test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^- /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function commentOut(lines, block) {
  return lines.map((line, i) =>
    i >= block.start && i < block.end && line.trim() ? `# ${line}` : line
  );
}

function uncomment(lines, id) {
  const out = [];
  let inside = false;
  for (const line of lines) {
    if (new RegExp(`^# - id:\\s*${id}\\b`).test(line)) inside = true;
    if (inside && /^# /.test(line)) out.push(line.replace(/^# /, ""));
    else {
      if (inside && line.trim() === "") out.push(line);
      else {
        inside = inside && /^# /.test(line);
        out.push(line);
      }
    }
  }
  return out;
}

if (!fs.existsSync(PATCH)) die(`找不到 ${PATCH}`);
let text = fs.readFileSync(PATCH, "utf8");
let lines = text.replace(/\r\n/g, "\n").split("\n");

log(`\n▸ ${remove ? "卸载" : "安装"} dsh-pierce → ${PROFILE_DIR}`);
log(`  项目  ${ROOT}`);
log(`  挂载  ${LINK}`);

if (!remove) {
  const bing = findBlock(lines, "bingbing");
  const already = lines.some((line) => /^- id:\s*pierce\b/.test(line));
  if (bing) log(`  冲突  bingbing 条目（第 ${bing.start + 1}-${bing.end} 行）将被注释掉`);
  log(`  patch ${already ? "已有 pierce 条目，跳过追加" : "追加 pierce 条目"}`);
}

if (dryRun) {
  log("\n  （--dry-run：只打印，不动磁盘）\n");
  process.exit(0);
}

fs.copyFileSync(PATCH, `${PATCH}.bak-${stamp}`);
log(`  备份  ${path.basename(PATCH)}.bak-${stamp}`);

if (remove) {
  const PKG = path.join(PROFILE_DIR, "package.json");
  try {
    fs.rmSync(LINK, { recursive: true, force: true });
    log("  ✓ 链接已删除");
  } catch (e) {
    log(`  ! 删链接失败：${e.message}`);
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
    if (pkg.dependencies) delete pkg.dependencies["dsh-pierce"];
    if (pkg.dsh?.profile?.bundles) pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((b) => b !== "dsh-pierce");
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
    log("  ✓ package.json 已撤销登记");
  } catch (e) {
    log(`  ! 撤销 package.json 失败：${e.message}`);
  }
  const block = findBlock(lines, "pierce");
  if (block) lines.splice(block.start, block.end - block.start);
  lines = uncomment(lines, "bingbing");
  fs.writeFileSync(PATCH, lines.join("\n"), "utf8");
  log("  ✓ patch 已还原（pierce 移除，bingbing 恢复）");
  log("\n  重启宿主后生效。\n");
  process.exit(0);
}

/* ── 安装 ─────────────────────────────────────────────────────────────── */
fs.mkdirSync(MODULES, { recursive: true });
// 真正的挂载点是 package.json：bundles 列表 + link: 依赖。
// 只写 cordis.patch.yml 等于只写了一条覆盖规则，插件根本不在树里（踩过）。
const PKG = path.join(PROFILE_DIR, "package.json");
const PKG_BACKUP = `${PKG}.bak-${stamp}`;

try {
  if (fs.existsSync(LINK)) fs.rmSync(LINK, { recursive: true, force: true });
  fs.symlinkSync(ROOT, LINK, "junction");
  log("  ✓ junction 建立");
} catch (e) {
  die(`junction 失败：${e.message}`);
}

const bing = findBlock(lines, "bingbing");
if (bing) {
  lines = commentOut(lines, bing);
  log("  ✓ bingbing 条目已注释");
}

// —— package.json：bundles + link 依赖 ——
try {
  const pkg = JSON.parse(fs.readFileSync(PKG, "utf8"));
  fs.copyFileSync(PKG, PKG_BACKUP);
  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies["dsh-pierce"] = `link:${ROOT.replace(/\\/g, "/")}`;
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];
  if (!bundles.includes("dsh-pierce")) bundles.push("dsh-pierce");
  pkg.dsh.profile.bundles = bundles;
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + "\n");
  log(`  ✓ package.json 已登记（bundles + link:）  备份 ${path.basename(PKG_BACKUP)}`);
} catch (e) {
  die(`改 package.json 失败：${e.message}`);
}

if (!lines.some((line) => /^- id:\s*pierce\b/.test(line))) {
  const entry = ["", "# dsh-pierce：加载即生效（三段注入 + 装配层/消息层改写）", "- id: pierce", "  name: dsh-pierce", "  config:", "    enabled: true", ""];
  lines = [...lines, ...entry];
  log("  ✓ pierce 条目已追加");
}

fs.writeFileSync(PATCH, lines.join("\n"), "utf8");

log("\n  下一步：重启宿主（客户端半边要重新进 boot 图，不重启看不到面板），然后");
log("    · 输入框工具条右边会出现「破甲」按钮 —— 那就是面板");
log("    · node auditor/index.mjs 做命令行对账\n");
