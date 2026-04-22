/** @type {import('next').NextConfig} */
const API_ORIGIN = process.env.SLASH_API_ORIGIN ?? "http://127.0.0.1:4456";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
