import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { removeTeamMemberForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// DELETE /api/admin/teams/[id]/members/[memberId] - 移除指定团队成员
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
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

    const { id, memberId } = await params;
    if (!id || !memberId) {
      return NextResponse.json(
        { error: "缺少团队 ID 或成员 ID" },
        { status: 400 }
      );
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

    const result = await removeTeamMemberForTeam(
      team.accountId,
      team.accessToken,
      memberId,
      team.cookies || undefined
    );

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || "踢出成员失败",
          requiresCookies: result.requiresCookies,
        },
        { status: result.status ?? 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Teams", "Remove team member error:", error);
    return NextResponse.json({ error: "踢出成员失败" }, { status: 500 });
  }
}
