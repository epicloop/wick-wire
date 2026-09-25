import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The replay fixture is read from disk at runtime; make sure it ships with the API functions.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/replay/**/*"],
    "/**/*": ["./data/replay/**/*"],
  },
};

export default nextConfig;
