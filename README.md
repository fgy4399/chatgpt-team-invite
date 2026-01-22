# ChatGPT Team 邀请码管理系统

基于 Next.js + Prisma 的 ChatGPT Team 邀请码管理与自动邀请工具：用户提交“邀请码 + 邮箱”，系统自动发起 Team 邀请，并提供状态查询；管理员可生成/撤销邀请码、管理多个 Team、同步成员数与名额。

## 功能特性

- 管理员后台：登录、邀请码生成/撤销、数据概览
- 邀请流程：邀请码绑定邮箱、可重试、成功后自动消耗
- 多团队管理：优先级、名额上限、成员数同步（并发限制）
- 状态页：查看邀请处理进度与结果（成功/失败/处理中）
- 存储：默认 SQLite（本地/小规模部署），可选 Turso/libsql

## 技术栈

- Next.js 16（App Router）
- Prisma + SQLite（`better-sqlite3`）/ Turso（libsql）
- TypeScript + ESLint

## 快速开始（本地开发）

```bash
cp .env.example .env
npm install
npx prisma migrate dev
npm run dev
```

访问：
- 用户页：`http://localhost:3000/`
- 管理后台：`http://localhost:3000/admin`

## 环境变量

以 `.env.example` 为准（本项目不会提交你的 `.env`）。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | ✅ | 管理员 JWT 签名密钥（建议 ≥ 32 位随机字符串） |
| `ADMIN_USERNAME` | ✅* | 仅用于“首次初始化管理员账号”（数据库里还没有任何 Admin 时生效） |
| `ADMIN_PASSWORD` | ✅* | 同上 |
| `CHATGPT_ACCESS_TOKEN` | 视情况 | 单团队模式：后台未配置任何 Team 时使用 |
| `CHATGPT_ACCOUNT_ID` | 视情况 | 单团队模式：后台未配置任何 Team 时使用 |
| `CHATGPT_COOKIES` | 可选 | 用于绕过 Cloudflare 验证（谨慎使用） |
| `DATABASE_URL` | 可选 | 生产建议配置；本地默认 `prisma/dev.db` |
| `DATABASE_AUTH_TOKEN` | 可选 | Turso/libsql 的鉴权 token |
| `LOG_LEVEL` | 可选 | `debug/info/warn/error` |

说明：
- 推荐在后台添加 Team（多团队模式）；只有当后台未配置任何 Team 时，才会使用 `CHATGPT_*` 单团队环境变量。
- 修改 `ADMIN_USERNAME/ADMIN_PASSWORD` 不会更新已存在的管理员账号（仅首次初始化生效）。

## 数据库与迁移

- 本地开发默认使用 SQLite：`prisma/dev.db`
- 迁移（开发）：`npx prisma migrate dev`
- 迁移（生产）：`npx prisma migrate deploy`

## 构建与运行

```bash
npm run build
npm run start
```

> 说明：Next.js 16 构建默认使用 Turbopack，但本项目包含自定义 webpack 配置，因此 `npm run build` 已默认启用 `--webpack`。

## Docker 部署（推荐）

项目已包含 `docker-compose.yml`（默认使用持久化 SQLite：`./docker-data/app.db`）。

```bash
docker compose pull
docker compose up -d
```

说明（以 `docker-compose.yml` 为准）：
- 默认拉取并运行镜像：`fgy4399/chatgpt-team-invite:latest`
- SQLite 数据文件持久化位置：`./docker-data/app.db`（容器内映射为 `/data/app.db`）
- 默认会在容器启动时自动执行迁移：`RUN_MIGRATIONS=1`（如需关闭可改为 `0`）

首次运行前请务必修改 `docker-compose.yml` 中的敏感配置（例如 `JWT_SECRET`、`ADMIN_PASSWORD`），或自行改造成 `env_file`/变量注入方式。

如果你需要使用自己构建/发布的镜像，请直接修改 `docker-compose.yml` 里的 `image:`（例如替换为你自己的 DockerHub 仓库与 tag）。

仅运行迁移（可选）：

```bash
docker compose run --rm app npx --no-install prisma migrate deploy
```

## DockerHub 镜像自动发布（Tag / 手动）

项目已内置 GitHub Actions 工作流：`.github/workflows/dockerhub-tag-release.yml`。

注意：该工作流只负责“构建并推送镜像”，不会自动修改 `docker-compose.yml`；如需使用你自己发布的镜像，请手动调整 compose 中的 `image:`。

在 GitHub 仓库的 Secrets 中配置：
- `DOCKERHUB_USERNAME`：DockerHub 用户名/组织名
- `DOCKERHUB_TOKEN`：DockerHub Access Token（推荐）或密码

当你推送一个新的 git tag（例如 `v1.0.0`）时，会自动构建并推送两份镜像标签：
- `${DOCKERHUB_USERNAME}/chatgpt-team-invite:v1.0.0`
- `${DOCKERHUB_USERNAME}/chatgpt-team-invite:latest`

如需为历史 Tag 补构建（例如补 `v1.0.6` 的 `arm64` 镜像），可以在 GitHub Actions 中手动运行该工作流，并指定：
- `ref`：要检出的 git ref（例如 `v1.0.6`）
- `image_tag`：要推送的镜像 tag（例如 `v1.0.6`）
- `push_latest`：是否同时推送 `latest`（手动补构建默认不推，避免误伤）

## 常见问题（Troubleshooting）

- **Docker 镜像未更新 / 使用了旧版本**：`docker compose pull && docker compose up -d`
- **管理员登录提示“登录尝试过于频繁”**：触发了限流/锁定策略，等待一段时间后再试

## 安全提示

- 生产环境务必设置强随机的 `JWT_SECRET`（建议长度 ≥ 32）
- 将服务放在 HTTPS 与反向代理之后（如 Nginx/Caddy），避免明文传输敏感信息

## 更新日志（Changelog）

### [1.0.7] - 2026-01-22
#### 变更
- DockerHub 镜像构建支持多架构（`linux/amd64` + `linux/arm64`）。
- DockerHub 镜像发布工作流支持手动触发（`workflow_dispatch`），用于补构建指定 ref/tag 的镜像；手动触发默认不推送 `latest`。
- 管理后台团队列表：表格固定布局 + 列宽，团队名与账号 ID 文本截断展示（`truncate` + `title`）。

### [1.0.5] - 2026-01-22
#### 变更
- 添加 Team 时改用 subscriptions 获取到期时间。
- 修复“即将满员”标签导致表格抖动的问题。
- Docker Compose 默认改为直接拉取并运行 DockerHub 镜像（不再本地构建），并对齐相关文档说明。
#### 移除
- 删除 `CHANGELOG.md` 与 `RELEASE_NOTES_v1.0.2.md / v1.0.3.md / v1.0.4.md`，更新记录统一写入 `README.md`。

### [1.0.4] - 2026-01-21
#### 新增
- 新增按团队维度的成员数量同步接口。
#### 变更
- 团队列表增加按团队同步操作，并在移除成员后更新数量。

### [1.0.3] - 2026-01-21
#### 新增
- 新增团队的管理员成员移除 API 接口。
#### 变更
- 成员弹窗新增“踢出”操作，并提供错误提示反馈。

### [1.0.2] - 2026-01-20
#### 新增
- 进入管理员仪表盘时增加跳转过渡效果（淡入 + 加载旋转图标）。
#### 变更
- 管理员登录页在检测到已保存的管理员 Token 时自动跳转到仪表盘。
- 首页的管理员入口在已登录时直接链接到仪表盘。

## 许可证（License）

本项目采用 MIT License 开源，详见 `LICENSE`。
