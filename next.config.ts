import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; bundling it would break the binding.
  serverExternalPackages: ["better-sqlite3"],

  experimental: {
    // Both are barrel files: importing one icon or one chart pulls the whole
    // index through the bundler unless it is told to rewrite the import to the
    // specific module. lucide-react is ~1,500 components, of which this app
    // uses about twenty.
    optimizePackageImports: ["lucide-react", "recharts"],
  },
};

export default nextConfig;
