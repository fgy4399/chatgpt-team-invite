import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { InvitationStatus } from "@/generated/prisma";

export const runtime = "nodejs";

// GET /api/invite/status/[id] - Check invitation status
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      select: {
        status: true,
        email: true,
        errorMessage: true,
        createdAt: true,
        processedAt: true,
      },
    });

    if (!invitation) {
      return NextResponse.json(
        { error: "未找到邀请记录" },
        { status: 404 }
      );
    }

    // Mask email for privacy
    const emailParts = invitation.email.split("@");
    const maskedEmail =
      emailParts[0].slice(0, 2) +
      "***@" +
      emailParts[1];

    return NextResponse.json({
      status: invitation.status,
      email: maskedEmail,
      createdAt: invitation.createdAt,
      processedAt: invitation.processedAt,
      message:
        invitation.status === InvitationStatus.SUCCESS
          ? "邀请邮件已发送，请检查邮箱并接受邀请后加入团队。"
          : invitation.status === InvitationStatus.FAILED
          ? invitation.errorMessage || "发送邀请失败，请稍后重试"
          : "处理中...",
    });
  } catch (error) {
    console.error("Check status error:", error);
    return NextResponse.json(
      { error: "查询状态失败，请稍后重试" },
      { status: 500 }
    );
  }
}
