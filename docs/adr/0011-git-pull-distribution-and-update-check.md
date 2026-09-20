# 以 git 工作副本分发，更新检查只提醒不执行

EchoSage 不上 Chrome 应用商店——它是给少数几个朋友用的私人工具，上架的审核成本和隐私政策负担都不划算。用户手上是一份 `git clone` 出来的、以「加载已解压的扩展程序」方式常驻的工作副本。由此本扩展自己**只负责发现更新**（定时问 GitHub 要发布版本，与运行版本做语义化比较，把"可用更新"投影成工具栏角标），**执行更新交给用户**：在关于分区按提示运行仓库根目录的 `update.bat` 完成拉取，再点同一处的按钮触发 `chrome.runtime.reload()` 完成重载。

## Considered Options

- **Native Messaging** —— 唯一能让扩展自己执行 `git pull` 的路径，但要求每个用户额外安装并注册一个本地宿主程序。对"给朋友用"这个规模，安装成本比它省下的那次双击高得多。
- **Release 里附带构建好的 zip，用户下载解压** —— 脱离 git，看似更简单，但 unpacked 扩展的 ID 由**加载目录的绝对路径**推导（本项目 manifest 没有 `key` 字段）。解压通常落在带版本号的新目录里，换路径即换 ID，`chrome.storage.local` 随之清空——用户每次更新都要重填 AssemblyAI Key 和全部设置。`git pull` 原地更新、路径恒定，这个问题根本不存在。
- **只 push tag，读 `/tags` 接口** —— 省掉建 Release 这一步，但 GitHub 不保证 `/tags` 的排序（字典序下 `v0.10.0 < v0.9.0`），得把整页 tag 取回来自己挑最大的，且没有 release notes 可指。改为每次发版执行 `gh release create --generate-notes`，读 `/releases/latest`，由 GitHub 保证 "latest" 的语义。

## Consequences

- **`dist/` 必须提交进版本库。** `manifest.json` 指向 `dist/*.js`，而用户机器上不装 Node——`git pull` 拉到的东西必须开箱即用。这是刻意违反"构建产物不进版本库"的常规，不要"修复"它。发版构建关闭 sourcemap（`.map` 占 `dist` 体积的 65% 且每次全量重写）；esbuild 产物本来就不 minify，可读性不依赖 sourcemap。
- **正确性押在发版纪律上。** 角标是"发布版本 > 运行版本"的纯投影，不存已读状态——好处是永远不会与事实不一致，代价是一旦 tag 与 `manifest.version` 漂移（打了 `v1.2.0` 却忘改 manifest），用户拉取重载后不等式依然成立，角标**永远消不掉**，且用户无法自救。因此发版必须走 `npm run release <version>`：版本号只输入一次，由脚本同时写入 `manifest.json` 与 `package.json`、构建、提交、打 tag、建 Release。不要手工发版。
- **拉取与重载是两个动作，只有后者消除可用更新。** 用户跑完脚本时磁盘已是新代码，但内存里的 `manifest.version` 未变，角标仍在。关于分区的文案必须讲清这个因果，否则用户会反复运行脚本。
- **重载会杀掉进行中的捕获会话**（service worker、offscreen 文档、content script 一并拆除）。更新永远不紧急而直播有时效，故捕获期间重载按钮置灰，提示先停止会话。
