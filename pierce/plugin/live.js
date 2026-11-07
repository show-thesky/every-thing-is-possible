import crypto from "node:crypto";

/**
 * 本进程的活状态。
 *
 * 为什么必须有这一层：`status.json` 是 apply 那一刻写的静态快照，回答不了
 * 「钩子到底跑过没有」「上一次组装是什么时候」。面板如果把 status.json 当活数据，
 * 就会出现"已生效"绿灯 + 实际一次没跑过的假绿（旧项目踩过）。
 *
 * 这里只放内存值，不落盘；落盘由 snapshot.js 负责。
 */
export const live = {
  bootId: crypto.randomBytes(6).toString("hex"),
  bootAt: new Date().toISOString(),
  pid: process.pid,
  counters: { assemble: 0, refresh: 0, rewrites: 0, dropped: 0, skipped: 0, errors: 0 },
  hooks: {
    assemble: { attached: false, reason: null },
    refresh: { patched: false, verified: false, reason: null },
  },
  last: { assembleAt: null, refreshAt: null, error: null },
  /** 宿主插值暴露的模型名（拿不到就是 null，绝不猜） */
  model: null,
};

export function bump(key, by = 1) {
  live.counters[key] = (live.counters[key] || 0) + by;
}

/** 出错只记账，绝不向宿主抛 —— 这是插件的硬约束。 */
export function noteError(where, error) {
  live.counters.errors += 1;
  live.last.error = {
    at: new Date().toISOString(),
    where: String(where ?? "?"),
    message: String((error && error.message) || error).slice(0, 300),
  };
}

/** 记模型线索：只在宿主真给了名字时写入，空值不覆盖已有值。 */
export function noteModel(hint) {
  const value = String(hint ?? "").trim();
  if (value) live.model = value;
  return live.model;
}

export function counters() {
  return { ...live.counters };
}

export function uptimeSeconds() {
  const started = Date.parse(live.bootAt);
  return Number.isFinite(started) ? Math.max(0, Math.round((Date.now() - started) / 1000)) : null;
}
