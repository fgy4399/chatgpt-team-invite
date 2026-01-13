import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidCodeFormat } from "@/lib/utils";
import { InviteCodeStatus } from "@/generated/prisma";

export const runtime = "nodejs";

// POST /api/invite/validate - Validate an invite code
export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

    if (!code || !isValidCodeFormat(code)) {
      return NextResponse.json(
        { valid: false, message: "邀请码格式无效" },
        { status: 400 }
      );
    }

    const inviteCode = await prisma.inviteCode.findUnique({
      where: { code },
    });

    if (!inviteCode) {
      return NextResponse.json(
        { valid: false, message: "邀请码不存在" },
        { status: 404 }
      );
    }

    if (inviteCode.status !== InviteCodeStatus.PENDING) {
      const statusMessages: Partial<Record<InviteCodeStatus, string>> = {
        [InviteCodeStatus.USED]: "该邀请码已被使用",
        [InviteCodeStatus.EXPIRED]: "该邀请码已过期",
        [InviteCodeStatus.REVOKED]: "该邀请码已被撤销",
      };
      return NextResponse.json(
        { valid: false, message: statusMessages[inviteCode.status] || "该邀请码已失效" },
        { status: 400 }
      );
    }

    if (inviteCode.expiresAt && new Date() > inviteCode.expiresAt) {
      await prisma.inviteCode.update({
        where: { id: inviteCode.id },
        data: { status: InviteCodeStatus.EXPIRED },
      });
      return NextResponse.json(
        { valid: false, message: "该邀请码已过期" },
        { status: 400 }
      );
    }

    return NextResponse.json({ valid: true });
  } catch (error) {
    console.error("Validate code error:", error);
    return NextResponse.json(
      { valid: false, message: "验证失败，请稍后重试" },
      { status: 500 }
    );
  }
}
