import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { updateTeamMemberRoleForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";

export const runtime = "nodejs";

type DemoteMembersRequest = {
  memberIds: string[];
  role: "account-admin" | "standard-user";
};

type DemoteMemberResult = {
  memberId: string;
  success: boolean;
  error?: string;
  requiresCookies?: boolean;
  status?: number;
};

type DemoteBatchResult = {
  success: boolean;
  status?: number;
  error?: string;
  items: DemoteMemberResult[];
};

// 简单并发控制，避免触发上游限流
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      results.push(await handler(next));
    }
  });
  await Promise.all(runners);
  return results;
}

// POST /api/admin/teams/[id]/members/demote - 批量降级团队成员角色
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

    const body = (await req.json().catch(() => ({}))) as Partial<DemoteMembersRequest>;
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    const role = body.role;

    if (memberIds.length === 0) {
      return NextResponse.json({ error: "缺少成员 ID 列表" }, { status: 400 });
    }

    if (role !== "account-admin" && role !== "standard-user") {
      return NextResponse.json({ error: "不支持的角色" }, { status: 400 });
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

    const batch = await withTeamTokenRefresh<DemoteBatchResult>(
      team,
      async (credentials) => {
        const items = await mapWithConcurrency(memberIds, 3, async (memberId) => {
        const result = await updateTeamMemberRoleForTeam(
          credentials.accountId,
          credentials.accessToken,
          memberId,
          role,
          credentials.cookies
        );

        const item: DemoteMemberResult = {
          memberId,
          success: result.success,
          error: result.error,
          requiresCookies: result.requiresCookies,
          status: result.status,
        };
        return item;
        });

        const hasSuccess = items.some((item) => item.success);
        const retryableStatus = items.find(
          (item) => item.status === 401 || item.status === 403
        )?.status;

        return {
          success: hasSuccess,
          status: hasSuccess ? undefined : retryableStatus,
          error: hasSuccess ? undefined : items[0]?.error,
          items,
        };
      }
    );
    const updatedIds = batch.items
      .filter((item) => item.success)
      .map((item) => item.memberId);
    const failed = batch.items.filter((item) => !item.success);

    const responseBody = {
      success: true,
      role,
      updatedIds,
      updatedCount: updatedIds.length,
      failed,
    };

    if (updatedIds.length === 0) {
      return NextResponse.json(
        { ...responseBody, error: failed[0]?.error || "全部降级失败" },
        { status: 502 }
      );
    }

    return NextResponse.json(responseBody);
  } catch (error) {
    logger.error("Teams", "Demote members error:", error);
    return NextResponse.json(
      { error: "批量降级失败" },
      { status: 500 }
    );
  }
}
