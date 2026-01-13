import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTeamInvite, sendTeamInviteForTeam } from "@/lib/chatgpt";
import { isValidCodeFormat, isValidEmail } from "@/lib/utils";
import { findAvailableTeam } from "@/lib/teamAssignment";
import { checkRateLimit, getClientIdentifier } from "@/lib/rateLimit";
import { InviteCodeStatus, InvitationStatus, Prisma } from "@/generated/prisma";

export const runtime = "nodejs";

// POST /api/invite/submit - Submit an invitation request
export async function POST(req: NextRequest) {
  try {
    // 速率限制检查
    const clientId = getClientIdentifier(req);
    const rateLimitResult = checkRateLimit(clientId, "invite-submit");
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { success: false, message: "请求过于频繁，请稍后再试" },
        {
          status: 429,
          headers: {
            "X-RateLimit-Remaining": rateLimitResult.remaining.toString(),
            "X-RateLimit-Reset": rateLimitResult.resetTime.toString(),
          },
        }
      );
    }

    const { code, email } = await req.json();

    // Validate input
    if (!code || !isValidCodeFormat(code)) {
      return NextResponse.json(
        { success: false, message: "邀请码格式无效" },
        { status: 400 }
      );
    }

    if (!email || !isValidEmail(email)) {
      return NextResponse.json(
        { success: false, message: "邮箱格式无效" },
        { status: 400 }
      );
    }

    // Find and validate the code
    const inviteCode = await prisma.inviteCode.findUnique({
      where: { code },
      include: { invitation: true },
    });

    if (!inviteCode) {
      return NextResponse.json(
        { success: false, message: "邀请码不存在" },
        { status: 404 }
      );
    }

    if (inviteCode.expiresAt && new Date() > inviteCode.expiresAt) {
      await prisma.inviteCode.update({
        where: { id: inviteCode.id },
        data: { status: InviteCodeStatus.EXPIRED },
      });
      return NextResponse.json(
        { success: false, message: "该邀请码已过期" },
        { status: 400 }
      );
    }

    if (inviteCode.status !== InviteCodeStatus.PENDING) {
      const statusMessages: Partial<Record<InviteCodeStatus, string>> = {
        [InviteCodeStatus.USED]: "该邀请码已被使用",
        [InviteCodeStatus.EXPIRED]: "该邀请码已过期",
        [InviteCodeStatus.REVOKED]: "该邀请码已被撤销",
      };
      return NextResponse.json(
        {
          success: false,
          message: statusMessages[inviteCode.status] || "该邀请码已失效",
          invitationId: inviteCode.invitation?.id,
        },
        { status: 400 }
      );
    }

    // 单个邀请码只允许绑定一个邮箱，避免被他人重复使用
    let invitation = inviteCode.invitation;
    if (invitation) {
      if (invitation.email !== email) {
        return NextResponse.json(
          { success: false, message: "该邀请码已绑定其他邮箱，请确认后重试" },
          { status: 400 }
        );
      }

      if (invitation.status === InvitationStatus.PENDING) {
        return NextResponse.json({
          success: true,
          invitationId: invitation.id,
          message: "请求已提交，正在处理中，请稍后查看状态",
        });
      }

      // 失败/成功都直接返回状态页（成功状态会在 status API 中显示）
      if (invitation.status === InvitationStatus.SUCCESS) {
        return NextResponse.json({
          success: true,
          invitationId: invitation.id,
          message: "邀请已发送成功！请检查您的邮箱。",
        });
      }

      // FAILED: 允许重试（邀请码不消耗），先标记为处理中，避免并发重复发送
      invitation = await prisma.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.PENDING,
          errorMessage: null,
          processedAt: null,
        },
      });
    } else {
      // 首次使用：创建邀请记录作为“锁”，防止并发重复提交
      try {
        invitation = await prisma.invitation.create({
          data: {
            email,
            inviteCodeId: inviteCode.id,
            status: InvitationStatus.PENDING,
          },
        });
      } catch {
        // 可能是并发请求导致的唯一约束冲突，读取已存在的记录即可
        const existing = await prisma.invitation.findUnique({
          where: { inviteCodeId: inviteCode.id },
        });

        if (!existing) {
          throw new Error("创建邀请记录失败");
        }

        if (existing.email !== email) {
          return NextResponse.json(
            { success: false, message: "该邀请码已绑定其他邮箱，请确认后重试" },
            { status: 400 }
          );
        }

        if (existing.status === InvitationStatus.PENDING) {
          return NextResponse.json({
            success: true,
            invitationId: existing.id,
            message: "请求已提交，正在处理中，请稍后查看状态",
          });
        }

        invitation = await prisma.invitation.update({
          where: { id: existing.id },
          data: {
            status: InvitationStatus.PENDING,
            errorMessage: null,
            processedAt: null,
          },
        });
      }
    }

    // Check if we have teams configured in the database
    const teamsCount = await prisma.team.count({ where: { isActive: true } });

    let teamId: string | null = null;
    let inviteResult: { success: boolean; error?: string };

    if (teamsCount > 0) {
      // Use multi-team mode: find an available team
      const teamResult = await findAvailableTeam();

      if (!teamResult.success || !teamResult.team) {
        const errorMessage = teamResult.error || "暂无可用团队名额";
        await prisma.invitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.FAILED,
            errorMessage,
            processedAt: new Date(),
          },
        });
        return NextResponse.json(
          { success: false, invitationId: invitation.id, message: errorMessage },
          { status: 503 }
        );
      }

      const team = teamResult.team;
      teamId = team.id;

      // Send invite using this team's credentials
      inviteResult = await sendTeamInviteForTeam(email, {
        accountId: team.accountId,
        accessToken: team.accessToken,
        cookies: team.cookies || undefined,
      });

      // If successful, update team member count
    } else {
      // Fallback to legacy mode using environment variables
      inviteResult = await sendTeamInvite(email);
    }

    const processedAt = new Date();

    if (inviteResult.success) {
      const transactionOps: Prisma.PrismaPromise<unknown>[] = [
        prisma.invitation.update({
          where: { id: invitation.id },
          data: {
            status: InvitationStatus.SUCCESS,
            errorMessage: null,
            processedAt,
            teamId,
          },
        }),
        prisma.inviteCode.update({
          where: { id: inviteCode.id },
          data: { status: InviteCodeStatus.USED, usedAt: processedAt },
        }),
      ];

      // 成功才消耗邀请码并更新团队成员数
      if (teamId) {
        transactionOps.push(
          prisma.team.update({
            where: { id: teamId },
            data: { currentMembers: { increment: 1 } },
          })
        );
      }

      await prisma.$transaction(transactionOps);

      return NextResponse.json({
        success: true,
        invitationId: invitation.id,
        message: "邀请已发送成功！请检查您的邮箱。",
      });
    } else {
      // 失败不消耗邀请码：保留 PENDING 状态，允许用户稍后重试（同一邀请码仅限同一邮箱）
      await prisma.invitation.update({
        where: { id: invitation.id },
        data: {
          status: InvitationStatus.FAILED,
          errorMessage: inviteResult.error,
          processedAt,
          teamId,
        },
      });

      return NextResponse.json({
        success: false,
        invitationId: invitation.id,
        message: inviteResult.error || "发送邀请失败，请稍后重试（邀请码未被消耗）",
      });
    }
  } catch (error) {
    console.error("Submit invitation error:", error);
    return NextResponse.json(
      { success: false, message: "处理邀请时出错" },
      { status: 500 }
    );
  }
}
