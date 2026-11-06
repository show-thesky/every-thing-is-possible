import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/** $DSH_HOME，缺省 ~/.dsh。 */
export function dshHome() {
  const env = String(process.env.DSH_HOME || "").trim();
  return env || path.join(os.homedir(), ".dsh");
}

/** 插件自己的状态根：$DSH_HOME/state/pierce（与项目目录刻意分开）。 */
export function stateRoot() {
  return path.join(dshHome(), "state", "pierce");
}

export function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return dir;
}

export function sha256(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function readJson(fp, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return fallback;
  }
}

/** 原子写：tmp + rename，失败返回 false，不向宿主抛。 */
export function writeJson(fp, value) {
  try {
    ensureDir(path.dirname(fp));
    const tmp = `${fp}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.renameSync(tmp, fp);
    return true;
  } catch {
    return false;
  }
}

export function appendJsonl(fp, value) {
  try {
    ensureDir(path.dirname(fp));
    fs.appendFileSync(fp, `${JSON.stringify(value)}\n`);
    return true;
  } catch {
    return false;
  }
}

export function readText(fp) {
  try {
    return fs.readFileSync(fp, "utf8");
  } catch {
    return null;
  }
}

export function fileBytes(fp) {
  try {
    return fs.statSync(fp).size;
  } catch {
    return null;
  }
}
