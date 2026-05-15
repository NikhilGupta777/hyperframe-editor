/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // We import @hyperframe-editor/* from sources directly during dev. In production
  // builds, those packages are pre-built to dist/, but transpilePackages keeps the
  // workspace ergonomic on Vercel without forcing a build step before next build.
  transpilePackages: [
    "@hyperframe-editor/compose",
    "@hyperframe-editor/core",
    "@hyperframe-editor/db",
    "@hyperframe-editor/providers",
    "@hyperframe-editor/queue",
    "@hyperframe-editor/storage",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // Workspace TS sources use NodeNext-style ".js" import specifiers. Webpack 5
  // honours `extensionAlias` to resolve those back to .ts/.tsx files.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};
export default nextConfig;
