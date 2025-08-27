import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Allow mobile device access from local network
  allowedDevOrigins: [
    'localhost:3000',
    '127.0.0.1:3000',
    '192.168.29.112:3000',
    '0.0.0.0:3000',
    // Add your mobile's IP range
    '192.168.29.*',
    '192.168.*.*',
    '10.*.*.*',
    '172.16.*.*'
  ],
};

export default nextConfig;
