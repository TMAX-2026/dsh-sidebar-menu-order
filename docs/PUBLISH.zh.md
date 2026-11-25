# 发布到插件市场（DSH 0.2.2-rc.5）

先说明这一版的现实：**DSH 目前没有官方插件索引**（`@deepseek-ai/dsh-experimental-plugin-market-bundle` 的已知限制原文：「目前没有官方插件索引；发现标签页只列出用户添加的索引源」）。所谓"插件市场"是：

```
npm 包（或固定 commit 的 Git 包）  +  一份索引 JSON（你自己托管）  →  用户在「发现」里添加这个索引 URL
```

所以发布 = **发布包** + **发布索引**。没有需要向 DeepSeek 提交的官方表单；想让别人装到，把索引 URL 公开即可，或把条目加进别人维护的社区索引。

---

## 0. 已经准备好的部分（2026-11-24 验证）

- 包名 **`dsh-sidebar-menu-order`**（当时 npm registry 查过是 404，未占用；发布前请再确认一次），`private` 已删除。
- `package.json`：`license: MIT`、`keywords`、`engines.dsh: ">=0.2.2-rc.5 <0.3.0"`、`peerDependencies.@deepseek-ai/schemastery`（optional）。
- `index.js`：先普通 `import '@deepseek-ai/schemastery'`，失败再回退 `createRequire(DSH_INSTALL_DIR)`，两种安装方式都能用。
- **客户端 bundle 的注册 id 必须等于包名**：`client.js` 里 `window.__ModuleLoader__.load({ id })` 必须写 `dsh-sidebar-menu-order`。改名后忘了改这里，结果是"安装成功、Host 也 active，但界面里什么都不出现"（1.0.0 就是这么坏的，已在 1.0.1 修复）。
- **`cordis.patch.yml` 的 bundle 行必须写发布后的包名**：`name: dsh-sidebar-menu-order`。改名后忘了改这里，安装能"成功"但 Host 行解析不到（本机曾因残留的旧 junction 而看似正常，别踩）。
- `LICENSE` 已加（MIT；版权行可自行替换）。
- `npm pack` 产物只有 9 个文件：`package.json`、`LICENSE`、`README.md`、`index.js`、`client.js`、`cordis.patch.yml`、`icon.svg`、`locale/en.json`、`locale/zh.json`（`docs/`、`scripts/`、`market/` 不进包）。
- **用真实 tarball 在 desktop profile 里装过**：pnpm 以普通依赖安装（非 link），`application: applied`、`warnings: []`；这正是从 registry 安装走的同一条路径。
- 索引生成器已用 DSH 自带 `parseMarketIndex` 校验通过，`market/index.json` 已按新包名生成（`publishTimestamp` 是占位值，发布后替换）。

剩下需要你做的：补 `author`/`repository`/`homepage` → `npm publish` → 把真实发布时间写进索引 → 托管索引 → 把 URL 发给用户。

---

## 1. 把包做成可发布的

> 第 0 节已完成大部分；以下规则用于以后换名或发新版本时对照。

1. **包名**：小写、允许 scope；scoped 名需要 `npm publish --access public`。
2. `package.json` 至少要有：
   - `version`（SemVer）、`description`、`license`、`author`、`repository`、`homepage`、`keywords`
   - `engines.dsh`：**它一旦存在就单独决定兼容性**（`peerDependencies` 里的 dsh 包不再参与判断）。不写则逐个检查 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 peer 范围。
   - 不能有 `"private": true`
   - 保留 `dsh.bundle.patch` 与 `dsh.client`（市场只接受组合包 bundle）
   - `files` 白名单要包含 Host/客户端/补丁/locale/README/icon
3. **Host 依赖**：已按"普通 import 优先 + 安装目录回退"实现；peer 声明为 optional，profile 的 `autoInstallPeers: false` 不会装它，运行时由 DSH 供给。
4. **自测打包内容**：`npm pack --dry-run` 看清单；`npm pack` 后用 tarball 装进 profile 验证（改动后再做一遍）。
5. 发布：`npm publish`。记下 **publishTimestamp（Unix 秒）**，索引要用。

> 版本发布后不可覆盖；修 bug 请发新版本并在索引里追加一个 `versions` 条目。

## 2. 准备索引 JSON（format 1）

索引是单个 JSON 文件，格式由 `@deepseek-ai/dsh-plugin-market-index` 校验。仓库里的 `scripts/make-index.mjs` 会按 `package.json` 生成并**用 DSH 自带的校验器验证**：

```powershell
# 发布后用 --from-npm 自动从 registry 读取该版本的发布时间：
node scripts/make-index.mjs --from-npm `
  --index-url https://raw.githubusercontent.com/TMAX-2026/dsh-sidebar-menu-order/main/market/index.json

# 也可以用 Unix 秒或 ISO 时间：
node scripts/make-index.mjs --published-at 2026-11-24T10:00:00Z `
  --index-url https://raw.githubusercontent.com/TMAX-2026/dsh-sidebar-menu-order/main/market/index.json
# → validated: 1 plugin(s), 1 version(s)
```

> 仓库里提交的 `market/index.json` 里 `publishTimestamp` 是**占位值**；npm 发布后必须用 `--from-npm` 重生成一次再提交。

生成的形状：

```json
{
  "format": 1,
  "title": { "en": "Plugins", "zh": "插件" },
  "metadata": {},
  "plugins": [{
    "name": "dsh-sidebar-menu-order",
    "title": { "en": "Sidebar menu order", "zh": "侧栏菜单顺序" },
    "description": { "en": "…", "zh": "…" },
    "icon": "data:image/svg+xml;base64,…",
    "metadata": { "keywords": ["dsh", "sidebar", "menu"] },
    "versions": [{
      "version": "1.0.0",
      "publishTimestamp": 1763900000,
      "source": { "type": "npm" },
      "engines": { "dsh": ">=0.2.2-rc.5 <0.3.0" }
    }]
  }]
}
```

格式硬性要求（校验器规则，抄自 `dsh-plugin-market-index/src/index.ts`）：

| 字段 | 规则 |
|---|---|
| `format` | 必须是 `1` |
| `title` / `description` | 字符串，或**必须含 `en`** 的语言映射 |
| `plugins[].name` | 合法 npm 包名，≤214 字符，不重复 |
| `versions` | 非空数组；`version` 精确 SemVer；`publishTimestamp` 为 `[0, 1e11)` 的整数秒；版本不重复 |
| `source` | `{type:'npm', registry?}` 或 `{type:'git', url, commit(40 位小写 hex), path?}` |
| `icon` | https 绝对 URL、与索引同源的相对路径，或 `data:image/{svg+xml,png,jpeg,webp};base64,…`（解码后 ≤32 KiB） |
| `homepage` | 绝对 http(s) URL（可带 fragment） |
| `repository.url` | http(s) URL，可带 `directory`（相对包目录） |
| `engines.dsh` | 合法 SemVer range，不能是 `workspace:` |

## 3. 托管索引

- 必须是 `http:`/`https:` 的**规范 URL**：不能带凭据、查询串或片段，**重定向会被拒绝**。推荐 `https://raw.githubusercontent.com/TMAX-2026/dsh-sidebar-menu-order/main/market/index.json` 或 GitHub Pages。
- 索引**没有签名**：它只是声明，实际安装什么由包的 manifest 决定。用户信任索引源 = 信任你。
- 图标用 `http:` 在 HTTPS 页面会被拦截；`data:` 内联最省事（脚本默认这样做）。

## 4. 让用户看到

1. 侧栏 **插件** → **实验性插件** → 启用 **自定义插件索引**（默认关闭，启用后出现「发现」标签页）。
2. **发现** → **添加索引源** → 粘贴索引 URL。
3. 搜索/打开条目 → **安装**（走正常安装确认与兼容性检查）。

本地自测索引：起一个本地 HTTP 服务，把 `http://127.0.0.1:8000/market/index.json` 加为索引源（无重定向、无 query 即可）。

## 5. 更新版本

1. 改代码 → 升 `version` → `npm publish`。
2. 在索引 `versions` 里**追加**新条目（脚本会保留旧版本）；更新 `publishTimestamp`。
3. 重新托管 JSON；「发现」缓存 `cacheTtlMs` 默认 10 分钟，可点刷新。
4. 「发现」的**更新**只对 Git 来源的副本可用；npm 安装的副本要到「已安装」页的版本区块更新。

## 6. 发布前检查清单

- [ ] 包名公开、`private` 已删、版本号已升
- [ ] `cordis.patch.yml` 的 `name` 与发布包名一致
- [ ] `engines.dsh` 写对（`npm view <name>@<version> engines` 复核）
- [ ] `npm pack` 清单正确
- [ ] 从 tarball 装进干净 profile 能激活（`application: applied`、无 warning）
- [ ] 索引 JSON 通过 `parseMarketIndex`
- [ ] 索引 URL 无重定向、无查询串
- [ ] icon 可访问（https 或 data:）
- [ ] npm 页 README 可读、`locale/*/meta.title|description` 齐全
