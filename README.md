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

如遇到构建兼容问题，可使用 webpack 模式：

```bash
npm run build -- --webpack
```

## Docker 部署（推荐）

项目已包含 `docker-compose.yml`（默认使用持久化 SQLite：`./docker-data/app.db`）。

```bash
docker compose up -d --build
```

首次运行前请务必修改 `docker-compose.yml` 中的敏感配置（例如 `JWT_SECRET`、`ADMIN_PASSWORD`），或自行改造成 `env_file`/变量注入方式。

仅运行迁移（可选）：

```bash
docker compose run --rm app npx --no-install prisma migrate deploy
```

## 常见问题（Troubleshooting）

- **Docker 构建失败 / 使用了旧缓存**：`docker compose build --no-cache && docker compose up -d`
- **管理员登录提示“登录尝试过于频繁”**：触发了限流/锁定策略，等待一段时间后再试

## 安全提示

- 生产环境务必设置强随机的 `JWT_SECRET`（建议长度 ≥ 32）
- 将服务放在 HTTPS 与反向代理之后（如 Nginx/Caddy），避免明文传输敏感信息
