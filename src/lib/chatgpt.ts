import { logger } from "./logger";

const CHATGPT_API_BASE = "https://chatgpt.com/backend-api";

interface InviteResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

interface SubscriptionInfo {
  seats_available?: number;
  seats_used?: number;
  plan_type?: string;
  [key: string]: unknown;
}

interface TeamSubscriptionResult {
  success: boolean;
  subscription?: SubscriptionInfo;
  error?: string;
  requiresCookies?: boolean;
  status?: number;
}

interface AccountEntitlementInfo {
  subscription_id?: string | null;
  has_active_subscription?: boolean;
  subscription_plan?: unknown;
  expires_at?: string | null;
  renews_at?: string | null;
  cancels_at?: string | null;
  billing_period?: string | null;
  billing_currency?: string | null;
  is_delinquent?: boolean;
  [key: string]: unknown;
}

interface AccountCheckAccountInfo {
  plan_type?: string;
  structure?: string;
  workspace_type?: string | null;
  [key: string]: unknown;
}

interface AccountCheckAccount {
  account?: AccountCheckAccountInfo;
  entitlement?: AccountEntitlementInfo;
  can_access_with_session?: boolean;
  [key: string]: unknown;
}

interface AccountCheckResponse {
  accounts?: Record<string, AccountCheckAccount>;
  account_ordering?: string[];
}

interface TeamEntitlementResult {
  success: boolean;
  entitlement?: {
    planType?: string;
    subscriptionPlan?: unknown;
    hasActiveSubscription: boolean;
    expiresAt?: string | null;
    renewsAt?: string | null;
    cancelsAt?: string | null;
    isDelinquent?: boolean;
  };
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

function getHeaders(credentials?: TeamCredentials): Record<string, string> {
  const token = credentials?.accessToken ?? process.env.CHATGPT_ACCESS_TOKEN;
  const cookies = credentials?.cookies ?? process.env.CHATGPT_COOKIES;
  const accountId = credentials?.accountId ?? process.env.CHATGPT_ACCOUNT_ID;

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

    const responseText = await response.text();
    logger.debug("ChatGPT", `Response body: ${responseText.slice(0, 200)}`);

    if (!response.ok) {
      // Check if it's a Cloudflare challenge
      if (responseText.includes("cf_chl") || responseText.includes("challenge-platform")) {
        return {
          success: false,
          error: "Cloudflare 验证拦截。请配置团队的 Cookies",
        };
      }

      let errorMessage = `HTTP ${response.status}`;

      try {
        const errorJson = JSON.parse(responseText);
        errorMessage = errorJson.detail || errorJson.message || errorMessage;
      } catch {
        errorMessage = responseText.slice(0, 200) || errorMessage;
      }

      return { success: false, error: errorMessage };
    }

    // Parse response
    try {
      const data = JSON.parse(responseText);
      logger.info("ChatGPT", "Invite sent successfully");
      return { success: true, data };
    } catch {
      logger.debug("ChatGPT", "Failed to parse success response");
      return { success: true, data: responseText };
    }
  } catch (error) {
    logger.error("ChatGPT", "Fetch error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// Legacy function using env vars (for backward compatibility)
export async function sendTeamInvite(email: string): Promise<InviteResult> {
  const token = process.env.CHATGPT_ACCESS_TOKEN;
  const accountId = process.env.CHATGPT_ACCOUNT_ID;
  const cookies = process.env.CHATGPT_COOKIES;

  if (!token || !accountId) {
    return {
      success: false,
      error: "缺少 CHATGPT_ACCESS_TOKEN 或 CHATGPT_ACCOUNT_ID",
    };
  }

  return sendTeamInviteForTeam(email, {
    accountId,
    accessToken: token,
    cookies,
  });
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
      const subscription = JSON.parse(bodyText) as SubscriptionInfo;
      return {
        success: true,
        subscription,
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

export async function getTeamEntitlementForTeam(
  accountId: string,
  accessToken: string,
  cookies?: string
): Promise<TeamEntitlementResult> {
  if (!accessToken || !accountId) {
    return {
      success: false,
      error: "缺少 Access Token 或 Account ID",
    };
  }

  const credentials: TeamCredentials = { accountId, accessToken, cookies };

  try {
    const timezoneOffsetMin = 0;
    const response = await fetch(
      `${CHATGPT_API_BASE}/accounts/check/v4-2023-04-27?timezone_offset_min=${timezoneOffsetMin}`,
      { headers: getHeaders(credentials) }
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

    if (looksLikeCloudflareChallenge(bodyText)) {
      return {
        success: false,
        error: "Cloudflare 验证拦截。请为该团队配置 Cookies",
        requiresCookies: true,
        status,
      };
    }

    let data: AccountCheckResponse;
    try {
      data = JSON.parse(bodyText) as AccountCheckResponse;
    } catch {
      return {
        success: false,
        error: "账号权益信息解析失败（非 JSON 响应）",
        status,
      };
    }

    const entry = data.accounts?.[accountId];
    if (!entry) {
      return {
        success: false,
        error: "账号权益接口未返回该 Account ID 的信息",
        status,
      };
    }

    const planType =
      typeof entry.account?.plan_type === "string" ? entry.account.plan_type : undefined;
    const rawEntitlement = entry.entitlement ?? {};
    const hasActiveSubscription = Boolean(rawEntitlement.has_active_subscription);

    const expiresAt =
      typeof rawEntitlement.expires_at === "string" || rawEntitlement.expires_at === null
        ? rawEntitlement.expires_at
        : undefined;
    const renewsAt =
      typeof rawEntitlement.renews_at === "string" || rawEntitlement.renews_at === null
        ? rawEntitlement.renews_at
        : undefined;
    const cancelsAt =
      typeof rawEntitlement.cancels_at === "string" || rawEntitlement.cancels_at === null
        ? rawEntitlement.cancels_at
        : undefined;

    return {
      success: true,
      entitlement: {
        planType,
        subscriptionPlan: rawEntitlement.subscription_plan,
        hasActiveSubscription,
        expiresAt,
        renewsAt,
        cancelsAt,
        isDelinquent: Boolean(rawEntitlement.is_delinquent),
      },
      status,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

export async function getTeamSubscription(): Promise<SubscriptionInfo | null> {
  const token = process.env.CHATGPT_ACCESS_TOKEN;
  const accountId = process.env.CHATGPT_ACCOUNT_ID;
  const cookies = process.env.CHATGPT_COOKIES;

  if (!token || !accountId) {
    return null;
  }

  const result = await getTeamSubscriptionForTeam(accountId, token, cookies);
  return result.success ? (result.subscription ?? null) : null;
}

export async function checkTokenValid(): Promise<boolean> {
  const token = process.env.CHATGPT_ACCESS_TOKEN;
  const accountId = process.env.CHATGPT_ACCOUNT_ID;
  const cookies = process.env.CHATGPT_COOKIES;

  if (!token || !accountId) return false;

  const result = await getTeamSubscriptionForTeam(accountId, token, cookies);
  return result.success;
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
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// Legacy function using env vars
export async function getTeamMembers(): Promise<TeamMembersResult> {
  const token = process.env.CHATGPT_ACCESS_TOKEN;
  const accountId = process.env.CHATGPT_ACCOUNT_ID;
  const cookies = process.env.CHATGPT_COOKIES;

  if (!token || !accountId) {
    return {
      success: false,
      error: "缺少 CHATGPT_ACCESS_TOKEN 或 CHATGPT_ACCOUNT_ID",
    };
  }

  return getTeamMembersForTeam(accountId, token, cookies);
}
