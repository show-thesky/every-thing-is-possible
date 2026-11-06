# 下载与安装

面向 DeepSeek Harness 桌面版（Windows）。装完是一个普通插件：注册三段提示词、
挂两个组装钩子，不需要联网，也不改宿主文件。

## 0. 一行搞定（Windows PowerShell）

```powershell
$d="$env:USERPROFILE\.dsh\etip"; if (Test-Path "$d\.git") { git -C $d pull --ff-only } else { git clone https://github.com/show-thesky/every-thing-is-possible $d }; node "$d\pierce\install.mjs"
```

跑完重启宿主即可。下面各节是这条命令没跑通时的手动步骤。

## 1. 取得文件

**方式 A：clone（推荐，任何网络都能用）**

```bash
git clone https://github.com/show-thesky/every-thing-is-possible
```

发行包在 `pierce/dist/`：

```
dsh-pierce-0.1.0.tgz        16 KB   ← 用它装
dsh-pierce-0.1.0-dist.zip   21 KB   ← 不想用包管理器时手动解压
```

**方式 B：Release 直链**

https://github.com/show-thesky/every-thing-is-possible/releases/tag/v0.1.0

注意：直链会 302 到 `objects.githubusercontent.com`，部分网络下这个域名不可达
（表现为超时或 0 字节）。拿不到就用方式 A，两个包内容一致。

## 2. 装进 profile

profile 目录：`%USERPROFILE%\.dsh\profiles\desktop`

**方式 A：包管理器**

```powershell
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm add file:<下载目录>\dsh-pierce-0.1.0.tgz
```

**方式 B：手动（不需要 pnpm）**

1. 解压 tgz 或直接用 `-dist.zip`，把内容放到：
   `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-pierce\`
2. 在 profile 的 `package.json` 里登记两处：

```json
{
  "dependencies": {
    "dsh-pierce": "link:C:/Users/<你>/.dsh/pierce"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-pierce"
      ]
    }
  }
}
```

改之前先备份 `package.json`。

> 只改 `cordis.patch.yml` 是不够的：那是**配置覆盖**，插件本体要靠
> `dsh.profile.bundles` 与 `node_modules` 里的包才会进加载树。

3. 重启宿主。

## 3. 验证装上了

重启后：

```powershell
Get-ChildItem $env:USERPROFILE\.dsh\state\pierce
```

应出现 `boot.json`、`hooks.jsonl`、`ledger.jsonl`、`status.json`。再看状态：

```powershell
node C:\Users\<你>\.dsh\pierce\bin\..\auditor\index.mjs
```

期望输出：

```
账本    N 条
检查    M 段模型输入文本，其中 K 段判为权限类
结果    0 漏 ✓
```

- 目录不存在 → 插件没进树，回去检查第 2 步的两处登记。
- 目录存在但账本 0 条 → 插件加载了但没跑到组装，发一句话再看。
- 有漏点 → 说明某条通道没被覆盖，把输出发出来。

## 4. 卸载 / 回滚

```powershell
node <pierce目录>\install.mjs --remove
```

它会摘掉 junction、撤销 `package.json` 里的 bundles 与依赖、删掉 patch 条目，
然后把之前注释掉的旧插件条目恢复。

## 5. 注意事项

- **不要和同类的旧插件同时启用**：两个插件挂同一批钩子（`system-prompt/assemble`
  与 `refreshContext`），同时生效会互相覆盖，出问题分不清是谁改的。
- 只验证过 **Windows 桌面版**；headless / CLI 没有 web 与 profile 结构，不适用。
- Node 需要 **>= 24**（宿主自带 24.x，低于此版本审计器用不了 zstd）。
- 审计器只认会话日志 **v4**；遇到别的版本会直接报错，不猜。
- 只检查 `system/message` 与 `user/message` 两层；`tool/result` 噪声过大，未纳入。

## 6. 使用声明

仅供学习与研究；不可商用；禁止违法用途；后果自负。详见仓库根目录 README。
