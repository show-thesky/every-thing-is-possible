# dsh-pierce 设计（v1）

日期：2026-11-06
状态：已确认，开始实现

## 1. 问题

上一代做法（bingbing）只覆盖两条通道：`system-prompt/assemble` 的上下文，和
`refreshContext` 的重读结果。它有两个结构性问题：

- **白名单式覆盖**：只认名字里带 approval/sandbox 的上下文，新通道一出现就漏
  （0.2.2 已经新增“历史内系统提示词替换”，同一段文本不走新 assembly）。
- **静态文案判据**：靠 6 条英文原句；宿主改文案、换语言、改名字都会失效。

而模型实际看到什么，**落盘日志里是有的**：`session.v4.jsonl.zstd` 里的
`system/message` 与 `user/message` 记录保存了模型收到的完整文本。这条事实让
“覆盖面对账”可以建立在真凭实据上，而不是靠猜宿主有哪些通道。

## 2. 目标（已确认）

- **A 覆盖面**：不再漏通道。
- **B 稳定性**：宿主换代、改文案、改名字时不失效。

明确不做：内容类绕过（跟模型权重对抗）、隐蔽性对抗、自动修复。

## 3. 决定（grilling 结论）

| # | 决定 |
|---|---|
| Q1 | 两件套：极简插件（只做改写）+ 独立审计 CLI |
| Q2 | 零配置：只有一个正文文件 `prompts/core.md`，紧急关闭 = 删 `state/boot.json` |
| Q3 | 只碰文档化服务方法；允许包装 `refreshContext`（b 档），但必须带调用计数 |
| Q4 | 只做 DSH 桌面版 Windows |
| Q5 | 硬指标：真实会话上对账 0 漏 |
| Q6 | 完全独立，不 import 旧项目任何代码 |
| Q7 | “处理过”= 双条件：内容指纹对得上 **且** 账本里有该通道记录 |
| Q8 | 判据：结构特征为主 + 词元兜底；不调模型 |
| Q9 | v1 只扫 `system/message` + `user/message` |
| Q10 | 插件只挂三个 hook：sections、assemble waterfall、refreshContext 包装 |
| Q11 | 审计器手动跑，只看本次启动之后的记录（boot 标记） |
| Q12 | 只报告，不自动补；（fail-loud 不进 v1） |

系统侧判据激进、用户侧保守（Q2 的 C 档）：系统提示词里没有第三方文本，可以狠；
用户消息里混着用户原话，只能按精确句式。

## 4. 结构

```
pierce/
  plugin/
    index.js      入口：三个 hook + boot 标记 + 状态落盘
    sections.js   三段注册（pre / core / post，正文现读 prompts/）
    detect.js     判据与改写（插件与审计器共用同一份）
    ledger.js     记账：每次改写写 (channel,name,beforeSha,afterSha,at)
    state.js      路径、原子写、jsonl、sha256
  auditor/
    index.mjs     CLI：读日志 → 判据 → 对账 → 报告
    logreader.js  zstd 多帧解码 + v4 记录解析（容错）
    reconcile.js  与 ledger 对账，产出漏点列表
  prompts/        core.md（正文，用户可改）/ pre.md / post.md
  tests/selftest.mjs
```

## 5. 数据流

1. 宿主装配 → 插件注册的三段进入系统提示词。
2. `system-prompt/assemble` waterfall → 按判据改写 contexts（系统侧激进）。
3. 包装后的 `refreshContext` → 改写“重读”出来的 contexts（消息层，上一代漏的那条）。
4. 每次改写落账：`{at, channel, name, beforeSha, afterSha}`。
5. 审计器读日志中本次 boot 之后的 `system/message` 与 `user/message`。
6. 对每段文本跑同一份判据；判为策略文本 **且**（指纹不在账本，或与账本 afterSha 不符）
   → 记为漏点。
7. 报告：漏点 + 记录 seq + 通道 + 原文片段（截断）。

## 6. 错误处理

- 三个 hook 各自 try/catch：出错只记账，绝不向宿主抛。
- 包装失败（属性只读 / 调用点提前绑定）→ 账本记 `patched:false`，审计器把它本身当漏点报。
- 日志格式不认识（非 v4、缺字段）→ 明确报“格式不支持”，不猜、不静默。
- 账本损坏 → 审计器报“账本不可读”，此时全部判为漏点（宁可红，不可假绿）。

## 7. 测试

- 单元：判据（英文官方句、中文权限句、cwd 行、用户原话），改写（名字命中 / 判据命中）。
- 单元：对账（有账本 → 0 漏；删一条账 → 1 漏）。
- 集成：合成多帧 zstd 日志，跑通 logreader + reconcile。
- 现场：真实会话后人工跑一次，要求 0 漏。

## 8. 验收

审计 0 漏（硬）；三个边界问题人工过（软，仅作旁证）。

## 9. 风险

- 判据误伤：靠“系统侧激进 / 用户侧保守”的分档 + 事实类上下文白名单（cwd/checkout/URL 永不改）。
- 包装静默失效：靠 calls 计数进账本 + 审计器把缺失计数当漏点。
- 日志格式演进：v4 硬编码，遇到 v5 明确报错而不是猜。
