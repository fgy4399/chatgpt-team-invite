import { prisma } from "./prisma";
import { sendTeamInviteForTeam, getTeamMembersForTeam } from "./chatgpt";

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

    // Find the first team that has available slots
    for (const team of teams) {
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

      // 接近上限时，按 TTL 刷新该团队的真实成员数，避免超发
      if (shouldSyncTeamMemberCount(team.maxMembers, team.currentMembers)) {
        const lastSyncAt = teamMemberSyncCache.get(team.id) || 0;
        const nowMs = Date.now();
        if (nowMs - lastSyncAt > TEAM_MEMBER_SYNC_TTL_MS) {
          try {
            const result = await getTeamMembersForTeam(
              team.accountId,
              team.accessToken,
              team.cookies || undefined
            );

            const actualCount =
              result.success && result.total !== undefined
                ? result.total
                : result.success && result.members
                  ? result.members.length
                  : team.currentMembers;

            teamMemberSyncCache.set(team.id, nowMs);

            if (actualCount !== team.currentMembers) {
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
            availableSlots: team.maxMembers - team.currentMembers,
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
  const inviteResult = await sendTeamInviteForTeam(email, {
    accountId: team.accountId,
    accessToken: team.accessToken,
    cookies: team.cookies || undefined,
  });

  if (!inviteResult.success) {
    return {
      success: false,
      error: inviteResult.error,
    };
  }

  // Update team member count (increment by 1)
  await prisma.team.update({
    where: { id: team.id },
    data: { currentMembers: { increment: 1 } },
  });

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

  for (const team of teams) {
    try {
      const result = await getTeamMembersForTeam(
        team.accountId,
        team.accessToken,
        team.cookies || undefined
      );

      if (result.success && result.total !== undefined) {
        await prisma.team.update({
          where: { id: team.id },
          data: { currentMembers: result.total },
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
