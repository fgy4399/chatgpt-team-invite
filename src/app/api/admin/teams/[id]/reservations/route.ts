import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { InvitationStatus } from "@/generated/prisma";
import { logger } from "@/lib/logger";
import { getTeamMembersForTeam } from "@/lib/chatgpt";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";

export const runtime = "nodejs";

type ReservationActionRequest =
  | {
      action: "release";
      invitationIds: string[];
      actualMemberCount?: number;
    }
  | {
      action: "recalculate";
      actualMemberCount?: number;
    };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// GET /api/admin/teams/[id]/reservations - 查看该团队的“占位”邀请记录（PENDING/SUCCESS）
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
        maxMembers: true,
        currentMembers: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    const reservations = await prisma.invitation.findMany({
      where: {
        teamId: team.id,
        status: { in: [InvitationStatus.PENDING, InvitationStatus.SUCCESS] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        processedAt: true,
        inviteCode: {
          select: {
            code: true,
            status: true,
            createdAt: true,
            expiresAt: true,
            usedAt: true,
          },
        },
      },
    });

    return NextResponse.json({
      teamId: team.id,
      teamName: team.name,
      maxMembers: team.maxMembers,
      currentMembers: team.currentMembers,
      reservedCount: reservations.length,
      reservations,
    });
  } catch (error) {
    logger.error("Teams", "List team reservations error:", error);
    return NextResponse.json(
      { error: "获取占位列表失败" },
      { status: 500 }
    );
  }
}

// POST /api/admin/teams/[id]/reservations - 释放占位 / 重新计算占用数
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

    const body = (await req.json().catch(() => ({}))) as Partial<
      ReservationActionRequest
    >;

    if (body.action !== "release" && body.action !== "recalculate") {
      return NextResponse.json({ error: "缺少 action" }, { status: 400 });
    }

    const team = await prisma.team.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        accountId: true,
        accessToken: true,
        cookies: true,
        maxMembers: true,
        currentMembers: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "团队不存在" }, { status: 404 });
    }

    const now = new Date();

    let releasedCount = 0;
    if (body.action === "release") {
      const invitationIds = Array.isArray(body.invitationIds)
        ? (body.invitationIds as string[]).filter((item) => typeof item === "string")
        : [];

      if (invitationIds.length === 0) {
        return NextResponse.json(
          { error: "缺少 invitationIds" },
          { status: 400 }
        );
      }

      const invitations = await prisma.invitation.findMany({
        where: {
          id: { in: invitationIds },
          teamId: team.id,
          status: { in: [InvitationStatus.PENDING, InvitationStatus.SUCCESS] },
        },
        select: { id: true },
      });

      if (invitations.length === 0) {
        return NextResponse.json(
          { error: "未找到可释放的占位记录" },
          { status: 404 }
        );
      }

      const idsToRelease = invitations.map((item) => item.id);
      await prisma.invitation.updateMany({
        where: { id: { in: idsToRelease } },
        data: {
          status: InvitationStatus.FAILED,
          errorMessage: "管理员释放占位",
          processedAt: now,
        },
      });
      releasedCount = idsToRelease.length;
    }

    const remainingReserved = await prisma.invitation.count({
      where: {
        teamId: team.id,
        status: { in: [InvitationStatus.PENDING, InvitationStatus.SUCCESS] },
      },
    });

    let actualMembersCount: number | null = isNonNegativeInteger(body.actualMemberCount)
      ? body.actualMemberCount
      : null;

    let upstreamError: string | undefined;
    if (actualMembersCount === null) {
      const membersResult = await withTeamTokenRefresh(team, (credentials) =>
        getTeamMembersForTeam(
          credentials.accountId,
          credentials.accessToken,
          credentials.cookies
        )
      );

      if (membersResult.success) {
        actualMembersCount =
          typeof membersResult.total === "number"
            ? membersResult.total
            : membersResult.members
              ? membersResult.members.length
              : 0;
      } else {
        upstreamError = membersResult.error || "获取真实成员数失败";
      }
    }

    const safeBase =
      typeof actualMembersCount === "number"
        ? actualMembersCount
        : team.currentMembers;
    const nextCurrentMembers = Math.max(safeBase, remainingReserved);

    await prisma.team.update({
      where: { id: team.id },
      data: { currentMembers: nextCurrentMembers },
    });

    return NextResponse.json({
      success: true,
      teamId: team.id,
      teamName: team.name,
      releasedCount,
      remainingReserved,
      actualMembersCount,
      currentMembers: nextCurrentMembers,
      warning: actualMembersCount === null ? upstreamError : undefined,
    });
  } catch (error) {
    logger.error("Teams", "Update team reservations error:", error);
    return NextResponse.json(
      { error: "处理占位操作失败" },
      { status: 500 }
    );
  }
}
