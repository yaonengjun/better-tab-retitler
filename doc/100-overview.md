# Tab ReTitler 浏览器插件概览

## 项目简介

Tab ReTitler 是一个 Chrome 浏览器扩展（Manifest V3），用于修改网页标签页的标题。用户可以通过弹出窗口快速修改当前页面的标题，并选择标题的持久化策略（临时、单标签、精确 URL 或整站域名）。该扩展还提供正则表达式模板、自定义 URL 匹配规则、设置导入导出和多语言支持等功能。

---

## 目录结构

```
tab-retitler/
├── manifest.json          # 扩展清单文件（Manifest V3）
├── popup.html             # 弹出窗口页面
├── options.html          # 选项设置页面
├── _locales/             # 多语言资源目录
│   ├── en/
│   ├── zh_CN/
│   ├── ja/
│   ├── de/
│   ├── es/
│   ├── fr/
│   ├── pt/
│   ├── ru/
│   └── tr/
├── css/
│   ├── popup.css         # 弹出窗口样式
│   └── options.css       # 选项页面样式
├── js/
│   ├── background.js     # 后台服务脚本（核心逻辑）
│   ├── content.js        # 内容脚本（运行在网页中）
│   ├── popup.js          # 弹出窗口逻辑
│   └── options.js        # 选项页面逻辑
└── images/               # 扩展图标
```

---

## 核心模块说明

### 1. manifest.json
扩展的清单文件，定义了：
- **Manifest Version**: 3（现代 Chrome 扩展标准）
- **Permissions**: `tabs`, `scripting`, `storage`, `contextMenus`, `bookmarks`
- **Host Permissions**: `<all_urls>`（可访问所有网页）
- **Action**: 点击扩展图标时打开 `popup.html`
- **Options UI**: 设置页面为 `options.html`，在新标签页打开
- **Background**: 使用 Service Worker（`js/background.js`）
- **Content Scripts**: 在所有 HTTP/HTTPS 页面注入 `js/content.js`
- **Commands**: 快捷键 `Alt+Shift+T` 触发设置标题操作

### 2. background.js（后台服务脚本，核心逻辑）
作为 Service Worker 运行，是整个扩展的核心引擎，负责：

- **标题更新逻辑** (`updateTabTitle`)
  - 支持正则表达式替换标题
  - 支持模板变量：`{original}`、`{domain}`、`{url}`、`{date}`、`{time}`
  - 支持 `$0` 引用原标题

- **规则匹配优先级** (`checkAndUpdateTitle`)
  1. **Tab Lock**（`Tab#${tabId}`）：当前标签页锁定，最高优先级
  2. **Exact URL**：精确 URL 匹配
  3. **Domain**（`*${domain}*`）：域名级别匹配
  4. **URL Pattern**（`*pattern*`）：自定义通配符模式匹配

- **现代能力检测系统** (`testTabCapabilities`)
  - 动态检测页面是否允许脚本注入
  - 对 `chrome://`、`chrome-extension://`、`about:` 等内部页面自动降级为受限模式

- **多层次标题更新** (`updateTabTitleWithFallback`)
  - FULL_ACCESS：使用 `chrome.scripting.executeScript` 直接修改 `document.title`
  - RESTRICTED：对于浏览器内部页面和安全受限页面，优雅降级

- **存储管理**
  - 使用 `chrome.storage.sync` 存储标题规则（支持跨设备同步）
  - 存储配额接近限制时自动清理旧条目（保留 95KB 缓冲）
  - 标签页关闭时自动清理对应的 Tab Lock 记录

- **消息通信**
  - 监听 `chrome.runtime.onMessage`，处理来自 popup 和 content script 的请求
  - 支持批量设置标题（`bulkSetTitle`）
  - 支持多语言切换（`changeLanguage`、`getLanguage`）

- **生命周期管理**
  - `onStartup`：清理残留的 Tab Lock
  - `onInstalled`：创建右键菜单（"临时设置标题"）
  - `tabs.onUpdated`：检测页面标题变化，自动应用保存的规则
  - `tabs.onRemoved`：清理标签页相关的缓存和存储

### 3. content.js（内容脚本）
运行在每个网页的上下文中，负责：

- **标题变化监听**
  - 使用 `MutationObserver` 监听 `<title>` 元素的变化
  - 监听 `<head>` 的子元素变化（应对动态添加/删除 title 标签）
  - 页面可见性变化时自动重启/停止观察者

- **与后台通信**
  - 检测到标题变化时，通过 `safeSendMessage` 通知 background.js
  - 监听来自 background.js 的消息（`getTitle`、`setTitle`）

- **安全清理**
  - 使用 `AbortController` 管理事件监听器，确保 CSP 限制下也能安全清理
  - `pagehide` 和 `visibilitychange` 事件触发资源释放

### 4. popup.js（弹出窗口逻辑）
用户点击扩展图标时显示的轻量级界面，负责：

- **界面初始化**
  - 自动填充当前页面的标题
  - 显示书签标题（如果该 URL 有书签）
  - 从存储中加载用户上次使用的持久化选项

- **标题设置流程**
  - 用户输入新标题，选择持久化策略，点击"设置标题"
  - 显示加载中、成功、受限、错误等状态反馈
  - 优雅处理受限站点（显示友好提示）

- **多语言支持**
  - 使用自定义翻译系统，支持参数替换
  - 监听语言刷新消息，实时更新 UI 文本

### 5. options.js（选项页面逻辑）
功能完整的设置管理界面，包含三个主要标签页：

**Saved Titles（已保存的标题）**
- 列出所有持久化的标题规则
- 支持按类型排序（域名 > 精确 URL > 标签页锁定）
- 可编辑和删除规则

**Default Options（默认选项）**
- 设置弹出窗口中持久化策略的默认选中项
- 可选：`onetime`（仅本次）、`tablock`（当前标签页）、`exact`（精确 URL）、`domain`（整站域名）

**Advanced Options（高级选项）**
- **Regex Replacement**：使用正则表达式批量替换标题部分内容，预设多个常用模板（如移除后缀、添加前缀等）
- **URL Pattern Matching**：自定义 URL 通配符匹配规则，如 `*example.com*`
- **Keyboard Shortcut**：跳转到 Chrome 扩展快捷键设置页面
- **Import/Export Settings**：将所有设置导出为 JSON 文件或从文件导入

**Footer**
- 语言选择器：支持 9 种语言（EN、TR、DE、ES、FR、JA、PT、RU、ZH_CN）

---

## 数据存储结构

所有数据存储在 `chrome.storage.sync` 中，键值对结构如下：

| 键格式 | 用途 | 示例 |
|--------|------|------|
| `Tab#${tabId}` | 当前标签页锁定 | `{"title": "我的自定义标题"}` |
| `https://example.com/page` | 精确 URL 匹配 | `{"title": "Example Page"}` |
| `*example.com*` | 域名级别匹配 | `{"title": "Example - ${1}"}` |
| `*keyword*` | URL 通配符匹配 | `{"title": "New Title"}` |
| `options` | 用户偏好设置 | `{"defaultOption": "domain", "language": "zh_CN"}` |

---

## 权限说明

| 权限 | 用途 |
|------|------|
| `tabs` | 读取标签页信息（URL、标题等） |
| `scripting` | 向页面注入脚本修改标题 |
| `storage` | 使用 chrome.storage 持久化数据 |
| `contextMenus` | 创建浏览器右键菜单 |
| `bookmarks` | 读取书签信息用于显示 |
| `<all_urls>` | host_permissions，允许在所有页面运行 |

---

## 快捷键

- **Alt+Shift+T**：打开弹出窗口快速设置标题
- 可在 Chrome 扩展管理页面（`chrome://extensions/shortcuts`）自定义

---

## 技术特点

1. **Manifest V3 规范**：使用 Service Worker 替代传统后台页面，符合现代 Chrome 扩展标准
2. **能力检测机制**：动态检测脚本注入能力，对受限页面优雅降级
3. **防循环机制**：记录自身修改的标题，避免 extension 与页面互相触发更新
4. **存储配额管理**：Chrome sync storage 限制约 100KB，扩展实现了自动清理策略
5. **多语言架构**：支持 9 种语言，自定义翻译系统支持参数替换
6. **无障碍支持**：ARIA 属性、屏幕阅读器支持、键盘导航、高对比度模式、深色模式
7. **CSP 安全**：使用 AbortController 管理事件监听，内容安全策略合规

---

## 功能说明

Tab ReTitler 插件的核心功能是帮助用户自由修改浏览器标签页的标题，并提供灵活的持久化策略让这些修改在特定条件下自动生效。以下是各项功能的详细说明：

### 一、快速修改标题

用户点击扩展图标打开弹出窗口，插件会自动填充当前页面的原始标题。用户可以：
- 直接编辑标题文本
- 点击显示的"原始标题"提示文字一键还原
- 如果该 URL 已添加到书签，插件还会显示书签标题供快速调用

修改完成后点击"Set Title"即可立即生效。支持的快捷键为 `Alt+Shift+T`。

### 二、持久化策略

插件提供四种标题持久化策略，用户在设置标题时可以选择：

| 策略 | 说明 |
|------|------|
| **Only this time（仅本次）** | 仅临时修改本次标题，刷新页面或更改 URL 后标题恢复为网站原标题 |
| **Set for this tab（当前标签页）** | 锁定当前标签页的标题，URL 变化不影响标题，关闭标签页后失效 |
| **Only exact match（精确 URL）** | 仅在访问完全相同的 URL 时应用标题，跨会话持久有效 |
| **Set for this domain（整站域名）** | 对该域名下的所有页面统一应用标题，跨会话持久有效 |

### 三、自动规则匹配

当页面标题发生变化时（如单页应用路由切换、动态加载内容），插件会自动检查是否存在匹配的保存规则，并自动应用。该机制按以下优先级执行：

1. **Tab Lock**：检查当前标签页是否有锁定的自定义标题
2. **精确 URL**：检查当前 URL 是否有保存的标题规则
3. **域名匹配**：检查当前域名是否有保存的标题规则
4. **URL 模式**：检查是否有匹配的自定义 URL 通配符规则

### 四、正则表达式标题替换

在高级选项中，用户可以使用正则表达式批量修改标题。语法格式为：`/pattern/replacement/flags`。

例如：
- `/(.*)\s*[-–—]\s*[^-–—]+$/$1/g` — 移除标题末尾的网站后缀
- `/^(.*)$/🔖 $1/` — 为标题添加书签前缀
- `/\s*[\(\[].*?[\)\]]\s*//g` — 移除标题中的括号内容

插件还预设了多个常用正则模板，用户可一键复制使用。

### 五、自定义 URL 模式匹配

在高级选项中，用户可以添加自定义的 URL 通配符规则。规则格式为：以 `*` 开头和结尾，如 `*example.com/product/*`。

匹配时，插件会使用通配符提取 URL 中的内容，并通过 `$1`、`$2` 等占位符将提取的内容注入到标题模板中。例如：
- URL Pattern: `*github.com/*/issues/*`
- Title: `Issue: $1`

### 六、标题模板变量

在设置标题时，插件支持以下模板变量，会在应用时自动替换为实际值：

| 变量 | 说明 | 示例输出 |
|------|------|----------|
| `{original}` | 原始网页标题 | `My Page Title` |
| `{domain}` | 当前页面域名 | `example.com` |
| `{url}` | 当前页面完整 URL | `https://example.com/path` |
| `{date}` | 当前日期（本地格式） | `2026/5/15` |
| `{time}` | 当前时间（本地格式） | `14:30:00` |
| `$0` | 原始网页标题（快捷方式） | `My Page Title` |

### 七、书签标题提示

插件会检测当前 URL 是否已添加到浏览器书签。如果存在书签，弹出窗口中会显示书签标题，用户可以一键将标题恢复为书签名称。

### 八、右键菜单

安装插件后，在任意网页上右键点击，会出现"临时设置标题"选项。点击后会弹出浏览器原生的 prompt 对话框，允许用户快速输入临时标题（等同于"仅本次"策略）。

### 九、设置导入导出

在高级选项中，用户可以：
- **导出**：将所有保存的标题规则和偏好设置导出为 JSON 文件，便于备份或迁移
- **导入**：从之前导出的 JSON 文件恢复所有设置

### 十、多语言支持

插件内置了 9 种语言：英语、土耳其语、德语、西班牙语、法语、日语、葡萄牙语、俄语和简体中文。语言设置会随 Google 账号同步到其他设备。
