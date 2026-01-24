import { prisma } from "./prisma";
import { sendTeamInviteForTeam, getTeamMembersForTeam } from "./chatgpt";
import { withTeamTokenRefresh } from "./teamAccessToken";
import { InvitationStatus } from "@/generated/prisma";

export interface AvailableTeam {
  id: string;
  name: string;
  accountId: string;
  accessToken: string;
  cookies: string | null;
  maxMembers: number;
  currentMembers: number;
  availableSlots: number;
}

export interface TeamAssignmentResult {
  success: boolean;
  team?: AvailableTeam;
  error?: string;
}

export interface InviteWithTeamResult {
  success: boolean;
  teamId?: string;
  teamName?: string;
  error?: string;
}

const TEAM_MEMBER_SYNC_TTL_MS = 2 * 60 * 1000; // 2 分钟
const teamMemberSyncCache = new Map<string, number>(); // teamId -> lastSyncAt (ms)

function shouldSyncTeamMemberCount(maxMembers: number, currentMembers: number): boolean {
  if (maxMembers === 0) return false; // unlimited
  const remaining = maxMembers - currentMembers;
  // 仅在接近上限/已满时才刷新，降低 ChatGPT API 压力
  return remaining <= 1;
}

async function getReservedInviteCountMap(teamIds: string[]): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();

  const grouped = await prisma.invitation.groupBy({
    by: ["teamId"],
    where: {
      teamId: { in: teamIds },
      status: { in: [InvitationStatus.PENDING, InvitationStatus.SUCCESS] },
    },
    _count: { _all: true },
  });

  const map = new Map<string, number>();
  for (const row of grouped) {
    if (row.teamId) {
      map.set(row.teamId, row._count._all);
    }
  }
  return map;
}

export async function tryReserveTeamSeat(teamId: string, maxMembers: number): Promise<boolean> {
  if (maxMembers === 0) return true;
  const result = await prisma.team.updateMany({
    where: {
      id: teamId,
      currentMembers: { lt: maxMembers },
    },
    data: { currentMembers: { increment: 1 } },
  });
  return result.count === 1;
}

export async function releaseTeamSeat(teamId: string): Promise<void> {
  await prisma.team.updateMany({
    where: {
      id: teamId,
      maxMembers: { not: 0 },
      currentMembers: { gt: 0 },
    },
    data: { currentMembers: { decrement: 1 } },
  });
}

/**
 * Find an available team that has not reached its member limit
 * Teams are sorted by priority (lower number = higher priority)
 * 默认使用缓存的成员数，仅在接近上限时才从 ChatGPT API 刷新，降低延迟和限流风险
 */
export async function findAvailableTeam(): Promise<TeamAssignmentResult> {
  try {
    const now = new Date();
    // Get all active teams, sorted by priority
    const teams = await prisma.team.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { priority: "asc" },
    });

    if (teams.length === 0) {
      return {
        success: false,
        error: "暂无可用团队，请联系管理员",
      };
    }

    const cookieTeams = teams.filter((team) => Boolean(team.cookies));
    if (cookieTeams.length === 0) {
      return {
        success: false,
        error: "团队未配置 Cookies，无法自动刷新 Access Token",
      };
    }

    const reservedInviteCountMap = await getReservedInviteCountMap(
      cookieTeams.map((team) => team.id)
    );

    // Find the first team that has available slots
    for (const team of cookieTeams) {
      // 双保险：防止到期团队被选中
      if (team.expiresAt && now > team.expiresAt) {
        continue;
      }

      // If maxMembers is 0, it means unlimited
      if (team.maxMembers === 0) {
        return {
          success: true,
          team: {
            id: team.id,
            name: team.name,
            accountId: team.accountId,
            accessToken: team.accessToken,
            cookies: team.cookies,
            maxMembers: team.maxMembers,
            currentMembers: team.currentMembers,
            availableSlots: -1, // unlimited
          },
        };
      }

      // DB 自愈：currentMembers 不能低于“已占位的邀请数”，否则并发下会超发
      const reservedInvites = reservedInviteCountMap.get(team.id) || 0;
      if (reservedInvites > team.currentMembers) {
        await prisma.team.update({
          where: { id: team.id },
          data: { currentMembers: reservedInvites },
        });
        team.currentMembers = reservedInvites;
      }

      // 接近上限时，按 TTL 刷新该团队的真实成员数，避免超发
      if (shouldSyncTeamMemberCount(team.maxMembers, team.currentMembers)) {
        const lastSyncAt = teamMemberSyncCache.get(team.id) || 0;
        const nowMs = Date.now();
        if (nowMs - lastSyncAt > TEAM_MEMBER_SYNC_TTL_MS) {
          try {
            const result = await withTeamTokenRefresh(team, (credentials) =>
              getTeamMembersForTeam(
                credentials.accountId,
                credentials.accessToken,
                credentials.cookies
              )
            );

            const actualCount =
              result.success && result.total !== undefined
                ? result.total
                : result.success && result.members
                  ? result.members.length
                  : team.currentMembers;

            teamMemberSyncCache.set(team.id, nowMs);

            // 只允许向上修正，避免把“已占位”的数量刷回去导致超发
            if (actualCount > team.currentMembers) {
              await prisma.team.update({
                where: { id: team.id },
                data: { currentMembers: actualCount },
              });
              team.currentMembers = actualCount;
            }
          } catch (err) {
            console.error(`Failed to sync team ${team.name} members:`, err);
            // Continue with cached count if sync fails
          }
        }
      }

      // Check if team has available slots
      if (team.currentMembers < team.maxMembers) {
        const reserved = await tryReserveTeamSeat(team.id, team.maxMembers);
        if (!reserved) {
          continue;
        }
        const nextCount = team.currentMembers + 1;
        return {
          success: true,
          team: {
            id: team.id,
            name: team.name,
            accountId: team.accountId,
            accessToken: team.accessToken,
            cookies: team.cookies,
            maxMembers: team.maxMembers,
            currentMembers: nextCount,
            availableSlots: team.maxMembers - nextCount,
          },
        };
      }
    }

    // All teams are full
    return {
      success: false,
      error: "所有团队名额已满，暂时无法接受新成员",
    };
  } catch (error) {
    console.error("Find available team error:", error);
    return {
      success: false,
      error: "查找可用团队时出错",
    };
  }
}

/**
 * Send an invite using automatic team assignment
 */
export async function sendInviteWithAutoTeam(
  email: string
): Promise<InviteWithTeamResult> {
  // Find an available team
  const teamResult = await findAvailableTeam();

  if (!teamResult.success || !teamResult.team) {
    return {
      success: false,
      error: teamResult.error,
    };
  }

  const team = teamResult.team;

  // Send the invite using this team's credentials
  const inviteResult = await withTeamTokenRefresh(team, (credentials) =>
    sendTeamInviteForTeam(email, {
      accountId: credentials.accountId,
      accessToken: credentials.accessToken,
      cookies: credentials.cookies,
    })
  );

  if (!inviteResult.success) {
    await releaseTeamSeat(team.id);
    return {
      success: false,
      error: inviteResult.error,
    };
  }

  return {
    success: true,
    teamId: team.id,
    teamName: team.name,
  };
}

/**
 * Sync member counts for all active teams from ChatGPT API
 */
export async function syncAllTeamMemberCounts(): Promise<void> {
  const now = new Date();
  const teams = await prisma.team.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  const reservedInviteCountMap = await getReservedInviteCountMap(
    teams.map((team) => team.id)
  );

  for (const team of teams) {
    try {
      if (!team.cookies) {
        continue;
      }

      const result = await withTeamTokenRefresh(team, (credentials) =>
        getTeamMembersForTeam(
          credentials.accountId,
          credentials.accessToken,
          credentials.cookies
        )
      );

      if (result.success && result.total !== undefined) {
        const reservedInvites = reservedInviteCountMap.get(team.id) || 0;
        const nextCount = Math.max(team.currentMembers, reservedInvites, result.total);
        await prisma.team.update({
          where: { id: team.id },
          data: { currentMembers: nextCount },
        });
        teamMemberSyncCache.set(team.id, Date.now());
      }
    } catch (error) {
      console.error(`Failed to sync team ${team.name}:`, error);
    }
  }
}

/**
 * Get summary of all teams' capacity
 */
export async function getTeamsCapacitySummary(): Promise<{
  totalTeams: number;
  activeTeams: number;
  totalCapacity: number;
  totalUsed: number;
  hasAvailableSlots: boolean;
}> {
  const now = new Date();
  const teams = await prisma.team.findMany({
    where: {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  let totalCapacity = 0;
  let totalUsed = 0;
  let hasUnlimited = false;

  for (const team of teams) {
    if (team.maxMembers === 0) {
      hasUnlimited = true;
    } else {
      totalCapacity += team.maxMembers;
    }
    totalUsed += team.currentMembers;
  }

  const allTeamsCount = await prisma.team.count();

  return {
    totalTeams: allTeamsCount,
    activeTeams: teams.length,
    totalCapacity: hasUnlimited ? -1 : totalCapacity,
    totalUsed,
    hasAvailableSlots: hasUnlimited || totalUsed < totalCapacity,
  };
}
