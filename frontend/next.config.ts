import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // No remote image hosts configured yet -- the current product dataset
  // has no image_url values. Add specific hostnames here (not a "**"
  // wildcard) once a real image CDN/host is known.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
