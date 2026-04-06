# 仓库指南

## 项目结构与模块组织
- `src/app/` 包含 Next.js App Router 入口、路由与 API 处理器（例如 `src/app/api/generate/route.ts`）。
- `src/components/` 存放共享 UI 与功能组件（其中 `src/components/ui/` 为 shadcn/ui 基础组件）。
- `src/lib/` 提供全局工具函数与状态/数据辅助模块。
- `public/` 存放静态资源，根路径可直接访问（例如 `public/next.svg`）。

## 构建、测试与本地开发命令
- `pnpm install` 安装依赖。
- `pnpm dev` 启动开发服务器（`http://localhost:3000`）。
- `pnpm build` 生成生产构建。
- `pnpm start` 启动生产构建服务。
- `pnpm lint` 运行 ESLint（包含 Next.js core-web-vitals 与 TypeScript 规则）。

## 代码风格与命名约定
- 语言：TypeScript + React (JSX)，使用 Next.js App Router。
- 格式化：未配置格式化工具；保持与现有代码风格一致、整洁可读。
- 导入：内部模块使用路径别名 `@/*`（见 `tsconfig.json`），例如 `@/lib/utils`。
- 组件文件为 `*.tsx`；API 路由位于 `src/app/api/**/route.ts`。
- UI 部分编写必须遵守 `UI Skills.md`。

## 测试指南
- 当前未配置自动化测试框架或测试目录。
- 若新增测试，建议就近放置（如 `src/lib/__tests__/...`），并在 `package.json` 中补充相应命令说明。

## 提交与 PR 指南
- 该目录未包含 Git 历史，因此无法确认既有提交规范。
- 建议：提交信息简短、祈使句式（例如 "Add prompt optimizer endpoint"）。
- PR 建议包含：简要说明、涉及 UI 变更时的截图、以及必要的配置/使用说明。
- **回复 Issue 和发布 Release 时统一使用英文**。

## Docker 部署指南
- 打包命令：`docker build --platform linux/amd64 -t qunqin45/ai-img:latest .`
- 推送命令：`docker push qunqin45/ai-img:latest`
- 每次部署直接更新 latest 镜像，无需版本号。

## 配置与安全注意事项
- Gemini API Key 与 API URL 通过右上角设置填写，仅保存在浏览器中。
- 避免提交敏感信息；如需新增环境变量，请在 `README.md` 中说明并提供示例（如 `.env.example`）。
- 修复过程中发现的 bug 需要记录在 `bug.md`，避免后续重复踩坑。
- 记录格式（逐条追加）：
  - `日期`：YYYY-MM-DD
  - `位置`：文件路径 + 关键函数/模块
  - `现象`：用户可见问题或报错
  - `原因`：根因简述
  - `修复`：改动要点
  - `验证`：如何确认已修复
  - 仅记录功能性问题（逻辑/数据/接口/权限/崩溃等）；纯 UI 布局/样式调整不记录。
- 重大变更（新增一个新模块或大规模修改）统一记录在一个单独的 `major-changes.md` 文件中。
  - 重大变更记录格式（逐条追加）：
    - `日期`：YYYY-MM-DD
    - `标题`：简短概括
    - `范围`：涉及模块/目录
    - `背景`：为什么要做
    - `变更`：关键改动点
    - `影响`：对用户/接口/数据的影响
    - `验证`：如何确认
