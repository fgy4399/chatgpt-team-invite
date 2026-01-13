import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { InviteCodeStatus } from "@/generated/prisma";

export const runtime = "nodejs";

// GET /api/admin/codes - List invite codes
export const GET = withAuth(async (req: NextRequest) => {
  try {
    // 后台列表顺便清理过期邀请码，避免“过期仍显示可用”
    await prisma.inviteCode.updateMany({
      where: {
        status: InviteCodeStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: InviteCodeStatus.EXPIRED },
    });

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");

    const isValidStatus = (value: string): value is InviteCodeStatus =>
      Object.values(InviteCodeStatus).includes(value as InviteCodeStatus);

    const status = statusParam && isValidStatus(statusParam) ? statusParam : null;
    const where = status ? { status } : {};
    const skip = (page - 1) * limit;

    const [codes, total, statsTotal, statsPending, statsUsed, statsExpired] = await Promise.all([
      prisma.inviteCode.findMany({
        where,
        include: {
          invitation: {
            select: {
              email: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.inviteCode.count({ where }),
      prisma.inviteCode.count(),
      prisma.inviteCode.count({
        where: {
          status: InviteCodeStatus.PENDING,
          invitation: { is: null },
        },
      }),
      prisma.inviteCode.count({ where: { status: InviteCodeStatus.USED } }),
      prisma.inviteCode.count({
        where: {
          status: { in: [InviteCodeStatus.EXPIRED, InviteCodeStatus.REVOKED] },
        },
      }),
    ]);

    const stats = {
      total: statsTotal,
      pending: statsPending, // 可用：未绑定邮箱的 PENDING 邀请码
      used: statsUsed,
      expired: statsExpired,
    };

    return NextResponse.json({
      codes,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats,
    });
  } catch (error) {
    logger.error("Codes", "List codes error:", error);
    return NextResponse.json(
      { error: "获取邀请码列表失败" },
      { status: 500 }
    );
  }
});

// DELETE /api/admin/codes - Revoke a code
export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json(
        { error: "缺少邀请码 ID" },
        { status: 400 }
      );
    }

    const code = await prisma.inviteCode.findUnique({
      where: { id },
    });

    if (!code) {
      return NextResponse.json({ error: "邀请码不存在" }, { status: 404 });
    }

    if (code.status !== InviteCodeStatus.PENDING) {
      return NextResponse.json(
        { error: "只能撤销未使用的邀请码" },
        { status: 400 }
      );
    }

    await prisma.inviteCode.update({
      where: { id },
      data: { status: InviteCodeStatus.REVOKED },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Codes", "Revoke code error:", error);
    return NextResponse.json(
      { error: "撤销邀请码失败" },
      { status: 500 }
    );
  }
});
