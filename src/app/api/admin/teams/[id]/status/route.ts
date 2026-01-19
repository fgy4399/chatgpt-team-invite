import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { getTeamSubscriptionForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/admin/teams/[id]/status - 检测指定团队的远端有效性（不返回敏感凭据）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = getTokenFromRequest(req);
    if (!token) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "登录已失效，请重新登录" },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "缺少团队 ID" }, { status: 400 });
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        accountId: true,
        accessToken: true,
        cookies: true,
        isActive: true,
        expiresAt: true,
        maxMembers: true,
        currentMembers: true,
        priority: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    const checkedAt = new Date();
    const expired = team.expiresAt ? checkedAt > team.expiresAt : false;

    const subscriptionResult = await getTeamSubscriptionForTeam(
      team.accountId,
      team.accessToken,
      team.cookies || undefined
    );

    const local = {
      isActive: team.isActive,
      expiresAt: team.expiresAt,
      expired,
      maxMembers: team.maxMembers,
      currentMembers: team.currentMembers,
      priority: team.priority,
    };

    if (!subscriptionResult.success) {
      return NextResponse.json({
        ok: false,
        checkedAt: checkedAt.toISOString(),
        teamId: team.id,
        teamName: team.name,
        local,
        error: subscriptionResult.error || "检测失败",
        requiresCookies: Boolean(subscriptionResult.requiresCookies),
        upstreamStatus: subscriptionResult.status,
      });
    }

    const subscription = subscriptionResult.subscription || {};
    return NextResponse.json({
      ok: true,
      checkedAt: checkedAt.toISOString(),
      teamId: team.id,
      teamName: team.name,
      local,
      subscription: {
        seats_available: subscription.seats_available,
        seats_used: subscription.seats_used,
        plan_type: subscription.plan_type,
      },
      upstreamStatus: subscriptionResult.status,
    });
  } catch (error) {
    logger.error("Teams", "Check team status error:", error);
    return NextResponse.json(
      { error: "检测团队状态失败" },
      { status: 500 }
    );
  }
}

