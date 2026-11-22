import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @skippy/shared ships TypeScript source, so Next compiles it.
  transpilePackages: ["@skippy/shared"],
  cacheComponents: true,
  experimental: {
    // Next does not tree-shake Phosphor by default; without this every icon ships.
    optimizePackageImports: ["@phosphor-icons/react"],
  },
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
