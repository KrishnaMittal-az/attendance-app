import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SSE must not be buffered by gzip.
  compress: false,
  devIndicators: false,
  // Don't let `next dev` write AGENTS.md/CLAUDE.md into control/.
  agentRules: false,
  // The repo root holds an unrelated Next.js app (with its own lockfile and middleware.ts):
  // pin the workspace root to control/ so none of it leaks in.
  turbopack: { root: path.resolve(__dirname) },
  outputFileTracingRoot: path.resolve(__dirname),
  // Child processes, fs and node:http are used by the API routes; keep qrcode server-side.
  serverExternalPackages: ["qrcode"],
};

export default nextConfig;
