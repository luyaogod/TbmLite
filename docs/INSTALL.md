# 安装与分发（INSTALL）

## 1. 系统要求

| 项 | 要求 |
|---|---|
| 操作系统 | Windows 10 1809（build 17763）及以上 / Windows 11（x64） |
| 磁盘 | 程序约 250MB；数据按附件量增长（首次建议预留 1GB 以上） |
| 权限 | **无需管理员权限**（每用户安装，默认装到 `%LOCALAPPDATA%\Programs\TBM Lite`） |
| 网络 | 仅 AI 功能需要（OpenAI 兼容接口）；离线可用除 AI 解析/搜索以外的全部功能 |

## 2. 安装

1. 运行 `TBM Lite-Windows-<版本>-Setup.exe`。
2. 安装器会做前置检查：
   - 系统版本低于 Windows 10 → 直接中止；
   - 内部版本号低于 17763 → 可跳过的警告；
   - 检测到旧版本仍在运行 → 提示先退出（可强行继续，但可能出现文件占用错误）。
3. 默认创建桌面快捷方式与开始菜单项；安装目录可自定义。
4. 首次启动进入**初始化向导**（4 步）：
   1. 数据位置（显示实际目录，可一键打开）
   2. 导入旧 TBM 数据（自动探测 + 手动选择目录 + 导入预览；可跳过）
   3. AI 配置（API 地址 / 模型 / Key，可稍后设置）
   4. 数据安全说明（本机存储、备份策略、AI 数据外发提示）

### 静默安装（批量部署）

```powershell
# 默认目录静默安装
"TBM Lite-Windows-0.2.0-Setup.exe" /S

# 指定目录
"TBM Lite-Windows-0.2.0-Setup.exe" /S /D=C:\Tools\TbmLite
```

> `/D=` 必须是最后一个参数且路径不加引号（NSIS 约定）。
> 若希望所有业务数据落到固定位置（例如共享盘或指定盘符），在部署时设置系统/用户环境变量
> `TBM_DATA_DIR=<绝对路径>`，或在 exe 同级放置名为 `portable` 的空文件改用便携布局。

### 首启向导的跳过

向导完成状态记录在数据目录 `.meta.json` 的 `firstRunCompleted`。
如需批量跳过（例如配置由环境变量或统一配置文件下发），可在部署脚本中预置数据目录内容，
使 `.meta.json` 中 `firstRunCompleted: true`，并预置 `config/aj-api.json`
（API Key 需为 `safeStorage` 密文，或留空由用户首次进入设置页填写）。

## 3. 升级

- 覆盖安装即可：安装器只更新程序文件，**不会**触碰数据目录。
- 升级提示「是否删除用户数据」只在**卸载**时出现；升级流程不会询问、不会删除数据。
- 程序启动时自动完成数据结构迁移（迁移前强制备份 `pre-migrate-*`）。
- 若新版本的数据结构不可逆（`minReaderVersion` 提升），升级后无法用旧版本打开该数据目录；
  发版说明中会标注。回退方式：卸载新版 → 安装旧版 → 如旧版拒绝打开，则从
  `backups/auto/pre-migrate-*` 恢复。

## 4. 卸载

- 卸载默认**保留**用户数据；卸载向导会询问是否同时删除 `%APPDATA%\TBM Lite`，默认「否」。
- 彻底清除：卸载后手动删除 `%APPDATA%\TBM Lite`（或 `TBM_DATA_DIR` 指向的目录）。
- 数据位置与内容说明见 [`DATA.md`](./DATA.md)。

## 5. 打包（开发侧）

```powershell
npm install
npm run build        # tsc + vite build → dist / dist-electron
npm run dist         # electron-builder → release/<版本>/TBM Lite-Windows-<版本>-Setup.exe
```

打包配置要点（`electron-builder.json5`）：

| 配置 | 原因 |
|---|---|
| `asarUnpack: ["**/node_modules/@libsql/**", "**/*.node"]` | `@libsql` 带原生模块，留在 asar 内会导致打包后加载失败 |
| `nsis.perMachine: false` | 每用户安装免管理员权限，是自动更新（静默安装）可用的前提 |
| `nsis.include: build/installer.nsh` | 前置检查与卸载询问 |
| `nsis.differentialPackage: true` | 生成增量更新包（配合自动更新） |
| `publish: github` | 发布渠道（`luyaogod/TbmLite`，仓库为 public，无需内置 Token） |
| `extraResources: templates/` | 钉钉需求评估导入模板底稿（导出时以它为底，保留隐藏选项表与数据校验） |
| 图标写入 | exe / 安装包图标需 rcedit。若网络无法下载 winCodeSign（electron-builder 会从 GitHub 拉取），用离线方式：
① 先跑 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/patch-electron-exe.ps1`（自动从 electron-builder 缓存找 rcedit，给 Electron 的 exe 写入图标与版本信息）
② 再跑 `npm run dist:offline`（等价于 `electron-builder -c.electronDist=node_modules/electron/dist -c.win.signAndEditExecutable=false`）
注意：跳过 electron-builder 自带的 rcedit 后，必须由上面的补丁脚本负责写图标，否则 exe 会保留 Electron 默认图标 |
| `package.json` 必须含 `productName` | Electron 用 `app.getName()`（= `productName`，回退到 `name`）决定 `userData`。缺失时数据目录会变成 `%APPDATA%\tbm-lite`，与文档/卸载脚本不一致 |
| `win.verifyUpdateCodeSignature` | 未签名阶段必须为 `false`，签名后应改回 `true` |

### 打包后验收清单

1. 在**干净机器**（或新 Windows 用户）上安装并启动；
2. 首启向导 4 步可走通；跳过 AI 配置也能进入主界面；
3. 创建项目 → 上传 .docx（AI 解析）→ 打开/另存附件；
4. AI 搜索可流式返回；
5. `设置 → 数据与备份`：立即备份成功、备份列表可见、完整性检查通过；
6. 关闭程序后重启：数据仍在（确认未写入安装目录）；
7. 卸载后 `%APPDATA%\TBM Lite` 仍在；选「是」删除后目录消失。

## 6. 代码签名（当前状态：未签名）

现状与影响：

- 安装包未签名 → 首次运行会出现 SmartScreen「未知发布者」提示，需用户手动「仍要运行」。
- `electron-builder.json5` 中 `verifyUpdateCodeSignature: false`，因此**不应**在该状态下开启静默自动更新
  （无法校验更新包来源）。

接入签名后需要做的调整：

1. 准备 OV/EV 代码签名证书（云签名或 USB token），在 CI 中以 Secret 形式提供；
2. 将 `win.verifyUpdateCodeSignature` 改为 `true`；
3. 重新打包并验证：安装无 SmartScreen 警告、`latest.yml` 与 `.blockmap` 均带签名；
4. 记录证书到期时间，到期前轮换，否则新版本将无法通过校验。

## 7. 企业内网分发注意

- 内网无外网时：AI 功能需指向内网网关（设置页填写 Base URL）；程序本身可离线安装运行。
- 若用共享目录托管数据：请确保同一时间只有一个实例写入（程序有单实例锁，但跨机器不生效），
  多机共享 SQLite 存在写冲突风险，建议数据留在本机、通过备份文件交换。
- 批量部署建议统一 `TBM_DATA_DIR`（例如 `D:\TbmLiteData`），便于统一备份与清理。
