# 修复 Tab ReTitler 在 SPA 页面修改标题失效的实施方案

## 问题描述

`tab-retitler` 插件目前无法在 `dongmonitor.jd.com` （使用了 Vue 和京东的 `micro-app` 微前端框架）等页面修改和固化自定义的标签页标题。经过深入分析，定位到两个核心缺陷：

1. **`MutationObserver` 监听脱落漏洞**：`content.js` 脚本中使用了一个 `MutationObserver`（`headObserver`）来监听 `<title>` 标签被移除的情况并重新挂载监听。然而，由于其逻辑判断使用了 `!document.querySelector('title')`，当单页应用（SPA）在同一次 DOM 更新中**整体替换**了 `<title>` 标签时，该查询会立即找到新的标签，导致判断为假。这使得监听器永远无法重新挂载，而是依然盯着已经被移除出 DOM 树的旧 `<title>` 标签，从而错失页面后续的所有标题变化。
2. **SPA 框架的激进覆盖**：复杂的 SPA 页面会根据其内部路由或组件状态持续同步并重置 `document.title`。如果插件仅仅设置了一次标题，SPA 的状态管理器会迅速将其覆盖。在缺乏有效监听器（见问题 1）或专门的锁定机制的情况下，插件设置的标题会被彻底抹除。

## 计划修改内容

### `tab-retitler/js/content.js`

增强标题监听的健壮性，并引入高频锁定机制。

- **修复 `headObserver` 监听逻辑**：修改 `childList` 的 mutation 判断逻辑，明确遍历 `mutation.addedNodes` 和 `mutation.removedNodes` 中是否存在 `nodeName.toLowerCase() === 'title'` 的节点。只要检测到 `<title>` 元素的添加或移除，立即触发监听器的重新初始化。
- **引入高频标题锁定 (Title Lock)**：新增一个 `titleLockInterval` 变量。更新 `setTitle` 方法，在调用时清除已有的锁，并启动一个高频定时器（例如 100ms 间隔）的 `setInterval` 循环，一旦检测到标题被页面 JS 覆盖，强制将其重置为插件锁定的自定义标题。
- **添加解除锁定逻辑**：新增一个 `clearTitleLock` 消息监听器。当匹配规则失效（如 SPA 页面跳转到了未匹配 URL）时，可以及时停止定时器循环，将标题控制权还给页面。

### `tab-retitler/js/background.js`

调整下发更新标题的逻辑，使其能利用 `content.js` 的新锁定能力。

- **改造 `updateViaScriptInjection` 方法**：目前该方法直接使用 `chrome.scripting.executeScript` 强行赋值。计划将其改为优先尝试发送 `chrome.tabs.sendMessage(tabId, { action: 'setTitle', title: newTitle })` 消息，由 `content.js` 负责拦截并启动高频锁定。
- **完善降级兼容策略**：如果 `sendMessage` 发送失败（例如该页面受限或 `content.js` 未运行），则安全地降级回原始的 `chrome.scripting.executeScript` 注入模式。
- **触发解除锁定机制**：在 `checkAndUpdateTitle` 逻辑中，如果检测到之前的规则曾生效但当前不再匹配（因 SPA 路由切换），则主动发送 `clearTitleLock` 消息，以停止高频锁定。

## 验证与测试方案

1. **手动验证**：应用修改后，在本地重新加载解压的扩展程序，并打开 `dongmonitor.jd.com` 页面。
2. 通过插件弹出窗口将页面标题设置为 "Test Lock"（测试锁定）。
3. 验证标签页标题能够顺利更新，并且**保持不变**，无论页面内部脚本如何活动或路由如何切换。
4. 在普通网站上进行回归测试，确保引入的定时器锁不会影响无配置规则页面的正常行为，并在关闭规则后能正常解除锁定。
