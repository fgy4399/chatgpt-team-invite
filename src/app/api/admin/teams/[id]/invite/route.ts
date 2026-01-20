import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { sendTeamInviteForTeam } from "@/lib/chatgpt";
import { isValidEmail } from "@/lib/utils";
import { logger } from "@/lib/logger";

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

    if (team.maxMembers !== 0 && team.currentMembers >= team.maxMembers) {
      return NextResponse.json(
        { error: "该团队名额已满，请先同步成员数或调整上限" },
        { status: 400 }
      );
    }

    const result = await sendTeamInviteForTeam(email, {
      accountId: team.accountId,
      accessToken: team.accessToken,
      cookies: team.cookies || undefined,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "发送邀请失败" },
        { status: 502 }
      );
    }

    // 成功发送后，更新本地缓存的成员数（实际成员数以“同步成员数”为准）
    await prisma.team.update({
      where: { id: team.id },
      data: { currentMembers: { increment: 1 } },
    });

    return NextResponse.json({
      success: true,
      teamId: team.id,
      teamName: team.name,
      message: "邀请已发送成功！请检查邮箱。",
    });
  } catch (error) {
    logger.error("Teams", "Manual invite error:", error);
    return NextResponse.json({ error: "发送邀请失败" }, { status: 500 });
  }
}
