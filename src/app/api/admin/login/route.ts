import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, generateToken, hashPassword } from "@/lib/auth";
import { checkRateLimit, getClientIdentifier } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    // 速率限制检查 - 防止暴力破解
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, "admin-login");
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "登录尝试过于频繁，请 15 分钟后再试" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.resetTime.toString(),
          },
        }
      );
    }

    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: "用户名和密码为必填项" },
        { status: 400 }
      );
    }

    // 仅在“系统内没有任何管理员账号”时允许使用环境变量初始化管理员
    const adminCount = await prisma.admin.count();
    if (adminCount === 0) {
      const bootstrapUsername = process.env.ADMIN_USERNAME;
      const bootstrapPassword = process.env.ADMIN_PASSWORD;

      if (!bootstrapUsername || !bootstrapPassword) {
        return NextResponse.json(
          { error: "系统未配置默认管理员账号/密码，无法初始化管理员" },
          { status: 500 }
        );
      }

      if (username !== bootstrapUsername || password !== bootstrapPassword) {
        return NextResponse.json(
          { error: "账号或密码错误" },
          { status: 401 }
        );
      }

      const admin = await prisma.admin.create({
        data: {
          username,
          passwordHash: await hashPassword(password),
          lastLoginAt: new Date(),
        },
      });

      const token = generateToken(admin.id, admin.username);
      return NextResponse.json({
        token,
        username: admin.username,
        expiresIn: "24h",
      });
    }

    // Find admin (正常登录流程)
    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin) {
      return NextResponse.json(
        { error: "账号或密码错误" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, admin.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "账号或密码错误" },
        { status: 401 }
      );
    }

    // Update last login
    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    // Generate token
    const token = generateToken(admin.id, admin.username);

    return NextResponse.json({
      token,
      username: admin.username,
      expiresIn: "24h",
    });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json({ error: "登录失败" }, { status: 500 });
  }
}
