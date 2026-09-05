# TBM Lite

需求书管理系统 —— 原 [TBM](../TBM) 项目的 shadcn/ui 重写精简版。

保留四项核心能力：

| 能力 | 说明 |
|---|---|
| 创建项目 | 项目编号 / 名称 CRUD，删除前检查需求书引用 |
| 上传需求书 | 上传 .docx 需求确认书，AI 自动解析需求书编号与需求明细；明细支持手动维护、状态流转、开发人员填写（姓名直填）；附件可打开 / 另存 / 替换 |
| 开发人员填写 | 需求明细中的「开发人员」为自由文本，直接填写姓名 |
| AI 搜索 | 基于全量项目 / 需求书 / 需求明细数据的自然语言问答，流式输出，多轮会话，项目过滤，回答中需求书可点击跳转 |

## 技术栈

| 类别 | 库 |
|---|---|
| 桌面框架 | Electron 30 |
| UI | shadcn/ui（new-york + Radix）+ Tailwind CSS v4 + lucide-react |
| 构建 | Vite 5 + vite-plugin-electron |
| 数据库 | SQLite（@libsql/client + drizzle-orm），启动时幂等建表 |
| AI | openai SDK（OpenAI 兼容接口）+ @jose.espana/docstream（.docx → Markdown） |
| Markdown | react-markdown + remark-gfm |

## 目录结构

```
TbmLite/
├── electron/                        # Electron 主进程
│   ├── main.ts                      # 窗口创建 + 启动建表 + 注册 IPC
│   ├── preload.ts                   # contextBridge：window.api
│   ├── ipc.ts                       # 全部 ipcMain.handle 集中注册
│   ├── db/                          # schema.ts（4 张表）+ migrate.ts（幂等 DDL）
│   ├── services/                    # project / requirement / attachment / agent
│   ├── core/
│   │   ├── agent/                   # docx-parser（AI 提取）、search-agent（流式问答）、session-store、config
│   │   └── constants.ts             # 状态码（与原 TBM sscc 一致）
│   └── utils/                       # paths、logger
├── src/
│   ├── components/
│   │   ├── ui/                      # shadcn/ui 组件
│   │   ├── layout/                  # AppShell（侧边导航）、PageHeader
│   │   ├── projects/                # 项目对话框
│   │   └── requirements/            # 需求书上传对话框（.docx AI 解析）
│   └── pages/
│       ├── projects-page.tsx        # 项目管理
│       ├── requirements-page.tsx    # 需求书列表
│       ├── requirement-detail-page.tsx  # 需求书详情（主档/附件/明细，开发人员姓名直填）
│       ├── ai-search-page.tsx       # AI 搜索（流式聊天）
│       └── settings-page.tsx        # AI API 配置
├── electron/app-data/dev/           # 开发态数据目录（db / files / config / logs）
└── drizzle.config.ts                # 供 drizzle-kit 使用（可选）
```

## 数据库表

| 表名 | 说明 | 主键 |
|---|---|---|
| pjaa | 项目 | pjaa001 |
| xqaa_t | 需求书主档 | (xqaapj, xqaa001) |
| xqab_t | 需求书明细 | (xqabpj, xqab001, xqabseq)，xqab006 为开发人员姓名（自由文本） |
| ffff_t | 附件 | ffff004 |

状态码沿用原 TBM sscc 分类码：需求书 `1 进行中 / 2 已结案`；需求项 `1 需求评估 / 2 需求开发 / 3 顾问确认 / 4 用户确认 / 5 已结案`。

## 使用

```powershell
npm install        # 安装依赖
npm run dev        # 开发（Vite + Electron）
npm run build      # 构建（tsc + vite build → dist / dist-electron）
npm run dist       # 打包安装包（electron-builder）
```

首次使用前，进入「设置」页填写 AI API 配置（OpenAI 兼容接口，默认 DeepSeek），
配置文件保存于应用数据目录 `config/aj-api.json`。也可以直接编辑
`electron/app-data/dev/config/aj-api.json`。

## 数据迁移（从旧 TBM）

```powershell
npx tsx scripts/migrate-from-tbm.ts   # 迁移旧库数据（幂等，可重复执行）
npx tsx scripts/verify-migration.ts   # 校验迁移完整性
```

脚本从 `../TBM/electron/app-data/dev` 读取旧库，迁移范围：

| 数据 | 是否迁移 |
|---|---|
| pjaa 项目 | ✅ 全量（按主键去重） |
| xqaa_t 需求书主档 | ✅ 全量 |
| xqab_t 需求书明细 | ✅ 全量（开发人原样保留为姓名文本） |
| ffff_t 需求书附件（.docx） | ✅ 记录 + 物理文件一并复制 |
| xqac_t 待办及其附件 | ❌ 新项目已移除待办功能 |
| sscc / zjac / seus / 用户等 | ❌ 未使用 |

执行前会自动备份新库（`app.db.bak-<时间戳>`）。

## 与原 TBM 的差异

- UI 由 antd 重写为 shadcn/ui（无圆角直角设计），去掉多标签页 / KeepAlive / 过滤 store 等复杂机制
- 移除：工作台、进度看板、需求明细列表、待办事项报表、需求项详情、文档预览窗口、惯用待办、用户设置等页面
- 开发人员不再单独建目录维护，需求明细中直接填写姓名（原版为「开发人」文本字段，同样直填）
- 附件仅保留需求书级（xqaa_t），文件按 sha256 去重存放于 `files/xqaa_t/`
- AI 搜索上下文从「需求书+明细+待办」精简为「项目+需求书+明细+附件名」
