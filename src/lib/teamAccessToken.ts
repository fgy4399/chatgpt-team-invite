import { prisma } from "./prisma";
import { logger } from "./logger";

const CHATGPT_SESSION_ENDPOINT = "https://chatgpt.com/api/auth/session";
const ACCESS_TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 小时内视为临近过期
const ACCESS_TOKEN_REFRESH_COOLDOWN_MS = 10 * 60 * 1000; // 刷新冷却，避免频繁触发
const ACCESS_TOKEN_FALLBACK_REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000; // 无 exp 时的兜底刷新间隔

const refreshLocks = new Map<string, Promise<SessionRefreshResult>>();
const refreshAttemptAt = new Map<string, number>();
const refreshSuccessAt = new Map<string, number>();

export interface TeamTokenSource {
  id: string;
  accountId: string;
  accessToken: string;
  cookies: string | null;
}

export interface TeamCredentials {
  accountId: string;
  accessToken: string;
  cookies?: string;
}

export interface RefreshAwareResult {
  success: boolean;
  status?: number;
}

interface SessionRefreshResult {
  success: boolean;
  accessToken?: string;
  error?: string;
  status?: number;
}

function looksLikeCloudflareChallenge(body: string): boolean {
  return (
    body.includes("cf_chl") ||
    body.includes("challenge-platform") ||
    body.includes("__cf_chl") ||
    body.includes("cf-please-wait")
  );
}

function parseJwtExpMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function hasSessionTokenCookie(cookies: string): boolean {
  return /(^|;\s*)(__Secure-next-auth\.session-token|__Host-next-auth\.session-token|next-auth\.session-token)=/.test(
    cookies
  );
}

async function refreshAccessTokenWithCookies(
  cookies: string
): Promise<SessionRefreshResult> {
  try {
    const response = await fetch(CHATGPT_SESSION_ENDPOINT, {
      headers: {
        "Accept": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Origin": "https://chatgpt.com",
        "Referer": "https://chatgpt.com/",
        "Cookie": cookies,
      },
    });

    const status = response.status;
    const bodyText = await response.text();

    if (!response.ok) {
      if (looksLikeCloudflareChallenge(bodyText)) {
        return {
          success: false,
          error: "Cloudflare 验证拦截，无法刷新 Access Token",
          status,
        };
      }
      return {
        success: false,
        error: `HTTP ${status}`,
        status,
      };
    }

    if (looksLikeCloudflareChallenge(bodyText)) {
      return {
        success: false,
        error: "Cloudflare 验证拦截，无法刷新 Access Token",
        status,
      };
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return {
        success: false,
        error: "Session 响应解析失败（非 JSON）",
        status,
      };
    }

    const accessToken =
      typeof parsed.accessToken === "string" ? parsed.accessToken : undefined;

    if (!accessToken) {
      return {
        success: false,
        error: "Session 响应缺少 accessToken",
        status,
      };
    }

    return {
      success: true,
      accessToken,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "刷新 Access Token 失败",
    };
  }
}

function shouldRefreshToken(
  accessToken: string,
  nowMs: number,
  lastSuccessMs: number | undefined,
  force: boolean
): boolean {
  if (force) return true;
  const expMs = parseJwtExpMs(accessToken);
  if (expMs !== null) {
    return expMs - nowMs <= ACCESS_TOKEN_REFRESH_THRESHOLD_MS;
  }
  const last = lastSuccessMs ?? 0;
  return nowMs - last >= ACCESS_TOKEN_FALLBACK_REFRESH_INTERVAL_MS;
}

export async function ensureTeamAccessToken(
  team: TeamTokenSource,
  options?: { force?: boolean }
): Promise<{ accessToken: string; refreshed: boolean; error?: string }> {
  // 基于 exp 判断是否临近过期，必要时通过 Cookies 刷新 Access Token
  const force = Boolean(options?.force);
  if (!team.cookies) {
    return {
      accessToken: team.accessToken,
      refreshed: false,
      error: "团队未配置 Cookies，无法自动刷新 Access Token",
    };
  }
  if (!hasSessionTokenCookie(team.cookies)) {
    return {
      accessToken: team.accessToken,
      refreshed: false,
      error: "Cookies 缺少 Session Token，无法自动刷新 Access Token",
    };
  }

  const nowMs = Date.now();
  const lastSuccessMs = refreshSuccessAt.get(team.id);
  const shouldRefresh = shouldRefreshToken(
    team.accessToken,
    nowMs,
    lastSuccessMs,
    force
  );

  if (!shouldRefresh) {
    return { accessToken: team.accessToken, refreshed: false };
  }

  const lastAttemptMs = refreshAttemptAt.get(team.id) ?? 0;
  if (!force && nowMs - lastAttemptMs < ACCESS_TOKEN_REFRESH_COOLDOWN_MS) {
    return { accessToken: team.accessToken, refreshed: false };
  }

  const existing = refreshLocks.get(team.id);
  if (existing) {
    const result = await existing;
    return {
      accessToken: result.accessToken ?? team.accessToken,
      refreshed: Boolean(result.accessToken),
      error: result.success ? undefined : result.error,
    };
  }

  const task = (async () => {
    refreshAttemptAt.set(team.id, Date.now());
    const result = await refreshAccessTokenWithCookies(team.cookies ?? "");

    if (!result.success || !result.accessToken) {
      return result;
    }

    try {
      await prisma.team.update({
        where: { id: team.id },
        data: { accessToken: result.accessToken },
      });
    } catch (error) {
      logger.error("Token", "写入刷新后的 Access Token 失败:", error);
    }

    refreshSuccessAt.set(team.id, Date.now());
    return result;
  })();

  refreshLocks.set(team.id, task);
  try {
    const result = await task;
    return {
      accessToken: result.accessToken ?? team.accessToken,
      refreshed: Boolean(result.accessToken),
      error: result.success ? undefined : result.error,
    };
  } finally {
    refreshLocks.delete(team.id);
  }
}

export async function withTeamTokenRefresh<T extends RefreshAwareResult>(
  team: TeamTokenSource,
  executor: (credentials: TeamCredentials) => Promise<T>
): Promise<T> {
  // 调用前先确保 Token 新鲜，遇到 401/403 再强制刷新并重试一次
  const initial = await ensureTeamAccessToken(team);
  const credentials: TeamCredentials = {
    accountId: team.accountId,
    accessToken: initial.accessToken,
    cookies: team.cookies || undefined,
  };

  const result = await executor(credentials);
  if (!result.success && (result.status === 401 || result.status === 403)) {
    const forced = await ensureTeamAccessToken(team, { force: true });
    if (forced.accessToken !== credentials.accessToken) {
      const retryCredentials: TeamCredentials = {
        accountId: team.accountId,
        accessToken: forced.accessToken,
        cookies: team.cookies || undefined,
      };
      return executor(retryCredentials);
    }
  }

  return result;
}

export { refreshAccessTokenWithCookies };
