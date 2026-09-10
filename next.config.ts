import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: process.env.NEXT_OUTPUT === "export" ? "export" : undefined,
  basePath: process.env.NEXT_PUBLIC_SITE_BASE_PATH ?? "",
  trailingSlash: true,
};

export default nextConfig;
