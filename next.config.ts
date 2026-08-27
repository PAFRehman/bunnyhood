import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/rabbithole/image/*": [
      "./public/assets/rabbit-hole-box.png",
      "./public/assets/bunny-hood-mark.webp",
    ],
  },
  async redirects() {
    return [
      {
        source: "/whitelist/:path*",
        destination: "/SpinTheWheel",
        permanent: true,
      },
      {
        source: "/getWL/:path*",
        destination: "/SpinTheWheel",
        permanent: true,
      },
      {
        source: "/spin",
        destination: "/SpinTheWheel",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
