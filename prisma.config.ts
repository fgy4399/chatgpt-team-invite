import "dotenv/config";
import path from "path";
import { defineConfig } from "prisma/config";

const localDbUrl = `file:${path.join(__dirname, "prisma", "dev.db")}`;
const envUrl = process.env.DATABASE_URL;

function resolveFileUrl(fileUrl: string): string {
  const rawPath = fileUrl.replace(/^file:/, "");
  if (!rawPath) return localDbUrl;
  if (path.isAbsolute(rawPath)) return `file:${rawPath}`;
  return `file:${path.join(__dirname, rawPath)}`;
}

const datasourceUrl = envUrl
  ? envUrl.startsWith("file:")
    ? resolveFileUrl(envUrl)
    : envUrl
  : localDbUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
