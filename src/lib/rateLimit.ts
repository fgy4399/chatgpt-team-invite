// 简单的内存速率限制器
// 生产环境建议使用 Redis 实现

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  windowMs: number; // 时间窗口（毫秒）
  maxRequests: number; // 最大请求数
}

// 默认配置
const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000, // 1分钟
  maxRequests: 30, // 最多30次请求
};

// 不同端点的限制配置
export const rateLimitConfigs: Record<string, RateLimitConfig> = {
  // 邀请提交 - 严格限制
  "invite-submit": {
    windowMs: 60 * 1000,
    maxRequests: 5,
  },
  // 邀请码验证
  "invite-validate": {
    windowMs: 60 * 1000,
    maxRequests: 10,
  },
  // 登录 - 防暴力破解
  "admin-login": {
    windowMs: 15 * 60 * 1000, // 15分钟
    maxRequests: 5,
  },
  // 管理员操作 - 相对宽松
  "admin-api": {
    windowMs: 60 * 1000,
    maxRequests: 60,
  },
};

// 清理过期条目
function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now > entry.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// 每5分钟清理一次
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export function checkRateLimit(
  identifier: string,
  endpoint: string
): RateLimitResult {
  const config = rateLimitConfigs[endpoint] || defaultConfig;
  const key = `${endpoint}:${identifier}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);

  // 如果没有记录或已过期，创建新记录
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetTime: entry.resetTime,
    };
  }

  // 增加计数
  entry.count++;
  rateLimitStore.set(key, entry);

  const allowed = entry.count <= config.maxRequests;
  return {
    allowed,
    remaining: Math.max(0, config.maxRequests - entry.count),
    resetTime: entry.resetTime,
  };
}

// 从请求获取客户端标识符
export function getClientIdentifier(req: Request): string {
  // 优先使用 X-Forwarded-For（代理后的真实 IP）
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  // 其次使用 X-Real-IP
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }

  // 最后使用默认值
  return "unknown";
}
