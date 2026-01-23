import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { getTeamMembersForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";

export const runtime = "nodejs";

// POST /api/admin/teams/[id]/sync - Sync single team member count
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

    const membersResult = await withTeamTokenRefresh(team, (credentials) =>
      getTeamMembersForTeam(
        credentials.accountId,
        credentials.accessToken,
        credentials.cookies
      )
    );

    if (!membersResult.success) {
      return NextResponse.json(
        { error: membersResult.error || "同步成员数失败" },
        { status: membersResult.status ?? 502 }
      );
    }

    const nextCount =
      typeof membersResult.total === "number"
        ? membersResult.total
        : membersResult.members
          ? membersResult.members.length
          : 0;

    await prisma.team.update({
      where: { id: team.id },
      data: { currentMembers: nextCount },
    });

    return NextResponse.json({ success: true, currentMembers: nextCount });
  } catch (error) {
    logger.error("Teams", "Sync team members error:", error);
    return NextResponse.json({ error: "同步成员数失败" }, { status: 500 });
  }
}
