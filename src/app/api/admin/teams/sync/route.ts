import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { getTeamMembersForTeam } from "@/lib/chatgpt";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const currentIndex = index++;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await mapper(items[currentIndex]);
      }
    }
  );

  await Promise.all(workers);
  return results;
}

// POST /api/admin/teams/sync - Sync team member counts from ChatGPT API
export const POST = withAuth(async () => {
  try {
    // Get all active teams
    const teams = await prisma.team.findMany({
      where: { isActive: true },
    });

    // 限制并发，避免触发 ChatGPT API 限流
    const results = await mapWithConcurrency(teams, 3, async (team) => {
        try {
          const membersResult = await getTeamMembersForTeam(
            team.accountId,
            team.accessToken,
            team.cookies || undefined
          );

          if (membersResult.success && membersResult.total !== undefined) {
            await prisma.team.update({
              where: { id: team.id },
              data: { currentMembers: membersResult.total },
            });
            return {
              teamId: team.id,
              name: team.name,
              currentMembers: membersResult.total,
              synced: true,
            };
          } else {
            return {
              teamId: team.id,
              name: team.name,
              error: membersResult.error,
              synced: false,
            };
          }
        } catch (error) {
          return {
            teamId: team.id,
            name: team.name,
            error: error instanceof Error ? error.message : "未知错误",
            synced: false,
          };
        }
    });

    return NextResponse.json({ results });
  } catch (error) {
    logger.error("Teams", "Sync teams error:", error);
    return NextResponse.json(
      { error: "同步团队成员数失败" },
      { status: 500 }
    );
  }
});
