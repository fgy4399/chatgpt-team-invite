# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

ChatGPT Team 邀请码管理系统 - 一个用于管理和分发 ChatGPT Team 邀请的 Web 应用。用户通过邀请码提交邮箱后，系统自动调用 ChatGPT API 发送团队邀请。

## 常用命令

```bash
# 开发
npm run dev          # 启动开发服务器 (localhost:3000)
npm run build        # 构建生产版本
npm run lint         # 运行 ESLint

# 数据库
npx prisma migrate dev   # 运行数据库迁移
npx prisma generate      # 生成 Prisma Client
npx prisma studio        # 打开数据库管理界面
```

## 技术栈

- **框架**: Next.js 16 (App Router)
- **数据库**: SQLite + Prisma ORM (使用 better-sqlite3 适配器)
- **认证**: JWT (jsonwebtoken) + bcrypt 密码哈希
- **样式**: Tailwind CSS 4

## 架构

### 目录结构
```
src/
├── app/                    # Next.js App Router 页面
│   ├── api/               # API 路由
│   │   ├── admin/         # 管理员 API (login, codes, codes/generate)
│   │   └── invite/        # 邀请 API (validate, submit, status/[id])
│   ├── admin/             # 管理员页面 (登录、仪表板)
│   ├── status/[id]/       # 邀请状态查看页
│   └── page.tsx           # 首页 (邀请码输入表单)
├── lib/                   # 工具库
│   ├── prisma.ts          # Prisma 客户端实例
│   ├── chatgpt.ts         # ChatGPT Team API 封装
│   ├── auth.ts            # JWT 认证工具
│   └── utils.ts           # 通用工具函数
└── generated/prisma/      # Prisma 生成的客户端代码
```

### 数据模型 (prisma/schema.prisma)
- **Admin**: 管理员账户
- **InviteCode**: 邀请码 (状态: PENDING/USED/EXPIRED/REVOKED)
- **Invitation**: 邀请记录 (状态: PENDING/SUCCESS/FAILED)
- **SystemConfig**: 系统配置键值对

### 核心流程
1. 管理员登录后生成邀请码
2. 用户输入邀请码 + 邮箱
3. 系统验证邀请码有效性
4. 调用 `src/lib/chatgpt.ts` 的 `sendTeamInvite()` 发送邀请
5. 更新邀请码和邀请记录状态

## 环境变量

必需的环境变量 (参考 .env):
- `CHATGPT_ACCESS_TOKEN`: ChatGPT API 访问令牌
- `CHATGPT_ACCOUNT_ID`: ChatGPT 账户 ID
- `CHATGPT_COOKIES`: (可选) 用于绕过 Cloudflare 验证
- `JWT_SECRET`: JWT 签名密钥
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`: 默认管理员凭据

## 路径别名

使用 `@/*` 指向 `./src/*` (配置在 tsconfig.json)

## 语言

项目 UI 使用中文，请保持代码注释和用户界面文字使用中文。
