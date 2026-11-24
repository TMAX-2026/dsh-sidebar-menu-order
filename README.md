# 侧栏菜单顺序 · Sidebar menu order

A DSH web-GUI plugin that reorders the left navigation menu by dragging, and keeps the order in the active profile.

用拖拽调整 Web GUI 左侧菜单（插件、自动化任务、聊天、上下文洞察等全局面板）的先后顺序，并按当前 profile 持久化。

## 安装 · Install

发布到 npm 后：

```sh
dsh plugin --profile <profile> add dsh-sidebar-menu-order
```

或在 **插件** → **添加插件** 中填入 `dsh-sidebar-menu-order`。

从插件市场安装：先在 **插件 → 实验性插件** 启用 **自定义插件索引**，再到 **发现 → 添加索引源** 粘贴索引 URL。

要求 DSH `>=0.2.2-rc.5 <0.3.0`（`package.json` 的 `engines.dsh`）。

## 使用

1. 打开左侧面板列表末尾的 **更多**（在会话列表上方、最下面一个面板入口之后）。
2. 选择 **菜单排序…**。
3. 在对话框中拖动行，或用行上的 ↑ / ↓ 按钮调整顺序；点 **完成** 关闭。
4. 顺序立即作用到左侧菜单（以及「更多」菜单里的入口顺序），无需重启。

对话框底部会显示保存位置：顺序写入当前 profile 的设置文档；如果当前连接受限或设置服务不可用，会标注"仅保存在当前浏览器"。保存失败时对话框保持打开并显示原因，不会静默丢掉结果。

**恢复默认顺序** 把顺序交还给各插件注册时的原始顺序。

## 顺序保存在哪里

顺序写在本插件 Host 条目（`sidebar-menu-order`）的 Config 字段 `order` 上，通过 profile 的设置文档（`cordis.patch.yml` 的用户层）持久化，因此重启应用、换浏览器都保持一致。无法访问设置服务时，退化为只在当前浏览器（localStorage）保存，并在对话框中标注。

## 实现方式

左侧菜单的每一行是一个 `sidebar.panellist` 列表注册项，侧栏按注册项上的 `order` 排序。本插件在 priority `-1` 上用相同 id 影子的方式重新注册这些面板：复制原注册项的组件、`label`、`locale` 与 `inject`，只替换 `order`。原始注册不被修改——禁用或卸载本插件后立即回到默认顺序。

## 已知限制

- 只在 Web 客户端生效；凭据、模型、工具等 Host 行为不变。
- 「插件」入口在侧栏里的顺序同样可调，但它仍然是不可取消固定的入口。
- 面板被其它插件动态注册/移除时（例如 dsh-context 隐藏入口），本插件会在下一个事件里同步影子注册。
- 拖拽使用浏览器原生 HTML5 拖放，需要鼠标；触屏或键盘用户使用 ↑ / ↓ 按钮。
- 顺序按 profile 保存；不同 profile 各自独立。
