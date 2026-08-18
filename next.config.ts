import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/verflecht",
  images: {
    unoptimized: true,
  },
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
};

export default nextConfig;
