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

interface TeamCredentials {
  accountId: string;
  accessToken: string;
  cookies?: string;
}

function getHeaders(credentials?: TeamCredentials): Record<string, string> {
  const token = credentials?.accessToken || process.env.CHATGPT_ACCESS_TOKEN;
  const cookies = credentials?.cookies || process.env.CHATGPT_COOKIES;
  const accountId = credentials?.accountId || process.env.CHATGPT_ACCOUNT_ID;

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

export async function getTeamSubscription(): Promise<SubscriptionInfo | null> {
  const token = process.env.CHATGPT_ACCESS_TOKEN;
  const accountId = process.env.CHATGPT_ACCOUNT_ID;

  if (!token || !accountId) {
    return null;
  }

  try {
    const response = await fetch(
      `${CHATGPT_API_BASE}/subscriptions?account_id=${accountId}`,
      {
        headers: getHeaders(),
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch {
    return null;
  }
}

export async function checkTokenValid(): Promise<boolean> {
  const subscription = await getTeamSubscription();
  return subscription !== null;
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
