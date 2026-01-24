import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { sendTeamInviteForTeam } from "@/lib/chatgpt";
import { isValidEmail } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";
import { releaseTeamSeat, tryReserveTeamSeat } from "@/lib/teamAssignment";
import { InvitationStatus } from "@/generated/prisma";

export const runtime = "nodejs";

// POST /api/admin/teams/[id]/invite - 使用指定团队手动发送邀请
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

    const { email } = (await req.json().catch(() => ({}))) as Partial<{
      email: string;
    }>;

    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: "邮箱格式无效" }, { status: 400 });
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
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    if (!team.isActive) {
      return NextResponse.json(
        { error: "该团队已禁用，无法发送邀请" },
        { status: 400 }
      );
    }

    const now = new Date();
    if (team.expiresAt && now > team.expiresAt) {
      return NextResponse.json(
        { error: "该团队已到期，无法发送邀请" },
        { status: 400 }
      );
    }

    let currentMembers = team.currentMembers;
    if (team.maxMembers !== 0) {
      const reservedInvites = await prisma.invitation.count({
        where: {
          teamId: team.id,
          status: { in: [InvitationStatus.PENDING, InvitationStatus.SUCCESS] },
        },
      });

      if (reservedInvites > currentMembers) {
        currentMembers = reservedInvites;
        await prisma.team.update({
          where: { id: team.id },
          data: { currentMembers },
        });
      }
    }

    if (team.maxMembers !== 0 && currentMembers >= team.maxMembers) {
      return NextResponse.json(
        { error: "该团队名额已满，请先同步成员数或调整上限" },
        { status: 400 }
      );
    }

    if (!team.cookies) {
      return NextResponse.json(
        { error: "团队未配置 Cookies，无法自动刷新 Access Token" },
        { status: 400 }
      );
    }

    const seatReserved =
      team.maxMembers !== 0
        ? await tryReserveTeamSeat(team.id, team.maxMembers)
        : false;

    if (team.maxMembers !== 0 && !seatReserved) {
      return NextResponse.json(
        { error: "该团队名额已满，请先同步成员数或调整上限" },
        { status: 400 }
      );
    }

    const result = await withTeamTokenRefresh(team, (credentials) =>
      sendTeamInviteForTeam(email, {
        accountId: credentials.accountId,
        accessToken: credentials.accessToken,
        cookies: credentials.cookies,
      })
    );

    if (!result.success) {
      if (seatReserved) {
        await releaseTeamSeat(team.id);
      }
      return NextResponse.json(
        { error: result.error || "发送邀请失败" },
        { status: result.status ?? 502 }
      );
    }

    return NextResponse.json({
      success: true,
      teamId: team.id,
      teamName: team.name,
      message: "邀请邮件已发送，请检查邮箱并接受邀请后加入团队。",
    });
  } catch (error) {
    logger.error("Teams", "Manual invite error:", error);
    return NextResponse.json({ error: "发送邀请失败" }, { status: 500 });
  }
}
