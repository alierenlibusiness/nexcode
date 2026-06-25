/** @type {import('next').NextConfig} */
const nextConfig = {
  // Electron içinde dosya:// protokolünden yüklenmek üzere statik export.
  output: "export",
  reactStrictMode: true,
  transpilePackages: ["@nexcode/core"],
  images: { unoptimized: true },
};

export default nextConfig;
