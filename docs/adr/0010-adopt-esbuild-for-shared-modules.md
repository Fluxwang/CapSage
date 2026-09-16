# 引入 esbuild 构建步骤

合并前两个项目都没有构建步骤：EchoCap 用原生 ES modules（`type: module`）但无 bundler；TikTok Caption Studio 连 `package.json` 都没有，是纯 `<script>` 标签风格。合并后共享代码明显变多——AssemblyAI 流式会话、Chrome Translator 封装、悬浮层渲染、options 存取都要被直播实时和视频字幕两个场景同时 import——继续手动管理 `<script>` 加载顺序和相对路径会越来越痛。

## 决定

引入 esbuild，写一个精简的 `build.mjs`，把各浏览器入口（`background.js`、`offscreen.js`、`content-tiktok.js`、`content-overlay.js`、`popup.js`、`options.js`）分别打包到 `dist/`，共享代码放 `shared/` 目录被这些入口 import。开发流程是 `esbuild --watch` + 手动去 `chrome://extensions` 点 reload，不引入 HMR 或专门的扩展开发插件（如 vite-plugin-web-extension）。

`inject.js`（MAIN world、`document_start`，同步打补丁 `fetch`/`XHR`）不进这套 bundle 流程，保持独立、非 module 的自包含文件——它必须在页面最早期同步执行，不能有 import 时序上的不确定性。

`core/` 下的纯逻辑模块（会话 reducer、音频数学、后续的"单轮转写"判定等）继续保持普通 ES module，不经过 bundler，Node 内置 test runner 照样直接 `import` 它们——这是两个项目合并前就确立、要继续保留的测试 seam。

## 为什么不用 Vite

Vite 生态里的扩展插件（`vite-plugin-web-extension` / `@crxjs/vite-plugin`）能自动读 manifest、做多入口构建，甚至给 popup/options 做 HMR，开发体验更顺。但这些插件对 MV3 的 service worker、offscreen document 这类非常规入口支持不如 popup/options 成熟，出问题时要 debug 插件行为而不是自己的代码；对这个个人项目而言，esbuild 一个几十行的构建脚本能解决"共享 import 图"这唯一的实际问题，不需要为了开发体验去接受一整套框架的心智负担和维护成本。

## 后果

- 之后每加一个新的浏览器入口文件，都要在 `build.mjs` 里显式登记，不是自动发现的。
- `manifest.json` 里各处引用的 JS 文件路径要指向 `dist/`，不是 `shared/`/`src/` 里的源文件——改完代码必须先跑一次构建（或让 watch 模式跑着）才能在 Chrome 里看到效果，改了源文件之后忘记等构建完就 reload 扩展是一个容易踩的坑。
- `core/` 与其余源码的构建方式分裂成两条路径（一条经 esbuild 打包进最终 `dist/` 产物，一条被 Node test runner 直接裸 import）——这是有意保留的，不要为了"统一构建方式"把 `core/` 也改成只能经过 bundler 才能跑测试。
