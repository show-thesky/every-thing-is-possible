#!/usr/bin/env node
/**
 * 打包：dist/dsh-pierce-<version>.tgz（给人装）+ dist/dsh-pierce-<version>-dist.zip（手动解压）。
 *
 * tgz 用 npm pack 生成，清单由 package.json 的 files 决定 —— 也就是说
 * **发布内容 = files 列表**，别在这里另写一份，否则迟早对不上。
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./", import.meta.url)).replace(/[\\/]$/, "");
const DIST = path.join(ROOT, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

fs.mkdirSync(DIST, { recursive: true });

// 1) tgz
const packed = spawnSync("npm", ["pack", "--pack-destination", DIST], {
  cwd: ROOT,
  encoding: "utf8",
  shell: true,
  windowsHide: true,
});
if (packed.status !== 0) {
  console.error(`npm pack 失败：${packed.stderr || packed.stdout}`);
  process.exit(1);
}
const tgz = path.join(DIST, `dsh-pierce-${pkg.version}.tgz`);
if (!fs.existsSync(tgz)) {
  console.error(`没有生成 ${tgz}`);
  process.exit(1);
}

// 2) zip（手动解压用；内容与 files 一致）
const stage = path.join(DIST, ".stage");
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
for (const entry of pkg.files || []) {
  const from = path.join(ROOT, entry);
  if (!fs.existsSync(from)) continue;
  const to = path.join(stage, entry);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}
// package.json 必须跟着走，否则安装侧读不到 dsh.bundle
fs.copyFileSync(path.join(ROOT, "package.json"), path.join(stage, "package.json"));

const zip = path.join(DIST, `dsh-pierce-${pkg.version}-dist.zip`);
fs.rmSync(zip, { force: true });
const zipped = spawnSync(
  "powershell",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`],
  { encoding: "utf8", windowsHide: true },
);
if (zipped.status !== 0) {
  console.error(`压缩失败：${zipped.stderr || zipped.stdout}`);
  process.exit(1);
}
fs.rmSync(stage, { recursive: true, force: true });

const kb = (fp) => Math.round((fs.statSync(fp).size / 1024) * 10) / 10;
console.log(`\n▸ dsh-pierce ${pkg.version}`);
console.log(`  ${path.basename(tgz)}   ${kb(tgz)} KB`);
console.log(`  ${path.basename(zip)}   ${kb(zip)} KB`);
console.log(`  内容：${(pkg.files || []).join("  ")}  + package.json\n`);
