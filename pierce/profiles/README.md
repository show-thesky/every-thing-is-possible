# profiles —— 每个模型一份档案

一个档案 = 一套可替换的注入正文 + 它的成绩单。目录约定：

```
profiles/<id>/profile.json   元数据：match（模型名匹配）、levers、scores、notes
profiles/<id>/core.md        可选；省略则继承包内默认正文
profiles/<id>/post.md        可选；同上
```

查找顺序（高 → 低）：

```
1. $DSH_HOME/pierce/frame/            用户临时覆盖（试措辞用，优先级最高）
2. <包内或 $DSH_HOME>/profiles/<id>/  模型档案
3. <包内>/prompts/                    默认正文
```

`$DSH_HOME/pierce/profiles/<id>/` 可以放同名档案覆盖随仓库分发的那份。

## 档案怎么选

优先级：**手选 > 模型线索自动匹配 > 默认**

- 手选：`state/pierce/prefs.json` 里的 `"profile": "glm"`（面板上等同下拉）
- 自动：拿模型线索（`glm`、`qwen`…）去比每条档案的 `match`；**命中 0 个或 2 个以上都不猜**，回落默认
- 默认：包内 `prompts/core.md` + `post.md`

不猜是刻意的：选错档案比没选更糟 —— 会让人误以为"这个模型不吃这套"。

## 进 registry 的门槛

`scores` 由 `tools/bench.mjs --profile <id>` 写，不是手填。一个档案要算"可用"，至少满足：

1. 同批用例有**对照臂**（关掉注入跑一次），证明有效果差；
2. 拒答 ≤ 1/16 且送达 0 漏；
3. 记录日期、模型全名、CLI 版本 —— 宿主或模型一升级，分数就失效。

手填的分数一律标 `"untrusted": true`。
