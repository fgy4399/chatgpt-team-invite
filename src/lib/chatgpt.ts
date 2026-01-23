import { logger } from "./logger";

const CHATGPT_API_BASE = "https://chatgpt.com/backend-api";

interface InviteResult {
  success: boolean;
  error?: string;
  status?: number;
  data?: unknown;
}

interface SubscriptionInfo {
  id?: string;
  seats_available?: number;
  seats_entitled?: number;
  seats_in_use?: number;
  seats_used?: number;
  active_start?: string;
  active_until?: string;
  plan_type?: string;
  billing_period?: string;
  will_renew?: boolean;
  billing_currency?: string;
  is_delinquent?: boolean;
  [key: string]: unknown;
}

interface TeamSubscriptionResult {
  success: boolean;
  subscription?: SubscriptionInfo;
  error?: string;
  requiresCookies?: boolean;
  status?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

interface TeamMembersResult {
  success: boolean;
  members?: TeamMember[];
  total?: number;
  error?: string;
  status?: number;
}

interface TeamMemberKickResult {
  success: boolean;
  error?: string;
  requiresCookies?: boolean;
  status?: number;
}

interface TeamCredentials {
  accountId: string;
  accessToken: string;
  cookies?: string;
}

function looksLikeCloudflareChallenge(body: string): boolean {
  return (
    body.includes("cf_chl") ||
    body.includes("challenge-platform") ||
    body.includes("__cf_chl") ||
    body.includes("cf-please-wait")
  );
}

function getHeaders(credentials: TeamCredentials): Record<string, string> {
  const token = credentials.accessToken;
  const cookies = credentials.cookies;
  const accountId = credentials.accountId;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Origin": "https://chatgpt.com",
    "Referer": "https://chatgpt.com/",
    "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"macOS"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  // Add chatgpt-account-id header (required by ChatGPT API)
  if (accountId) {
    headers["chatgpt-account-id"] = accountId;
  }

  // Add cookies if provided
  if (cookies) {
    headers["Cookie"] = cookies;
  }

  return headers;
}

// Send invite using specific team credentials
export async function sendTeamInviteForTeam(
  email: string,
  credentials: TeamCredentials
): Promise<InviteResult> {
  logger.info("ChatGPT", `Sending invite to: ${email.replace(/(.{2}).*(@.*)/, "$1***$2")}`);

  if (!credentials.accessToken || !credentials.accountId) {
    return {
      success: false,
      error: "缺少 Access Token 或 Account ID",
    };
  }

  try {
    const url = `${CHATGPT_API_BASE}/accounts/${credentials.accountId}/invites`;

    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(credentials),
      body: JSON.stringify({
        email_addresses: [email],
        role: "standard-user",
        resend_emails: true,
      }),
    });

    logger.debug("ChatGPT", `Response status: ${response.status}`);
    const status = response.status;

    const responseText = await response.text();
    logger.debug("ChatGPT", `Response body: ${responseText.slice(0, 200)}`);

    if (!response.ok) {
      // Check if it's a Cloudflare challenge
      if (responseText.includes("cf_chl") || responseText.includes("challenge-platform")) {
        return {
          success: false,
          error: "Cloudflare 验证拦截。请配置团队的 Cookies",
          status,
        };
      }

      let errorMessage = `HTTP ${response.status}`;

      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.detail || errorJson.message || errorMessage;
      } catch {
        errorMessage = responseText.slice(0, 200) || errorMessage;
      }

      return { success: false, error: errorMessage, status };
    }

    // Parse response
    try {
      const data = JSON.parse(responseText);
      logger.info("ChatGPT", "Invite sent successfully");
      return { success: true, data, status };
    } catch {
      logger.debug("ChatGPT", "Failed to parse success response");
      return { success: true, data: responseText, status };
    }
  } catch (error) {
    logger.error("ChatGPT", "Fetch error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

export async function getTeamSubscriptionForTeam(
  accountId: string,
  accessToken: string,
  cookies?: string
): Promise<TeamSubscriptionResult> {
  if (!accessToken || !accountId) {
    return {
      success: false,
      error: "缺少 Access Token 或 Account ID",
    };
  }

  const credentials: TeamCredentials = { accountId, accessToken, cookies };

  try {
    const response = await fetch(
      `${CHATGPT_API_BASE}/subscriptions?account_id=${accountId}`,
      {
        headers: getHeaders(credentials),
      }
    );

    const status = response.status;
    const bodyText = await response.text();

    if (!response.ok) {
      if (looksLikeCloudflareChallenge(bodyText)) {
        return {
          success: false,
          error: "Cloudflare 验证拦截。请为该团队配置 Cookies",
          requiresCookies: true,
          status,
        };
      }

      if (status === 401 || status === 403) {
        return {
          success: false,
          error: "凭据无效或已过期（HTTP 401/403）",
          status,
        };
      }

      let errorMessage = `HTTP ${status}`;
      try {
        const errorJson = JSON.parse(bodyText) as Record<string, unknown>;
        const detail =
          typeof errorJson.detail === "string" ? errorJson.detail : undefined;
        const message =
          typeof errorJson.message === "string" ? errorJson.message : undefined;
        errorMessage = detail || message || errorMessage;
      } catch {
        errorMessage = bodyText.slice(0, 200) || errorMessage;
      }

      return {
        success: false,
        error: errorMessage,
        status,
      };
    }

    // 某些情况下可能返回 200 但内容是挑战页
    if (looksLikeCloudflareChallenge(bodyText)) {
      return {
        success: false,
        error: "Cloudflare 验证拦截。请为该团队配置 Cookies",
        requiresCookies: true,
        status,
      };
    }

    try {
      const raw = JSON.parse(bodyText) as unknown;
      const subscription = (() => {
        if (Array.isArray(raw)) {
          return (raw[0] ?? {}) as SubscriptionInfo;
        }

        if (raw && typeof raw === "object") {
          const obj = raw as Record<string, unknown>;
          if (Array.isArray(obj.subscriptions)) {
            return (obj.subscriptions[0] ?? {}) as SubscriptionInfo;
          }
          if (obj.subscription && typeof obj.subscription === "object") {
            return obj.subscription as SubscriptionInfo;
          }
          return raw as SubscriptionInfo;
        }

        return {} as SubscriptionInfo;
      })();

      const normalized: SubscriptionInfo = { ...subscription };
      if (
        typeof normalized.seats_used !== "number" &&
        typeof normalized.seats_in_use === "number"
      ) {
        normalized.seats_used = normalized.seats_in_use;
      }
      if (typeof normalized.seats_available !== "number") {
        if (
          typeof normalized.seats_entitled === "number" &&
          typeof normalized.seats_in_use === "number"
        ) {
          const available = normalized.seats_entitled - normalized.seats_in_use;
          normalized.seats_available = available >= 0 ? available : 0;
        }
      }

      return {
        success: true,
        subscription: normalized,
        status,
      };
    } catch {
      return {
        success: false,
        error: "订阅信息解析失败（非 JSON 响应）",
        status,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// Get team members for a specific team
export async function getTeamMembersForTeam(
  accountId: string,
  accessToken: string,
  cookies?: string
): Promise<TeamMembersResult> {
  if (!accessToken || !accountId) {
    return {
      success: false,
      error: "缺少 Access Token 或 Account ID",
    };
  }

  const credentials: TeamCredentials = { accountId, accessToken, cookies };

  try {
    const url = `${CHATGPT_API_BASE}/accounts/${accountId}/users?offset=0&limit=100&query=`;
    const response = await fetch(url, {
      headers: getHeaders(credentials),
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
        status: response.status,
      };
    }

    const data = await response.json();

    const members: TeamMember[] = (data.items || []).map((item: {
      id: string;
      name: string;
      email: string;
      role: string;
      created_time: string;
    }) => ({
      id: item.id,
      name: item.name || "未设置",
      email: item.email,
      role: item.role,
      createdAt: item.created_time,
    }));

    return {
      success: true,
      members,
      total: data.total || members.length,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

export async function removeTeamMemberForTeam(
  accountId: string,
  accessToken: string,
  memberId: string,
  cookies?: string
): Promise<TeamMemberKickResult> {
  if (!accessToken || !accountId || !memberId) {
    return {
      success: false,
      error: "缺少 Access Token、Account ID 或成员 ID",
    };
  }

  const credentials: TeamCredentials = { accountId, accessToken, cookies };

  try {
    const url = `${CHATGPT_API_BASE}/accounts/${accountId}/users/${memberId}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: getHeaders(credentials),
    });

    const status = response.status;
    const bodyText = await response.text();

    if (!response.ok) {
      if (looksLikeCloudflareChallenge(bodyText)) {
        return {
          success: false,
          error: "Cloudflare 验证拦截。请为该团队配置 Cookies",
          requiresCookies: true,
          status,
        };
      }

      if (status === 401 || status === 403) {
        return {
          success: false,
          error: "凭据无效或已过期（HTTP 401/403）",
          status,
        };
      }

      let errorMessage = `HTTP ${status}`;
      try {
        const errorJson = JSON.parse(bodyText) as Record<string, unknown>;
        const detail =
          typeof errorJson.detail === "string" ? errorJson.detail : undefined;
        const message =
          typeof errorJson.message === "string" ? errorJson.message : undefined;
        errorMessage = detail || message || errorMessage;
      } catch {
        errorMessage = bodyText.slice(0, 200) || errorMessage;
      }

      return {
        success: false,
        error: errorMessage,
        status,
      };
    }

    if (looksLikeCloudflareChallenge(bodyText)) {
      return {
        success: false,
        error: "Cloudflare 验证拦截。请为该团队配置 Cookies",
        requiresCookies: true,
        status,
      };
    }

    return {
      success: true,
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// 获取指定团队的全部成员（自动分页）
export async function getAllTeamMembersForTeam(
  accountId: string,
  accessToken: string,
  cookies?: string
): Promise<TeamMembersResult> {
  if (!accessToken || !accountId) {
    return {
      success: false,
      error: "缺少 Access Token 或 Account ID",
    };
  }

  const credentials: TeamCredentials = { accountId, accessToken, cookies };

  const limit = 100;
  let offset = 0;
  const allMembers: TeamMember[] = [];
  let total: number | undefined;

  try {
    while (true) {
      const url = `${CHATGPT_API_BASE}/accounts/${accountId}/users?offset=${offset}&limit=${limit}&query=`;
      const response = await fetch(url, {
        headers: getHeaders(credentials),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}`,
          status: response.status,
        };
      }

      const data = await response.json();

      const members: TeamMember[] = (data.items || []).map((item: {
        id: string;
        name: string;
        email: string;
        role: string;
        created_time: string;
      }) => ({
        id: item.id,
        name: item.name || "未设置",
        email: item.email,
        role: item.role,
        createdAt: item.created_time,
      }));

      allMembers.push(...members);

      const pageTotal =
        typeof data.total === "number" ? (data.total as number) : undefined;

      // 仅当上游明确返回 total 时才使用它；避免 total 缺失时被误判为“已完成”
      if (total === undefined && pageTotal !== undefined) {
        // total=0 且本页有数据通常是异常响应，忽略以保证可继续分页拉取
        if (pageTotal > 0 || members.length === 0) {
          total = pageTotal;
        }
      }

      // 没有更多数据或已拉取到总数
      if (members.length === 0) break;
      if (members.length < limit) break;
      if (total !== undefined && total > 0 && allMembers.length >= total) break;

      offset += limit;
    }

    return {
      success: true,
      members: allMembers,
      total: total ?? allMembers.length,
      status: 200,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}
