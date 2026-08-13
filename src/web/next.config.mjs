/**
 * Next.js config. The browser calls same-origin `/api/chat`, which is handled
 * by the Route Handler in app/api/chat/route.ts (it proxies + streams to the
 * Express API). This keeps the frontend free of CORS and hardcoded URLs.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
