/**
 * Next.js middleware — runs at the edge before all routes.
 *
 * Responsibilities:
 *   1. Rate limiting on /api/* routes (simple sliding-window in-memory)
 *   2. CORS headers for API routes
 *   3. Security headers (CSP for the composition preview iframe)
 *
 * NOTE: This is a best-effort rate limiter for a single Vercel instance.
 * Vercel functions are stateless across invocations — for serious abuse
 * protection, use Vercel's built-in WAF or an Upstash Redis rate limiter.
 * This layer stops casual abuse and scripts hammering the API.
 */
import { NextResponse, type NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Rate limiting (token bucket per IP, in-memory)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // 120 req/min per IP

// In-memory store. Resets on cold start (fine — Vercel functions are ephemeral).
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Periodic cleanup so the map doesn't grow unbounded on long-lived instances.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHits) {
    if (now > entry.resetAt) ipHits.delete(ip);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const ALLOWED_ORIGINS = new Set<string>([
  // Add your production domain(s) here when deploying
  // "https://your-app.vercel.app",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  // In development, allow all origins. In production, restrict to known origins.
  const allowOrigin =
    process.env.NODE_ENV === "development" || !origin || ALLOWED_ORIGINS.size === 0
      ? "*"
      : ALLOWED_ORIGINS.has(origin)
        ? origin
        : "";

  if (!allowOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Freepik-Api-Key",
    "Access-Control-Max-Age": "86400",
  };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only apply to API routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // CORS preflight
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  // Rate limit check
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": "60",
          ...corsHeaders(req.headers.get("origin")),
        },
      },
    );
  }

  // Pass through with CORS + security headers
  const response = NextResponse.next();
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  for (const [k, v] of Object.entries(cors)) {
    response.headers.set(k, v);
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
