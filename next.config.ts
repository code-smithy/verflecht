import type { NextConfig } from "next";

const isStaticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  basePath: "/verflecht",
  images: {
    unoptimized: true,
  },
  output: isStaticExport ? "export" : undefined,
  reactStrictMode: true,
  trailingSlash: true,
};

export default nextConfig;
