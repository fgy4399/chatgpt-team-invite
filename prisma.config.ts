import "dotenv/config";
import path from "path";
import { defineConfig } from "prisma/config";

const localDbUrl = `file:${path.join(__dirname, "prisma", "dev.db")}`;
// Prisma Migrate 对 file: 相对路径的解析较容易踩坑（取决于运行目录）。
// 本地开发默认固定使用 prisma/dev.db；当 DATABASE_URL 为远程 libsql/http(s)/ws(s) 时才切换。
const envUrl = process.env.DATABASE_URL;
const datasourceUrl = envUrl && !envUrl.startsWith("file:") ? envUrl : localDbUrl;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
