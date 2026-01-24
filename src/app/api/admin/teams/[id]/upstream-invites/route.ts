import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTokenFromRequest, verifyToken } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { withTeamTokenRefresh } from "@/lib/teamAccessToken";
import { cancelTeamInvitesForTeam, listTeamInvitesForTeam } from "@/lib/chatgpt";

export const runtime = "nodejs";

function parseNumberParam(
  value: string | null,
  fallback: number,
  options?: { min?: number; max?: number }
): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  const min = options?.min ?? -Infinity;
  const max = options?.max ?? Infinity;
  return Math.min(max, Math.max(min, parsed));
}

// GET /api/admin/teams/[id]/upstream-invites - 获取 ChatGPT 上游 pending invites 列表
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

    const offset = parseNumberParam(req.nextUrl.searchParams.get("offset"), 0, {
      min: 0,
    });
    const limit = parseNumberParam(req.nextUrl.searchParams.get("limit"), 25, {
      min: 1,
      max: 100,
    });
    const query = req.nextUrl.searchParams.get("query") ?? "";

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

    const result = await withTeamTokenRefresh(team, (credentials) =>
      listTeamInvitesForTeam(
        credentials.accountId,
        credentials.accessToken,
        credentials.cookies,
        { offset, limit, query }
      )
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取上游邀请失败" },
        { status: result.status ?? 502 }
      );
    }

    return NextResponse.json({
      teamId: team.id,
      teamName: team.name,
      invites: result.invites || [],
      total: result.total ?? (result.invites ? result.invites.length : 0),
      offset: result.offset ?? offset,
      limit: result.limit ?? limit,
    });
  } catch (error) {
    logger.error("Teams", "Get upstream invites error:", error);
    return NextResponse.json(
      { error: "获取上游邀请失败" },
      { status: 500 }
    );
  }
}

// POST /api/admin/teams/[id]/upstream-invites - 取消指定的上游 pending invite
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

    const body = (await req.json().catch(() => ({}))) as Partial<{
      action: string;
      inviteIds: string[];
      inviteEmails: string[];
      emails: string[];
    }>;

    if (body.action && body.action !== "cancel") {
      return NextResponse.json({ error: "不支持的 action" }, { status: 400 });
    }

    const inviteIds = Array.isArray(body.inviteIds)
      ? body.inviteIds.map((v) => String(v)).filter(Boolean)
      : [];
    const inviteEmails = Array.isArray(body.inviteEmails)
      ? body.inviteEmails.map((v) => String(v)).filter(Boolean)
      : [];
    const emails = Array.isArray(body.emails)
      ? body.emails.map((v) => String(v)).filter(Boolean)
      : [];

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

    let targetEmails = emails.length > 0 ? emails : inviteEmails;
    if (targetEmails.length === 0 && inviteIds.length > 0) {
      // 兼容旧前端：只传了 inviteIds（UUID）。上游删除接口实际需要 email_address，
      // 这里通过上游 invites 列表把 id 映射回 email。
      const missing = new Set(inviteIds);
      const mappedEmails: string[] = [];

      const limit = 100;
      let offset = 0;
      for (let i = 0; i < 10 && missing.size > 0; i++) {
        const page = await withTeamTokenRefresh(team, (credentials) =>
          listTeamInvitesForTeam(
            credentials.accountId,
            credentials.accessToken,
            credentials.cookies,
            { offset, limit, query: "" }
          )
        );

        if (!page.success) {
          return NextResponse.json(
            { error: page.error || "获取上游邀请失败" },
            { status: page.status ?? 502 }
          );
        }

        const items = page.invites || [];
        for (const item of items) {
          if (missing.has(item.id)) {
            mappedEmails.push(item.email);
            missing.delete(item.id);
          }
        }

        if (items.length < limit) break;
        offset += limit;
      }

      if (missing.size > 0) {
        return NextResponse.json(
          {
            error:
              "部分上游邀请未找到（可能已被取消/列表变化），请刷新后再试",
          },
          { status: 400 }
        );
      }

      targetEmails = mappedEmails;
    }

    if (targetEmails.length === 0) {
      return NextResponse.json(
        { error: "缺少 inviteEmails" },
        { status: 400 }
      );
    }

    const result = await withTeamTokenRefresh(team, (credentials) =>
      cancelTeamInvitesForTeam(
        credentials.accountId,
        credentials.accessToken,
        targetEmails,
        credentials.cookies
      )
    );

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "取消上游邀请失败" },
        { status: result.status ?? 502 }
      );
    }

    return NextResponse.json({
      success: true,
      cancelledCount: targetEmails.length,
      teamId: team.id,
      teamName: team.name,
    });
  } catch (error) {
    logger.error("Teams", "Cancel upstream invite error:", error);
    return NextResponse.json(
      { error: "取消上游邀请失败" },
      { status: 500 }
    );
  }
}
