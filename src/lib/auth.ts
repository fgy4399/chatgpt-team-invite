import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { NextRequest, NextResponse } from "next/server";

const SALT_ROUNDS = 12;

export interface JWTPayload {
  adminId: string;
  username: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET 未配置，请在环境变量中设置 JWT_SECRET");
  }
  return secret;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(adminId: string, username: string): string {
  return jwt.sign({ adminId, username }, getJwtSecret(), { expiresIn: "24h" });
}

export function verifyToken(token: string): JWTPayload | null {
  const secret = getJwtSecret();
  try {
    return jwt.verify(token, secret) as JWTPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export function withAuth(
  handler: (
    req: NextRequest,
    payload: JWTPayload
  ) => Promise<NextResponse>
): (req: NextRequest) => Promise<NextResponse> {
  return async (req: NextRequest) => {
    const token = getTokenFromRequest(req);

    if (!token) {
      return NextResponse.json({ error: "未授权" }, { status: 401 });
    }

    const payload = verifyToken(token);

    if (!payload) {
      return NextResponse.json({ error: "登录已失效，请重新登录" }, { status: 401 });
    }

    return handler(req, payload);
  };
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ error: "未授权" }, { status: 401 });
}
