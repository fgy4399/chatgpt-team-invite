import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import {
  cancelTeamSubscriptionForTeam,
  getTeamSubscriptionForTeam,
} from "@/lib/chatgpt";
import { logger } from "@/lib/logger";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";

export const runtime = "nodejs";

// POST /api/admin/teams/[id]/subscription/cancel - 取消订阅自动续费
export async function POST(
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
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    if (!team.cookies) {
      return NextResponse.json(
        { error: "团队未配置 Cookies，无法自动刷新 Access Token" },
        { status: 400 }
      );
    }

    const cancelResult = await withTeamTokenRefresh(team, (credentials) =>
      cancelTeamSubscriptionForTeam(
        credentials.accountId,
        credentials.accessToken,
        credentials.cookies
      )
    );

    if (!cancelResult.success) {
      return NextResponse.json(
        { error: cancelResult.error || "取消自动续费失败" },
        { status: cancelResult.status ?? 502 }
      );
    }

    const subscriptionResult = await withTeamTokenRefresh(team, (credentials) =>
      getTeamSubscriptionForTeam(
        credentials.accountId,
        credentials.accessToken,
        credentials.cookies
      )
    );

    const subscription = subscriptionResult.success
      ? subscriptionResult.subscription || {}
      : {};

    return NextResponse.json({
      success: true,
      teamId: team.id,
      teamName: team.name,
      subscription: {
        plan_type: subscription.plan_type,
        active_until: subscription.active_until,
        billing_period: subscription.billing_period,
        will_renew: subscription.will_renew,
        seats_available: subscription.seats_available,
        seats_used: subscription.seats_used,
      },
    });
  } catch (error) {
    logger.error("Teams", "Cancel subscription error:", error);
    return NextResponse.json(
      { error: "取消自动续费失败" },
      { status: 500 }
    );
  }
}
