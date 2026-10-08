# TBM Lite

需求书管理系统 —— 原 [TBM](../TBM) 项目的 shadcn/ui 重写精简版。

保留四项核心能力：

| 能力 | 说明 |
|---|---|
| 创建项目 | 项目编号 / 名称 CRUD，删除前检查需求书引用 |
| 上传需求书 | 上传 .docx 需求确认书，AI 自动解析需求书编号与需求明细；明细支持手动维护、状态流转、开发人员填写（姓名直填）；附件可打开 / 另存 / 替换 |
| 开发人员填写 | 需求明细中的「开发人员」为自由文本，直接填写姓名 |
| AI 搜索 | 基于全量项目 / 需求书 / 需求明细数据的自然语言问答，流式输出，多轮会话，项目过滤，回答中需求书可点击跳转 |

## 品牌与窗口外观

- Logo：蓝→靛蓝渐变圆角矩形 + 白色 **TBM**（`public/logo.svg`、`public/logo.png`、`build/icon.png`）
- 重新生成：`powershell -File scripts/make-logo.ps1 -OutDir <输出目录>`（输出 16~512 多尺寸 PNG；
  `build/icon.png` 用于安装包 / exe 图标，electron-builder 自动转换为 ico）
- Logo 仅用于应用图标（exe / 安装包 / 任务栏 / Alt-Tab），界面内不再重复显示品牌文字
- Windows 使用无边框窗口（`titleBarStyle: hidden` + `titleBarOverlay`）：顶部不再有系统标题栏的图标与文字，
  只保留最小化 / 最大化 / 关闭按钮；顶部 32px 为可拖拽标题带（双击最大化），底色随主题变化
- 侧边栏顶部不再有品牌区块，直接从导航项开始
- 列表页不再有页面标题栏：标题与侧边栏导航重复，操作按钮（新增项目 / 新增需求书）已并入筛选工具条右侧；
  AI 搜索的「清空上下文」并入输入区
- 设置页为「目录式分类 + 右侧内容」两栏：AI 配置 / 外观 / 数据与备份 / 关于（不再是一条长列卡片）；
  各分类内容在右侧面板内部滚动，页面本身不滚动

## 技术栈

| 类别 | 库 |
|---|---|
| 桌面框架 | Electron 30 |
| UI | shadcn/ui（new-york + Radix）+ Tailwind CSS v4 + lucide-react |
| 构建 | Vite 5 + vite-plugin-electron |
| 数据库 | SQLite（@libsql/client + drizzle-orm），迁移框架 + WAL + 外键，启动时按 `user_version` 演进 |
| 数据安全 | 滚动自动备份（`VACUUM INTO`）+ 一键备份/恢复、API Key 经 safeStorage(DPAPI) 加密、日志脱敏 |
| AI | openai SDK（OpenAI 兼容接口）+ @jose.espana/docstream（.docx → Markdown） |
| Markdown | react-markdown + remark-gfm |

## 目录结构

```
TbmLite/
├── electron/                        # Electron 主进程
│   ├── main.ts                      # 单实例锁 + 启动编排（门禁 → PRAGMA → 迁移 → 备份 → 清理）+ 自检模式
│   ├── preload.ts                   # contextBridge：window.api
│   ├── ipc.ts                       # 全部 ipcMain.handle 集中注册（写操作带维护态校验）
│   ├── db/
│   │   ├── index.ts                 # 懒加载 libsql 连接 + PRAGMA 基线（WAL/busy_timeout/foreign_keys）
│   │   ├── schema.ts                # 4 张表定义
│   │   └── migrations/              # 迁移框架：index.ts(runner) + 001~004
│   ├── core/
│   │   ├── meta.ts                  # .meta.json（installId / schemaVersion / minReaderVersion / cleanExit）
│   │   ├── data-guard.ts            # 版本门禁与损坏探测
│   │   ├── backup-service(services/) # VACUUM INTO 备份 + 保留策略 + 两阶段恢复
│   │   ├── integrity.ts             # 完整性校验 + 悬挂引用/孤立文件巡检 + GC
│   │   ├── housekeeping.ts          # tmp / 会话 / 回收站清理
│   │   ├── maintenance.ts           # 备份·恢复·迁移·重置 独占队列 + 维护态广播
│   │   ├── agent/                   # docx-parser（AI 提取）、search-agent（流式问答）、session-store、config
│   │   └── constants.ts             # 状态码（与原 TBM sscc 一致）
│   ├── services/                    # project / requirement / attachment / agent / backup / data
│   ├── utils/                       # paths（数据目录）、safe-path（越界拦截）、fsx、sqlite-header、logger
│   └── app-data/                    # 仅开发态数据目录 + 安装种子（publish，无真实密钥）
├── src/
│   ├── components/
│   │   ├── ui/                      # shadcn/ui 组件
│   │   ├── layout/                  # AppShell（侧边导航）、PageHeader
│   │   ├── data/                    # 数据与备份面板
│   │   ├── projects/                # 项目对话框
│   │   └── requirements/            # 需求书上传对话框（.docx AI 解析）
│   └── pages/                       # 项目 / 需求书 / 详情 / AI 搜索 / 设置
├── scripts/
│   ├── lib/paths.ts                 # 脚本共用的数据目录解析
│   ├── migrate-from-tbm.ts          # 旧 TBM 数据导入（支持 --from/--to/--dry-run）
│   └── verify-migration.ts          # 数据校验（支持 --dir）
└── docs/数据管理-安装-更新-方案.md   # 数据/安装/更新设计文档
```

## 数据库表

| 表名 | 说明 | 主键 |
|---|---|---|
| pjaa | 项目 | pjaa001 |
| xqaa_t | 需求书主档 | (xqaapj, xqaa001) |
| xqab_t | 需求书明细 | (xqabpj, xqab001, xqabseq)，xqab006 为开发人员姓名（自由文本） |
| ffff_t | 附件 | (ffff001, ffff002, ffff004) —— 内容寻址 + 引用模型，同一文件可被多份需求书引用 |

状态码沿用原 TBM sscc 分类码：需求书 `1 进行中 / 2 已结案`；需求项 `1 需求评估 / 2 需求开发 / 3 顾问确认 / 4 用户确认 / 5 已结案`。

## 使用

```powershell
npm install        # 安装依赖
npm run dev        # 开发（Vite + Electron）
npm run build      # 构建（tsc + vite build → dist / dist-electron）
npm run dist       # 打包安装包（electron-builder）
```

首次使用前，进入「设置」页填写 AI API 配置（OpenAI 兼容接口，默认 DeepSeek）。
API Key 经系统安全存储（Windows DPAPI）加密后写入数据目录 `config/aj-api.json`；
留空保存表示保持原 Key 不变。仓库内只提供 `aj-api.example.json` 模板，**不含任何真实密钥**。

### 数据自检（无界面）

```powershell
npx electron . --tbm-smoke              # 数据层自检：输出 SMOKE_REPORT JSON + 写入 logs/smoke-report.json，退出码 0/1
npx electron . --tbm-smoke --tbm-smoke-restore   # 额外做一次备份→恢复往返（会暂存恢复，下次启动生效）
npx electron . --tbm-smoke --tbm-smoke-legacy    # 额外跑一次旧数据导入（目录取 TBM_LEGACY_DIR 或自动探测）
```

自检会完整跑一遍数据层：门禁 → 迁移（含迁移前备份）→ 每日备份 → 完整性检查 + 一致性巡检。
可用 `TBM_DATA_DIR` 指向数据目录副本，避免影响正式数据：

```powershell
$env:TBM_DATA_DIR="D:\tmp\tbm-data"; npx electron . --tbm-smoke
$env:TBM_LEGACY_DIR="D:\old-tbm-data"; npx electron . --tbm-smoke --tbm-smoke-legacy
```

安装包内的自检同样可用（用于验证 asarUnpack 后的原生模块可加载）：

```powershell
$env:TBM_DATA_DIR="D:\tmp\pkg-data"; & "$env:LOCALAPPDATA\Programs\TBM Lite\TBM Lite.exe" --tbm-smoke
# Windows GUI 进程不接控制台，结果看 <数据目录>\logs\smoke-report.json
```

## 数据、备份与恢复

完整说明见 [`docs/DATA.md`](docs/DATA.md)（安装与分发见 [`docs/INSTALL.md`](docs/INSTALL.md)）。

用户数据位于 `%APPDATA%\TBM Lite`（便携模式：exe 同级 `portable` 标记文件 → `exe 同级/data`；
也可用 `TBM_DATA_DIR` 覆盖）。程序升级只覆盖安装资源，不会触碰该目录。

```
%APPDATA%\TBM Lite\
├── .meta.json      # 安装标识 / 结构版本 / 最低可读版本 / 正常退出标记
├── db\app.db       # SQLite（WAL）
├── files\          # 附件（sha256 内容寻址，删除进 files/.trash）
├── config\         # aj-api.json（Key 已加密）、app 偏好、AI 会话
├── logs\           # app.log（5MB×5 轮转）、audit.log（删除/恢复/重置审计）
├── backups\auto    # 滚动自动备份（每日 1 份 / 30 天 / 上限 20）
└── backups\manual  # 手动备份（不自动清理）
```

- 备份使用 `VACUUM INTO`（SQLite 官方一致性热备），**不要**用文件拷贝代替——WAL 模式下会丢数据。
- 恢复为两阶段：先在设置页确认 → 自动生成 `pre-restore` 副本 → 应用自动重启并在建库连接前完成换库。
- 结构版本（`PRAGMA user_version`）高于程序支持版本，或低于 `.meta.json:minReaderVersion` 时，程序**拒绝写入**并给出「退出 / 从备份恢复 / 打开数据目录」三个选择。
- 设置页「数据与备份」可查看占用、立即备份、恢复、另存为、完整性检查、清理孤立附件、重置数据。

## 数据迁移（从旧 TBM）

```powershell
npx tsx scripts/migrate-from-tbm.ts --from <旧数据目录> --to <新数据目录> [--dry-run]
npx tsx scripts/verify-migration.ts --dir <新数据目录>
```

目录也可用环境变量 `TBM_OLD_DATA` / `TBM_NEW_DATA` 指定；默认值分别为
`../TBM/electron/app-data/dev` 与 `electron/app-data/dev`。

脚本从旧数据目录读取旧库（需先启动一次 TBM Lite 让新库建表），迁移范围：

| 数据 | 是否迁移 |
|---|---|
| pjaa 项目 | ✅ 全量（按主键去重） |
| xqaa_t 需求书主档 | ✅ 全量 |
| xqab_t 需求书明细 | ✅ 全量（开发人原样保留为姓名文本） |
| ffff_t 需求书附件（.docx） | ✅ 记录 + 物理文件一并复制 |
| xqac_t 待办及其附件 | ❌ 新项目已移除待办功能 |
| sscc / zjac / seus / 用户等 | ❌ 未使用 |

执行前会自动用 `VACUUM INTO` 备份新库（`db/app.db.bak-<时间戳>`），迁移过程幂等、可重复执行。

## 与原 TBM 的差异

- UI 由 antd 重写为 shadcn/ui（无圆角直角设计），去掉多标签页 / KeepAlive / 过滤 store 等复杂机制
- 移除：工作台、进度看板、需求明细列表、待办事项报表、需求项详情、文档预览窗口、惯用待办、用户设置等页面
- 开发人员不再单独建目录维护，需求明细中直接填写姓名（原版为「开发人」文本字段，同样直填）
- 附件仅保留需求书级（xqaa_t），文件按 sha256 内容寻址存放于 `files/xqaa_t/`
- AI 搜索上下文从「需求书+明细+待办」精简为「项目+需求书+明细+附件名」
- 新增数据治理能力：迁移框架、版本门禁、滚动备份与一键恢复、完整性巡检/孤立文件回收、重置数据

## 导出钉钉模板

入口：新增需求书弹窗的「需求明细」工具条、需求书详情页的「需求明细」工具条，按钮名「导出钉钉模板」。

以 `templates/需求评估导入模板.xlsx` 为底稿（打包时经 `extraResources` 放入安装包的 `resources/templates`），
只替换数据行，保留表头、列宽、隐藏选项表与下拉数据校验。字段映射：

| 钉钉模板列 | 取值 |
|---|---|
| 序号(*) | 明细顺序 1..N |
| 程序代号(*) | 作业编号 |
| 程序名称(*) | 作业名称；为空时取程序代号 |
| 计费时数-客户(*) | 工时；无时数记 0 |
| 软代派工时数(*) | 工时；无时数记 0 |
| 系统代号(*) | 作业编号前三位（大写） |
| 规格说明(*) | 需求描述 |
| 客制类型 / 难度等级 / 开发分类 / 集成产品编号 / 急单 / 备注 | 按模板示例行的默认值填充 |

导出基于当前界面上的明细（含未保存的修改）。

## 打包

```powershell
npm run dist        # tsc + vite build + electron-builder（→ release/<版本>/…-Setup.exe）
```

离线/内网环境注意事项（electron-builder 默认会从 GitHub 下载 Electron 与 winCodeSign）：

```powershell
# 1) 用本地已安装的 Electron 发行版，跳过下载
npx electron-builder -c.electronDist=node_modules/electron/dist --publish never

# 2) 若 winCodeSign 无法下载（仅影响图标/版本信息写入与签名），先跳过
npx electron-builder -c.electronDist=node_modules/electron/dist -c.win.signAndEditExecutable=false
```

打包配置与验收清单见 [`docs/INSTALL.md`](docs/INSTALL.md)。

## 已知限制

- 未接入自动更新（electron-updater 与发版流水线为下一阶段）；目前通过重新安装安装包升级。
- 安装包尚未代码签名，Windows SmartScreen 会提示未知发布者；在签名前不应开启静默自动更新。
- 备份只包含数据库；附件为只增不改的内容寻址文件，删除时进 `files/.trash`（7 天后清理）。
