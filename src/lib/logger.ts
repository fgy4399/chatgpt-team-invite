// 日志级别: debug < info < warn < error
type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (level && LOG_LEVELS[level] !== undefined) {
    return level;
  }
  // 生产环境默认 warn，开发环境默认 debug
  return process.env.NODE_ENV === "production" ? "warn" : "debug";
}

function shouldLog(level: LogLevel): boolean {
  const currentLevel = getLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(prefix: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${prefix}] ${message}`;
}

export const logger = {
  debug(prefix: string, message: string, ...args: unknown[]) {
    if (shouldLog("debug")) {
      console.log(formatMessage(prefix, message), ...args);
    }
  },

  info(prefix: string, message: string, ...args: unknown[]) {
    if (shouldLog("info")) {
      console.log(formatMessage(prefix, message), ...args);
    }
  },

  warn(prefix: string, message: string, ...args: unknown[]) {
    if (shouldLog("warn")) {
      console.warn(formatMessage(prefix, message), ...args);
    }
  },

  error(prefix: string, message: string, ...args: unknown[]) {
    if (shouldLog("error")) {
      console.error(formatMessage(prefix, message), ...args);
    }
  },
};
