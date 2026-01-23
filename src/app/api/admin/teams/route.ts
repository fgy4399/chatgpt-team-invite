import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { getTeamMembersForTeam, getTeamSubscriptionForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";
import { hasSessionTokenCookie, refreshAccessTokenWithCookies } from "@/lib/teamAccessToken";

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
    const { name, accountId, accessToken, cookies, maxMembers, priority } =
      (await req.json()) as {
        name?: string;
        accountId?: string;
        accessToken?: string;
        cookies?: string;
        maxMembers?: number;
        priority?: number;
      };

    if (!name || !accountId || !accessToken) {
      return NextResponse.json(
        { error: "名称、Account ID 和 Access Token 为必填项" },
        { status: 400 }
      );
    }

    // 强制要求 Cookies，用于自动刷新 Access Token
    const normalizedCookies = typeof cookies === "string" ? cookies.trim() : "";
    if (!normalizedCookies) {
      return NextResponse.json(
        { error: "Cookies 为必填项，用于自动刷新 Access Token" },
        { status: 400 }
      );
    }

    if (!hasSessionTokenCookie(normalizedCookies)) {
      return NextResponse.json(
        { error: "Cookies 缺少 Session Token（__Secure-next-auth.session-token）" },
        { status: 400 }
      );
    }

    let normalizedAccessToken = accessToken.trim();
    if (!normalizedAccessToken) {
      return NextResponse.json(
        { error: "Access Token 不能为空" },
        { status: 400 }
      );
    }

    let expiresAtValue: Date | null = null;
    let subscriptionResult = await getTeamSubscriptionForTeam(
      accountId,
      normalizedAccessToken,
      normalizedCookies
    );

    if (!subscriptionResult.success && (subscriptionResult.status === 401 || subscriptionResult.status === 403)) {
      const refreshed = await refreshAccessTokenWithCookies(normalizedCookies);
      if (refreshed.success && refreshed.accessToken) {
        normalizedAccessToken = refreshed.accessToken;
        subscriptionResult = await getTeamSubscriptionForTeam(
          accountId,
          normalizedAccessToken,
          normalizedCookies
        );
      }
    }

    if (!subscriptionResult.success || !subscriptionResult.subscription) {
      return NextResponse.json(
        {
          error:
            subscriptionResult.error ||
            "无法自动获取到期时间，请检查凭据或配置 Cookies",
        },
        { status: 400 }
      );
    }

    const subscription = subscriptionResult.subscription;
    if (subscription.plan_type && subscription.plan_type !== "team") {
      return NextResponse.json(
        {
          error: `该 Account ID 不是 Team 工作区（plan_type=${subscription.plan_type}），请使用 Team 的 Account ID`,
        },
        { status: 400 }
      );
    }

    const expiresIso =
      typeof subscription.active_until === "string" && subscription.active_until
        ? subscription.active_until
        : null;

    if (!expiresIso) {
      return NextResponse.json(
        { error: "未获取到订阅到期时间字段（active_until），请检查凭据或配置 Cookies" },
        { status: 400 }
      );
    }

    const expiresParsed = new Date(expiresIso);
    if (Number.isNaN(expiresParsed.getTime())) {
      return NextResponse.json(
        { error: "订阅到期时间解析失败，请重试" },
        { status: 400 }
      );
    }

    if (expiresParsed.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "该账号订阅已到期，无法添加为可用团队" },
        { status: 400 }
      );
    }
    expiresAtValue = expiresParsed;

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
      const membersResult = await getTeamMembersForTeam(
        accountId,
        normalizedAccessToken,
        normalizedCookies
      );
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
        accessToken: normalizedAccessToken,
        cookies: normalizedCookies,
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

    // 更新时若传入 Cookies，也必须包含 Session Token
    let cookiesPatch: string | undefined;
    if (cookies !== undefined) {
      const normalized = typeof cookies === "string" ? cookies.trim() : "";
      if (!normalized) {
        return NextResponse.json(
          { error: "Cookies 不能为空，请提供可用于自动刷新的完整 Cookies" },
          { status: 400 }
        );
      }
      if (!hasSessionTokenCookie(normalized)) {
        return NextResponse.json(
          { error: "Cookies 缺少 Session Token（__Secure-next-auth.session-token）" },
          { status: 400 }
        );
      }
      cookiesPatch = normalized;
    }

    let accessTokenPatch: string | undefined;
    if (accessToken !== undefined) {
      const normalized = typeof accessToken === "string" ? accessToken.trim() : "";
      if (!normalized) {
        return NextResponse.json(
          { error: "Access Token 不能为空" },
          { status: 400 }
        );
      }
      accessTokenPatch = normalized;
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
        ...(accessTokenPatch !== undefined && { accessToken: accessTokenPatch }),
        ...(cookiesPatch !== undefined && { cookies: cookiesPatch }),
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
