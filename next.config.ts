import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["@lancedb/lancedb", "@xenova/transformers", "better-sqlite3"],
};

export default nextConfig;
