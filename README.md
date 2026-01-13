# ChatGPT Team 邀请码管理系统

一个用于管理和分发 ChatGPT Team 邀请的 Web 应用。用户通过邀请码提交邮箱后，系统自动调用 ChatGPT Team API 发送团队邀请，并提供状态页查询。

## 功能

- 管理员登录、生成/撤销邀请码
- 多团队账号管理（优先级、名额上限、成员数同步）
- 用户邀请码 + 邮箱申请邀请
- 邀请状态查询（成功/失败/处理中）

## 本地开发

1. 复制并填写环境变量：`cp .env.example .env`
2. 安装依赖：`npm install`
3. 初始化/迁移数据库：`npx prisma migrate dev`
4. 启动开发服务器：`npm run dev`

访问：
- 用户页：`/`
- 管理后台：`/admin`

## 数据库

- 默认本地 SQLite：`prisma/dev.db`（无需额外配置）
- 生产环境建议使用 Turso/libsql：配置 `DATABASE_URL` 与 `DATABASE_AUTH_TOKEN`

## 构建与部署

- 构建：`npm run build`（默认使用 Turbopack）
- 如遇到 Turbopack 兼容问题：`npm run build -- --webpack`

## Docker 部署

使用 SQLite（推荐开发/小规模自建）：

```bash
docker compose up -d --build
```

- 默认监听：`http://localhost:3000`
- 默认使用持久化 SQLite：`./docker-data/app.db`（容器内路径 `/data/app.db`）

首次运行前请修改 `docker-compose.yml` 里的 `JWT_SECRET` / `ADMIN_PASSWORD` 等敏感配置，或改用 `env_file` 注入环境变量。

仅运行迁移（可选）：

```bash
docker compose run --rm app npx --no-install prisma migrate deploy
```

## 安全提示

- 生产环境务必设置强随机的 `JWT_SECRET`（建议长度 ≥ 32）
- `ADMIN_USERNAME` / `ADMIN_PASSWORD` 仅用于“首次初始化管理员账号”（数据库中没有任何 Admin 时生效）
