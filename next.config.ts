import type { NextConfig } from "next";

function shouldExternalize(request: string): boolean {
  return (
    request === "@prisma/adapter-libsql" ||
    request === "libsql" ||
    request.startsWith("@libsql/")
  );
}

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // Some server-only dependencies (e.g. libsql adapters) use dynamic requires that can
    // make webpack pull README/LICENSE files from node_modules. Treat them as source assets
    // so the server build doesn't try to parse them as JavaScript.
    config.module = config.module ?? {};
    config.module.rules = config.module.rules ?? [];
    config.module.rules.push(
      { test: /\.md$/i, type: "asset/source" },
      { test: /\.d\.ts$/i, type: "asset/source" },
      { test: /LICENSE$/i, type: "asset/source" }
    );

	    if (isServer) {
	      const externals = config.externals ?? [];
	      config.externals = Array.isArray(externals) ? externals : [externals];
	      config.externals.push((...args: unknown[]) => {
	        const callback = args[args.length - 1];
	        if (typeof callback !== "function") return;

	        const request =
	          typeof args[1] === "string"
	            ? args[1]
	            : typeof (args[0] as { request?: unknown } | undefined)?.request ===
	                  "string"
	              ? (args[0] as { request: string }).request
	              : undefined;

	        if (typeof request === "string" && shouldExternalize(request)) {
	          return callback(null, `commonjs ${request}`);
	        }
	        return callback();
	      });
	    }

    return config;
  },
};

export default nextConfig;
