/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://backend:8000/api/:path*',
      },
      {
        source: '/tiles/:path*',
        destination: 'http://tileserver:8080/:path*',
      },
    ];
  },
  // Transpile OpenLayers for proper SSR handling
  transpilePackages: ['ol'],
};

export default nextConfig;
