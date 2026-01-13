import { PrismaClient } from "@/generated/prisma";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import path from "path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function resolveSqliteFilePath(databaseUrl: string): string {
  const rawPath = databaseUrl.replace(/^file:/, "");
  if (path.isAbsolute(rawPath)) return rawPath;
  return path.join(process.cwd(), rawPath);
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;

  // Prefer DATABASE_URL when provided:
  // - libsql/http(s)/ws(s) URLs: use PrismaLibSql (for Turso/libsql cloud)
  // - file: URLs: use better-sqlite3 (local sqlite file)
  if (databaseUrl) {
    if (databaseUrl.startsWith("file:")) {
      const dbPath = resolveSqliteFilePath(databaseUrl);
      const adapter = new PrismaBetterSqlite3({ url: dbPath });
      return new PrismaClient({ adapter });
    }

    const authToken = process.env.DATABASE_AUTH_TOKEN;
    const adapter = new PrismaLibSql({ url: databaseUrl, authToken });
    return new PrismaClient({ adapter });
  }

  // Local default (dev only)
  const dbPath = path.join(process.cwd(), "prisma", "dev.db");
  const adapter = new PrismaBetterSqlite3({ url: dbPath });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
