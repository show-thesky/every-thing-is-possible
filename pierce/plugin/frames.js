import { PROMPTS_DIR, userFrameDir } from "./paths.js";
import { resolveProfile, profileFrameDir } from "./profiles.js";
import { readPrefsFile } from "./prefs.js";
import { live } from "./live.js";

/**
 * 注入正文的最终解析：把"用户覆盖 / 模型档案 / 包内默认"拼成一条搜索路径。
 *
 * 这是三级别加载的唯一入口 —— 段注册、面板证据表、bench 都从这里取，
 * 免得三处各算一遍然后互相矛盾。
 *
 * 顺序即优先级（readPrompt 取第一个存在的文件）：
 *   1. $DSH_HOME/pierce/frame/           用户临时覆盖（试措辞）
 *   2. profiles/<id>/                    模型档案（自动或手选）
 *   3. <包内>/prompts/                   默认
 */
export function currentProfile() {
  const file = readPrefsFile();
  const manual = file && typeof file.profile === "string" ? file.profile : "auto";
  return resolveProfile({ manual, hint: live.model ?? null });
}

export function frameDirs() {
  const dirs = [];
  const override = userFrameDir();
  if (override) dirs.push(override);
  const profile = currentProfile();
  const profileDir = profileFrameDir(profile);
  if (profileDir) dirs.push(profileDir);
  dirs.push(PROMPTS_DIR);
  return dirs;
}

/** 面板/状态用：正文从哪来、档案是谁、模型线索是什么。 */
export function frameInfo() {
  const profile = currentProfile();
  return {
    profile: { id: profile.id, source: profile.source, dir: profile.dir },
    model: live.model ?? null,
    dirs: frameDirs(),
    override: userFrameDir(),
  };
}
