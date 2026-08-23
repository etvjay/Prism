import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for the tunneled composition-review workflow in development.
  // This does not alter production origin policy.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "sen-mold-designated-thus.trycloudflare.com",
  ],
};

export default nextConfig;
