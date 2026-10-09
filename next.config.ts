import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // 빌드 시 타입 에러가 있어도 강제로 성공시킴
    ignoreBuildErrors: true,
  },
  eslint: {
    // 빌드 시 ESLint 검사 에러 무시
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
