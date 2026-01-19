import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { getTeamMembersForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// GET /api/admin/teams - Get all teams
export const GET = withAuth(async () => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { priority: "asc" },
      select: {
        id: true,
        name: true,
        accountId: true,
        maxMembers: true,
        currentMembers: true,
        isActive: true,
        expiresAt: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { invitations: true },
        },
      },
    });

    return NextResponse.json({ teams });
  } catch (error) {
    logger.error("Teams", "Get teams error:", error);
    return NextResponse.json(
      { error: "获取团队列表失败" },
      { status: 500 }
    );
  }
});

// POST /api/admin/teams - Create a new team
export const POST = withAuth(async (req: NextRequest) => {
  try {
    const { name, accountId, accessToken, cookies, maxMembers, priority, expiresAt } =
      await req.json();

    if (!name || !accountId || !accessToken) {
      return NextResponse.json(
        { error: "名称、Account ID 和 Access Token 为必填项" },
        { status: 400 }
      );
    }

    let expiresAtValue: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== "") {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "到期时间格式无效" },
          { status: 400 }
        );
      }
      expiresAtValue = parsed;
    }

    // Check if accountId already exists
    const existing = await prisma.team.findUnique({
      where: { accountId },
    });

    if (existing) {
      return NextResponse.json(
        { error: "该 Account ID 已存在" },
        { status: 400 }
      );
    }

    // First fetch actual member count from ChatGPT API
    let currentMembers = 0;
    try {
      const membersResult = await getTeamMembersForTeam(accountId, accessToken, cookies);
      if (membersResult.success && membersResult.total !== undefined) {
        currentMembers = membersResult.total;
      } else if (membersResult.success && membersResult.members) {
        currentMembers = membersResult.members.length;
      }
    } catch (err) {
      logger.warn("Teams", "Failed to fetch team members count:", err);
      // Continue with 0, user can sync later
    }

    const team = await prisma.team.create({
      data: {
        name,
        accountId,
        accessToken,
        cookies: cookies || null,
        maxMembers: maxMembers || 0,
        currentMembers,
        expiresAt: expiresAtValue,
        priority: priority || 0,
      },
    });

    return NextResponse.json({ team });
  } catch (error) {
    logger.error("Teams", "Create team error:", error);
    return NextResponse.json(
      { error: "创建团队失败" },
      { status: 500 }
    );
  }
});

// PUT /api/admin/teams - Update a team
export const PUT = withAuth(async (req: NextRequest) => {
  try {
    const { id, name, accountId, accessToken, cookies, maxMembers, priority, isActive, expiresAt } =
      await req.json();

    if (!id) {
      return NextResponse.json({ error: "缺少团队 ID" }, { status: 400 });
    }

    let expiresAtPatch: Date | null | undefined = undefined;
    if (expiresAt !== undefined) {
      if (expiresAt === null || expiresAt === "") {
        expiresAtPatch = null;
      } else {
        const parsed = new Date(expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: "到期时间格式无效" },
            { status: 400 }
          );
        }
        expiresAtPatch = parsed;
      }
    }

    const team = await prisma.team.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(accountId !== undefined && { accountId }),
        ...(accessToken !== undefined && { accessToken }),
        ...(cookies !== undefined && { cookies }),
        ...(maxMembers !== undefined && { maxMembers }),
        ...(expiresAtPatch !== undefined && { expiresAt: expiresAtPatch }),
        ...(priority !== undefined && { priority }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({ team });
  } catch (error) {
    logger.error("Teams", "Update team error:", error);
    return NextResponse.json(
      { error: "更新团队失败" },
      { status: 500 }
    );
  }
});

// DELETE /api/admin/teams - Delete a team
export const DELETE = withAuth(async (req: NextRequest) => {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "缺少团队 ID" }, { status: 400 });
    }

    await prisma.team.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Teams", "Delete team error:", error);
    return NextResponse.json(
      { error: "删除团队失败" },
      { status: 500 }
    );
  }
});
