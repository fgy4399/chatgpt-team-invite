import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { getAllTeamMembersForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/admin/teams/[id]/members - 获取指定团队的成员列表
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
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    const result = await getAllTeamMembersForTeam(
      team.accountId,
      team.accessToken,
      team.cookies || undefined
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取成员列表失败" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      teamId: team.id,
      teamName: team.name,
      members: result.members || [],
      total:
        result.total !== undefined
          ? result.total
          : result.members
            ? result.members.length
            : 0,
    });
  } catch (error) {
    logger.error("Teams", "Get team members error:", error);
    return NextResponse.json(
      { error: "获取成员列表失败" },
      { status: 500 }
    );
  }
}
