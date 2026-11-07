# 下载与安装

面向 DeepSeek Harness 桌面版（Windows）。装完是一个普通插件：注册三段提示词、
挂两个组装钩子，不需要联网，也不改宿主文件。

## 1. 取得文件

**方式 A：clone（推荐，任何网络都能用）**

```bash
git clone https://github.com/show-thesky/every-thing-is-possible
```

发行包在 `pierce/dist/`：

```
dsh-pierce-0.3.0.tgz        ~30 KB  ← 用它装
dsh-pierce-0.3.0-dist.zip   ~40 KB  ← 不想用包管理器时手动解压
```

**方式 B：Release 直链**

https://github.com/show-thesky/every-thing-is-possible/releases

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

重启后先看面板：输入框工具条（模型选择器右边）应出现一个「破甲」按钮，点开是
pierce 穿透台。看不到按钮 = 客户端半边没进 boot 图（package.json 的 `dsh.client`
与 `exports["./client"]` 两处都要在，且必须重启过）。

面板里应该看到：`版本 0.3.0`、`破甲已启用`、五格自由开关、一张证据表。发一句话之后
徽章从「待组装」变「已生效」——

```
检查项      期望                实际                    ✓
正文 core   1979 B · …           1979 B · …             ✓
尾段 post    539 B · …            539 B · …              ✓
装配层改写  开 · 每轮处理        已挂 · 调用 3          ✓
消息层改写  开 · 每轮处理        已挂 · 调用 3          ✓
政策句处置  改写为中性文案       入参 2 段 · 改写 2 条  ✓
审计（对账）0 漏点              0 漏 · 检查 N 段输入    ✓
```

再看磁盘：

```powershell
Get-ChildItem $env:USERPROFILE\.dsh\state\pierce
```

应出现 `boot.json`、`hooks.jsonl`、`ledger.jsonl`、`status.json`、`assembly.json`
（面板跑过之后还会有 `prefs.json`、`audit.json`、`panel-web.json`、`panel-port.json`）。

命令行的等价验证：

```powershell
node C:\Users\<你>\.dsh\pierce\auditor\index.mjs
```

期望输出（两条轴分开报）：

```
账本    884 条
检查    5 段模型输入文本，其中 3 段判为权限类
回复    1 条，其中 0 条命中拒答特征

送达    0 漏 ✓
收口    0 次 ✓
```

- 目录不存在 → 插件没进树，回去检查第 2 步的两处登记。
- 目录存在但账本 0 条 → 插件加载了但没跑到组装，发一句话再看。
- 有漏点 → 说明某条通道没被覆盖，把输出发出来。
- `送达 0 漏` 但 `收口 N 次` → 机制没问题，是模型在内容层面拒绝：切「内容·创作」，
  看面板里那条拒答片段，按它改措辞（这一层是概率工程，不是开关）。
- 面板报「面板服务没响应」 → 宿主没注册 `/pierce/api`，且 7314-7321 端口也被占；
  看 `state/pierce/status.json` 的 `panel` 字段（`webError` / `portError`）。

## 4. 面板怎么用

| 想做的事 | 点哪里 | 生效时机 |
|---|---|---|
| 整体停用 / 启用 | 顶部大按钮「破甲已启用 → 点此停用」 | 下一轮组装 |
| 换一套组合 | 四个预设：全开 / 只注入 / 只过滤 / 关闭 | 下一轮组装 |
| 单段开关 | 正文 / 尾段 | 下一轮组装 |
| 单层开关 | 装配层（系统提示词那份）/ 消息层（用户消息那份 runtime-context） | 下一轮组装 |
| 改处置方式 | 处置 [改写 ⇄ 删除] | 下一轮组装 |
| 改判据宽严 | 判据 [激进 ⇄ 结构] | 下一轮组装 |
| 看有没有漏 | 「运行审计」 | 立即（读最新会话日志） |
| 查新版 / 更新 / 重启 | 版本区的三个按钮 | 检查是即时的；更新后需重启 |

版本区会区分三种情况，不糊弄：**有新版**（只显示「更新到 x.y.z」）、
**仓库更旧**（明说"比本地旧"）、**仓库没有正式 release**。装法是 clone 出来的副本时，
「更新」按钮真的会跑 `git pull --ff-only`；开发挂载（junction 到工作目录）没有可 pull
的远端，面板会把那条一行命令直接打出来，让你手动跑。

## 5. 卸载 / 回滚

```powershell
node <pierce目录>\install.mjs --remove
```

它会摘掉 junction、撤销 `package.json` 里的 bundles 与依赖、删掉 patch 条目，
然后把之前注释掉的旧插件条目恢复。

## 6. 注意事项

- **不要和同类的旧插件同时启用**：两个插件挂同一批钩子（`system-prompt/assemble`
  与 `refreshContext`），同时生效会互相覆盖，出问题分不清是谁改的。面板上的开关
  也只管本插件。
- 面板开关只写 `~/.dsh/state/pierce/prefs.json`，**不改** profile 的 `package.json`
  与 `cordis.patch.yml`；「复位」就是删这个文件。
- 改了 `plugin/client.js`（界面）之后**必须重启宿主**：客户端半边在启动时进 boot 图，
  不重启页面里还是旧的。只改 `prompts/*.md`、`plugin/detect.js`、`plugin/prefs.js`
  这类宿主侧代码不需要重启，下一轮组装就生效。
- 只验证过 **Windows 桌面版**；headless / CLI 没有 web 与 profile 结构，不适用。
- Node 需要 **>= 24**（宿主自带 24.x）。
- 审计器只认会话日志 **v4**；遇到别的版本会直接报错，不猜。
- 只检查 `system/message` 与 `user/message` 两层；`tool/result` 噪声过大，未纳入。

## 7. 使用声明

仅供学习与研究；不可商用；禁止违法用途；后果自负。详见仓库根目录 README。
