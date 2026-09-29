/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    staleTimes: {
      dynamic: 0,
    },
  },
};

export default nextConfig;
