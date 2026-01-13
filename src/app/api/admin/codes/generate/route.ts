import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth, JWTPayload } from "@/lib/auth";
import { generateInviteCode } from "@/lib/utils";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// POST /api/admin/codes/generate - Generate invite codes
export const POST = withAuth(async (req: NextRequest, payload: JWTPayload) => {
  try {
    const { count = 1, expiresInDays, note } = await req.json();

    if (count < 1 || count > 100) {
      return NextResponse.json(
        { error: "生成数量必须在 1-100 之间" },
        { status: 400 }
      );
    }

    const codes = [];
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    for (let i = 0; i < count; i++) {
      const code = generateInviteCode();
      const inviteCode = await prisma.inviteCode.create({
        data: {
          code,
          note,
          expiresAt,
          createdById: payload.adminId,
        },
      });
      codes.push({
        id: inviteCode.id,
        code: inviteCode.code,
        expiresAt: inviteCode.expiresAt,
      });
    }

    return NextResponse.json({ codes, count: codes.length });
  } catch (error) {
    logger.error("Codes", "Generate codes error:", error);
    return NextResponse.json(
      { error: "生成邀请码失败" },
      { status: 500 }
    );
  }
});
