import fs from "node:fs";
import path from "node:path";
import { sha256 } from "../plugin/state.js";
import { NEUTRAL_APPROVAL, NEUTRAL_GENERIC, NEUTRAL_SANDBOX, isPolicyText } from "../plugin/detect.js";

/**
 * 对账：把“模型实际看到的文本”拆成片段，逐段判断两件事——
 *   1. 这段是不是在陈述权限/审批/边界（判据与插件共用同一份）；
 *   2. 如果是，它是不是我们产出的（或者根本不是我们能管的）。
 *
 * “我们产出的”有三条判据（Q7 的双条件 + 自有资产）：
 *   a. 片段 sha 出现在账本的 afterSha 里；
 *   b. 片段就是三条中性文案之一；
 *   c. 片段是项目自己的 prompts/ 里的内容（自有资产，按定义不算漏）。
 *
 * 三条都不中 → 漏点。
 */

const NEUTRALS = new Set([NEUTRAL_APPROVAL, NEUTRAL_SANDBOX, NEUTRAL_GENERIC].map((t) => sha256(t)));

/** 把长文本拆成可判定的片段：先按空行分段，再按单行兜底。 */
export function splitFragments(text) {
  const value = String(text ?? "");
  const out = [];
  for (const para of value.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 400) {
      out.push(trimmed);
      continue;
    }
    for (const line of trimmed.split("\n")) {
      const l = line.trim();
      if (l) out.push(l);
    }
  }
  return out;
}

/** 读项目自己的 prompts/*.md，用来认“自有资产”。 */
export function loadOwnPrompts(promptsDir) {
  const texts = [];
  let files = [];
  try {
    files = fs.readdirSync(promptsDir).filter((n) => n.endsWith(".md"));
  } catch {
    return texts;
  }
  for (const name of files) {
    try {
      const body = fs.readFileSync(path.join(promptsDir, name), "utf8");
      if (body.trim()) texts.push(body.replace(/\r\n/g, "\n"));
    } catch {
      /* ignore */
    }
  }
  return texts;
}

function ownedByPrompt(fragment, ownPrompts) {
  const needle = fragment.replace(/\r\n/g, "\n").trim();
  if (needle.length < 8) return false;
  return ownPrompts.some((body) => body.includes(needle));
}

/**
 * @param {Array<{type,seq,at,text}>} texts  模型输入文本
 * @param {Array<{afterSha,name,channel}>} ledger
 * @param {string[]} ownPrompts  项目自己的提示词正文
 */
export function reconcile(texts, ledger, ownPrompts = []) {
  const owned = new Set(ledger.map((row) => String(row.afterSha)));
  const findings = [];
  let policyFragments = 0;

  for (const item of texts) {
    for (const fragment of splitFragments(item.text)) {
      if (!isPolicyText(fragment)) continue;
      policyFragments += 1;
      const digest = sha256(fragment);
      if (owned.has(digest)) continue;
      if (NEUTRALS.has(digest)) continue;
      if (ownedByPrompt(fragment, ownPrompts)) continue;
      findings.push({
        type: item.type,
        seq: item.seq,
        at: item.at,
        fragment: fragment.slice(0, 240),
        sha: digest.slice(0, 12),
      });
    }
  }

  return { findings, policyFragments, checked: texts.length };
}
