import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getJson } from "./netjson.js";
import { readJson, stateRoot, writeJson } from "./state.js";

/**
 * 版本信息与更新。
 *
 * 面板要回答四个问题：本地是几、仓库最新是几、谁新、怎么更新。
 * 全部按"能查就查、查不到就说清楚"处理 —— 不编造、不把"仓库更旧"包装成"有更新"。
 */
export const REPO = {
  owner: "show-thesky",
  name: "every-thing-is-possible",
  url: "https://github.com/show-thesky/every-thing-is-possible",
  subdir: "pierce",
};

/** 首页那条一行命令：clone/pull → 挂载 → 登记。更新与首次安装是同一条。 */
export const INSTALL_ONE_LINER =
  '$d="$env:USERPROFILE\\.dsh\\etip"; if (Test-Path "$d\\.git") { git -C $d pull --ff-only } else { git clone https://github.com/show-thesky/every-thing-is-possible $d }; node "$d\\pierce\\install.mjs"';

const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function updateCachePath() {
  return path.join(stateRoot(), "update.json");
}

export function restartScriptPath() {
  return path.join(stateRoot(), "restart.cmd");
}

/** "v0.2.1-rc.1" → {nums:[0,2,1], pre:"rc.1"}；解析不了返回 null。 */
export function parseVersion(text) {
  const clean = String(text ?? "").trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.+-]+))?$/.exec(clean);
  if (!match) return null;
  return { nums: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] || null };
}

/** 语义比较：a<b → -1，相等 → 0，a>b → 1；任一边解析不了 → null。 */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left.nums[index] !== right.nums[index]) return left.nums[index] < right.nums[index] ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1; // 正式版 > 预发布
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

export function readUpdateCache() {
  const cache = readJson(updateCachePath(), null);
  if (!cache) return null;
  const at = Date.parse(cache.at || "");
  return { ...cache, stale: !Number.isFinite(at) || Date.now() - at > CACHE_MAX_AGE_MS };
}

/**
 * 查仓库最新 release。结果落盘做缓存（面板打开时先显示上次结果，不必每次打网络）。
 * 网络不通不抛错，返回 {ok:false, error}，由面板老实显示。
 */
export async function checkVersion(localVersion) {
  const local = String(localVersion || "").replace(/^v/i, "") || null;
  const response = await getJson(`https://api.github.com/repos/${REPO.owner}/${REPO.name}/releases?per_page=20`, {
    timeoutMs: 9000,
  });

  const at = new Date().toISOString();
  if (!response.ok || !Array.isArray(response.json)) {
    const error =
      response.error ||
      (response.json && response.json.message ? `GitHub：${response.json.message}` : null) ||
      `HTTP ${response.status || "?"}`;
    const payload = { at, ok: false, error, local, repo: REPO.url, latest: null };
    writeJson(updateCachePath(), payload);
    return payload;
  }

  let best = null;
  for (const release of response.json) {
    if (!release || release.draft || release.prerelease) continue;
    if (!parseVersion(release.tag_name)) continue;
    if (!best || compareVersions(release.tag_name, best.tag_name) > 0) best = release;
  }
  if (!best) {
    const payload = { at, ok: true, error: null, local, repo: REPO.url, latest: null, note: "仓库里还没有正式 release" };
    writeJson(updateCachePath(), payload);
    return payload;
  }

  const latest = String(best.tag_name || "").replace(/^v/i, "");
  const cmp = local ? compareVersions(latest, local) : null;
  const payload = {
    at,
    ok: true,
    error: null,
    local,
    repo: REPO.url,
    latest,
    latestTag: best.tag_name,
    latestName: best.name || null,
    publishedAt: best.published_at || null,
    releaseUrl: best.html_url || `${REPO.url}/releases/tag/${best.tag_name}`,
    body: String(best.body || "").slice(0, 600),
    assets: (best.assets || []).map((asset) => ({ name: asset.name, size: asset.size })),
    updateAvailable: cmp !== null && cmp > 0,
    behind: cmp !== null && cmp < 0,
    cmp,
  };
  writeJson(updateCachePath(), payload);
  return payload;
}

/** 向上找 git 仓库根。开发挂载（junction 到工作目录）与用户 clone 都能定位。 */
function findGitRoot(start) {
  let dir = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch {
      /* ignore */
    }
    const up = path.dirname(dir);
    if (!up || up === dir) break;
    dir = up;
  }
  return null;
}

// 面板每 5 秒拉一次 /state，而定位安装方式要起一个 git 子进程 —— 不能每次都跑。
const INSTALL_TTL_MS = 60_000;
let installCache = { at: 0, root: null, value: null };

/**
 * 这次装的是"clone 出来的副本"还是"开发挂载"—— 决定更新按钮能不能真干活。
 * 结果按 root 缓存 60 秒（版本区刷新不需要每次都问 git）。
 */
export function installInfo(root) {
  const key = path.resolve(root);
  const now = Date.now();
  if (installCache.value && installCache.root === key && now - installCache.at < INSTALL_TTL_MS) {
    return installCache.value;
  }
  const gitRoot = findGitRoot(key);
  let remote = null;
  if (gitRoot) {
    try {
      remote = execFileSync("git", ["-C", gitRoot, "config", "--get", "remote.origin.url"], {
        encoding: "utf8",
        timeout: 4000,
        windowsHide: true,
      }).trim();
    } catch {
      remote = null;
    }
  }
  const pullable = Boolean(remote && /every-thing-is-possible/i.test(remote));
  const value = {
    root: key,
    kind: pullable ? "git" : "linked",
    gitRoot,
    remote,
    pullable,
    command: INSTALL_ONE_LINER,
  };
  installCache = { at: now, root: key, value };
  return value;
}

/** 能 pull 就 pull；不能就返回要手动跑的命令（不假装成功）。 */
export function applyUpdate(root) {
  const install = installInfo(root);
  if (!install.pullable) {
    return {
      ok: false,
      mode: "manual",
      install,
      error: "当前是开发挂载（远端不是发布仓库）：没有可 pull 的副本",
      command: INSTALL_ONE_LINER,
    };
  }
  try {
    const output = execFileSync("git", ["-C", install.gitRoot, "pull", "--ff-only"], {
      encoding: "utf8",
      timeout: 60000,
      windowsHide: true,
    });
    const restart = writeRestartScript();
    return { ok: true, mode: "git", install, output: String(output || "").slice(0, 2000), restart };
  } catch (e) {
    const detail = String((e && e.stderr) || (e && e.message) || e).slice(0, 800);
    return {
      ok: false,
      mode: "git",
      install,
      error: detail,
      command: `git -C "${install.gitRoot}" pull --ff-only`,
    };
  }
}

/** 生成 restart.cmd（只生成，不执行）：面板上的「重启」按钮交给用户双击。 */
export function writeRestartScript() {
  const exe = process.env.DSH_APP_EXE || path.join(process.env.LOCALAPPDATA || "", "Programs", "DeepSeek Harness", "DeepSeek Harness.exe");
  const lines = [
    "@echo off",
    "rem 由 dsh-pierce 面板生成：宿主重启后，客户端半边与新的插件代码才会重新加载",
    `set "EXE=${exe}"`,
    'taskkill /IM "DeepSeek Harness.exe" /F >nul 2>&1',
    "timeout /t 2 >nul",
    'if exist "%EXE%" (start "" "%EXE%") else (echo 找不到 %EXE%，请手动启动)',
    "",
  ];
  const file = restartScriptPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\r\n"), "utf8");
    return { path: file, at: new Date().toISOString(), exe };
  } catch (e) {
    return { path: null, at: new Date().toISOString(), error: String((e && e.message) || e) };
  }
}
