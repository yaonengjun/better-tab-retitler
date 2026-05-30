# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 目录性质

本目录是 **Tab ReTitler 浏览器扩展的一次专项修改记录工作区**，不是一个完整的源码仓库。布局如下：

- `tab-retitler/` — **符号链接**，指向真实源码目录 `/Users/chenzhilun.3/codehome/mine-code/tab-retitler`。所有对扩展源码的修改实际写入该真实路径。
- `doc/` — 本次修改的设计与总结文档，**优先阅读**：
  - `100-overview.md`：扩展整体架构、模块职责、数据存储结构、功能清单。
  - `20260515-200-implementplan.md`：本次 SPA 兼容性修复的实施方案（问题定位 + 计划）。
  - `20260515-201-本次改动总结.md`：本次改动的最终方案总结（含 MAIN World 拦截、防抖、监听器修复）。
- `case/10-dongmonitor.html` — 触发问题的 SPA 复现样例（京东 `dongmonitor.jd.com` 离线快照）。
- `tab-retitler-fixed.zip` — 修复后打包的扩展产物。

## 构建与调试

这是一个纯前端 Chrome MV3 扩展，**无构建系统、无包管理、无测试框架**。开发流程：

1. 编辑 `tab-retitler/` 下的源文件（实际写入符号链接目标）。
2. 在 Chrome 中打开 `chrome://extensions/`，开启"开发者模式"，"加载已解压的扩展程序"，指向 `tab-retitler/` 目录。
3. 每次改动后在扩展页点击"重新加载"按钮（或 `Ctrl+R`）。
4. 调试 service worker：在 `chrome://extensions/` 点击该扩展的"Service Worker"链接打开 DevTools。
5. 调试 content script / popup / options：分别在对应页面打开 DevTools。
6. 复现 SPA 场景时使用 `case/10-dongmonitor.html` 或直接访问 `dongmonitor.jd.com`。

打包发布：在 `chrome://extensions/` 点击"打包扩展程序"，或手动 `zip -r tab-retitler-fixed.zip tab-retitler/`（排除 `.DS_Store` 与 `_metadata/`）。

## 核心架构（必读）

扩展由四个 JS 模块组成，**职责分离严格**：

### `js/background.js`（Service Worker，核心引擎）

- **规则匹配优先级**（`checkAndUpdateTitle`）：`Tab#${tabId}` 标签锁 > 精确 URL > `*${domain}*` 域名 > `*pattern*` 自定义通配。改动匹配逻辑时务必保持该顺序。
- **能力检测**（`testTabCapabilities`）：对 `chrome://`、`chrome-extension://`、`about:` 等内部页面降级为 RESTRICTED 模式，不尝试脚本注入。
- **下发标题的双通道**：优先 `chrome.tabs.sendMessage(tabId, { action: 'setTitle' })` 让 content.js 启动锁定；失败时降级到 `chrome.scripting.executeScript` 直接注入。**修改下发逻辑时必须保留降级链**。
- **MAIN World 拦截注入**：通过 `chrome.scripting.executeScript({ world: "MAIN" })` 在页面主世界注入 setter 劫持脚本，配合 `<html data-tabRetitlerLock>` 标记实现零闪烁拦截。这是对抗 Vue / micro-app 等 SPA 框架的关键。
- **存储配额管理**：`chrome.storage.sync` 上限约 100KB，超 95KB 时自动清理最旧条目。新增写入路径时需经过统一的写入函数以触发清理。
- **生命周期清理**：`tabs.onRemoved` 时删除 `Tab#${tabId}` 记录，避免泄漏。

### `js/content.js`（注入到每个页面）

本次修改的重灾区，关键设计：

- **MutationObserver 监听 `<title>` 变化**：必须**直接遍历 `addedNodes` / `removedNodes`** 判断是否有 `title` 节点；**不得**回退到 `!document.querySelector('title')` —— SPA 同步替换 title 节点时该判断恒为假，会导致监听器永久脱落。
- **重新挂载前必须 `disconnect()` 旧 observer**：禁用 `isCleanedUp` 之类的状态门槛，否则会出现 Observer 指数级泄漏。
- **反制覆盖必须经过 `setTimeout(..., 10ms)` 防抖**：MutationObserver 回调本身在微任务队列中，若同步重置 `document.title` 会与 SPA 框架的同步覆盖形成微任务死循环，导致页面假死。**改动反制逻辑时禁止同步写 `document.title`**。
- **消息接口**：`setTitle`（启动锁定）、`clearTitleLock`（释放控制权）、`getTitle`。

### `js/popup.js` / `js/options.js`

- popup 自动填充当前页标题与书签标题；持久化策略 `onetime` / `tablock` / `exact` / `domain`。
- options 三个标签页：已保存标题、默认选项、高级选项（正则替换 + URL 通配 + 导入导出）。
- 两者均使用自定义 i18n 系统（非 `chrome.i18n.getMessage`），支持 `{param}` 占位替换；语言变更通过广播 `refreshLanguage` 消息触发实时刷新。

## 数据存储约定

所有数据存 `chrome.storage.sync`，键的格式直接编码了规则类型，**改键名等于改协议**：

| 键格式 | 类型 |
|--------|------|
| `Tab#${tabId}` | 标签页临时锁定 |
| `https://...`（完整 URL）| 精确匹配 |
| `*${domain}*` | 域名匹配 |
| `*pattern*` | 自定义通配 |
| `options` | 用户偏好（默认策略 + 语言） |

标题模板支持变量：`{original}` / `{domain}` / `{url}` / `{date}` / `{time}` / `$0`，以及自定义 URL 通配中的 `$1`、`$2`...

## 修改时的红线

1. **不要将 `content.js` 的反制覆盖改为同步执行** —— 必须保持 `setTimeout` 防抖宏任务化，否则页面会因微任务循环假死。
2. **不要删除 background.js 中 `sendMessage` → `executeScript` 的降级链** —— 受限页面或 content.js 未就绪时依赖该降级。
3. **不要在 MAIN World 拦截脚本中读写扩展上下文的变量** —— 该脚本运行在页面主世界，无 `chrome.*` API；通过 `<html data-tabRetitlerLock>` 与 content world 通信。
4. **不要绕过存储配额清理写入 `chrome.storage.sync`** —— Sync 配额一旦超限会整体写入失败。

## 多语言

`_locales/` 下 9 种语言（en/zh_CN/ja/de/es/fr/pt/ru/tr）。`manifest.json` 中的字符串通过 `__MSG_xxx__` 占位由 Chrome 自动解析；UI 内的文本由 `popup.js` / `options.js` 自己的翻译表处理，**两套系统并存**，新增文案时需同步更新对应那套。
