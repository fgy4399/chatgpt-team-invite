import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    // Some server-only dependencies (e.g. libsql adapters) use dynamic requires that can
    // make webpack pull README/LICENSE files from node_modules. Treat them as source assets
    // so the server build doesn't try to parse them as JavaScript.
    config.module = config.module ?? {};
    config.module.rules = config.module.rules ?? [];
    config.module.rules.push(
      { test: /\.md$/i, type: "asset/source" },
      { test: /LICENSE$/i, type: "asset/source" }
    );
    return config;
  },
};

export default nextConfig;
