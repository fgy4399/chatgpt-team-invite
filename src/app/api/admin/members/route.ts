import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import { getTeamMembers } from "@/lib/chatgpt";

export const runtime = "nodejs";

// GET /api/admin/members - Get team members list
export const GET = withAuth(async () => {
  try {
    // Get team members from ChatGPT API
    const result = await getTeamMembers();

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "获取成员列表失败" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      members: result.members,
      total: result.total,
    });
  } catch (error) {
    console.error("Get members error:", error);
    return NextResponse.json(
      { error: "获取成员列表失败" },
      { status: 500 }
    );
  }
});
