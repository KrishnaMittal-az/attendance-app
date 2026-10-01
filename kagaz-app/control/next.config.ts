import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SSE must not be buffered by gzip.
  compress: false,
  devIndicators: false,
  // Child processes, fs and node:http are used by the API routes; keep qrcode server-side.
  serverExternalPackages: ["qrcode"],
};

export default nextConfig;
