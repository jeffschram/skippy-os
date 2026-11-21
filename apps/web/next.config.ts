import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @skippy/shared ships TypeScript source, so Next compiles it.
  transpilePackages: ["@skippy/shared"],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
