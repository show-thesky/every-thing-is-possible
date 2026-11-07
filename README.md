# everything-is-possible

用于学习的仓库，具体为破dsh甲，下载安装方式看版本

## 一行安装（Windows PowerShell）

```powershell
$d="$env:USERPROFILE\.dsh\etip"; if (Test-Path "$d\.git") { git -C $d pull --ff-only } else { git clone https://github.com/show-thesky/every-thing-is-possible $d }; node "$d\pierce\install.mjs"
```

跑完**重启一次 DeepSeek Harness** 就生效。这条命令做三件事：把仓库克隆到 `~\.dsh\etip`（已存在则 `pull`）、把 `pierce` 挂进 profile、在 `package.json` 里登记 bundles 与 link 依赖。

需要 git 与 Node 24+；网络拿不到 github.com 时，先在命令前加代理：`git config --global http.proxy socks5h://127.0.0.1:10808`。

## 下载与安装

- 发行包（Release）：https://github.com/show-thesky/every-thing-is-possible/releases
- 仓库内副本：`pierce/dist/dsh-pierce-0.3.0.tgz`（clone 后直接取得；部分网络下 Release 直链不可达）
- 详细步骤：[`pierce/INSTALL.md`](pierce/INSTALL.md)

## 目录

- [`pierce/`](pierce/) —— DeepSeek Harness 提示词组装层的研究性工具。看它如何把上下文拼进系统提示词、模型最终读到的文本从哪里来，并提供一个可对账的审计方式。
  - 下载与安装：[`pierce/INSTALL.md`](pierce/INSTALL.md)
  - v0.3.0 实测报告：[`pierce/docs/v0.3.0-report.md`](pierce/docs/v0.3.0-report.md)（体积 / 送达 / 能力 / 相重）
  - 发行包：`pierce/dist/dsh-pierce-0.3.0.tgz`（clone 后直接取得）

## 使用声明

1. **仅供学习与研究**。代码用于理解提示词组装机制、验证自己对宿主行为的判断，不是为了绕开任何产品的限制。
2. **不可商用**。不得用于售卖、付费交付、卖课、打包进付费产品，或以本项目作为收费卖点。
3. **禁止违法用途**。不得用于未授权入侵、诈骗、勒索、传播恶意载荷，以及其他违反所在地法律的行为。
4. **后果自负**。本项目按现状提供，不附带任何明示或暗示的保证。下载、运行、修改、传播及由此产生的一切后果由使用者自行承担，作者不承担任何责任。

如果你不同意以上任何一条，请不要使用本仓库的任何内容。
