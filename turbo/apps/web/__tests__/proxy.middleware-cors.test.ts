import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { reloadEnv } from "../src/env";

/**
 * Tests the proxy middleware's CORS handling around the Clerk layer —
 * specifically the three code paths introduced alongside the credit
 * breakdown feature:
 *
 *  1. `/api/v1/*` bypasses Clerk entirely and returns the result of
 *     `handleCors(request)` directly.
 *  2. Self-signed-token (`vm0_sandbox_`, `vm0_pat_`) `/api/*` requests
 *     bypass Clerk and likewise return `handleCors(request)`.
 *  3. For all other API requests, the outer middleware calls Clerk and then
 *     attaches `Access-Control-Allow-Origin` + `Allow-Credentials` to the
 *     response when Clerk hasn't already set them.
 *
 * Kept separate from `proxy.cors.test.ts` which exclusively exercises the
 * pure `handleCors()` function.
 */

let capturedClerkCalled = false;
let clerkResponseOverride: NextResponse | undefined;

type ClerkHandler = (
  auth: { protect: ReturnType<typeof vi.fn> },
  request: NextRequest,
) => Promise<NextResponse | undefined>;

vi.mock("@clerk/nextjs/server", () => {
  return {
    clerkMiddleware: vi.fn((handler: ClerkHandler) => {
      return vi.fn(async (request: NextRequest) => {
        capturedClerkCalled = true;
        const auth = { protect: vi.fn() };
        const result = await handler(auth, request);
        return clerkResponseOverride ?? result ?? NextResponse.next();
      });
    }),
    createRouteMatcher: vi.fn(() => {
      return () => {
        return true;
      };
    }),
  };
});

vi.mock("next-intl/middleware", () => {
  return {
    default: () => {
      return () => {
        return NextResponse.next();
      };
    },
  };
});

// Import after mocks are set up
import middleware from "../proxy";

function createMockEvent() {
  return {
    sourcePage: "/test",
    waitUntil: vi.fn(),
  } as never;
}

describe("proxy middleware: CORS integration", () => {
  beforeEach(() => {
    capturedClerkCalled = false;
    clerkResponseOverride = undefined;
    // Most tests need production-like origin rules. Individual tests that
    // need a different env reconfigure via `vi.stubEnv`.
    vi.stubEnv("VERCEL_ENV", "production");
    reloadEnv();
  });

  describe("/api/v1/* bypass path", () => {
    it("returns CORS headers for allowed origin without invoking Clerk", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/v1/runs", {
        method: "GET",
        headers: { origin: "https://app.vm0.ai" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.vm0.ai",
      );
      expect(response?.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });

    it("does not set CORS headers for disallowed origin on /api/v1/*", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/v1/runs", {
        method: "GET",
        headers: { origin: "https://malicious.com" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("handles OPTIONS preflight on /api/v1/* without invoking Clerk", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/v1/runs", {
        method: "OPTIONS",
        headers: { origin: "https://app.vm0.ai" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.vm0.ai",
      );
    });
  });

  describe("self-signed-token /api/* bypass path", () => {
    it("returns CORS headers for sandbox token on /api/* without invoking Clerk", async () => {
      const request = new NextRequest(
        "https://api.vm0.ai/api/sandbox/webhook",
        {
          method: "GET",
          headers: {
            origin: "https://app.vm0.ai",
            authorization: "Bearer vm0_sandbox_header.payload.signature",
          },
        },
      );

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.vm0.ai",
      );
    });

    it("returns CORS headers for PAT token on /api/* without invoking Clerk", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/runs", {
        method: "GET",
        headers: {
          origin: "https://app.vm0.ai",
          authorization: "Bearer vm0_pat_header.payload.signature",
        },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.vm0.ai",
      );
    });

    it("does not leak CORS headers when a sandbox token originates from a disallowed origin", async () => {
      const request = new NextRequest(
        "https://api.vm0.ai/api/sandbox/webhook",
        {
          method: "GET",
          headers: {
            origin: "https://malicious.com",
            authorization: "Bearer vm0_sandbox_header.payload.signature",
          },
        },
      );

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(false);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });

  describe("response-side CORS header injection after Clerk", () => {
    it("attaches CORS headers to Clerk response for allowed origin", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/runs", {
        method: "GET",
        headers: { origin: "https://app.vm0.ai" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(true);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://app.vm0.ai",
      );
      expect(response?.headers.get("Access-Control-Allow-Credentials")).toBe(
        "true",
      );
    });

    it("does not attach CORS headers for disallowed origin", async () => {
      const request = new NextRequest("https://api.vm0.ai/api/runs", {
        method: "GET",
        headers: { origin: "https://malicious.com" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(true);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });

    it("preserves CORS headers already set by Clerk (does not overwrite)", async () => {
      // Simulate Clerk (or an inner layer) having already attached a
      // CORS-Allow-Origin header. The outer middleware must not overwrite it
      // with the handleCors-derived value — otherwise downstream-set values
      // (including Clerk-generated redirects) would be silently clobbered.
      const clerkResponse = NextResponse.next();
      clerkResponse.headers.set(
        "Access-Control-Allow-Origin",
        "https://explicitly-set.vm0.ai",
      );
      clerkResponseOverride = clerkResponse;

      const request = new NextRequest("https://api.vm0.ai/api/runs", {
        method: "GET",
        headers: { origin: "https://app.vm0.ai" },
      });

      const response = await middleware(request, createMockEvent());

      expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
        "https://explicitly-set.vm0.ai",
      );
    });

    it("does not attach CORS headers on non-API routes even with allowed origin", async () => {
      const request = new NextRequest("https://www.vm0.ai/en/blog", {
        method: "GET",
        headers: { origin: "https://app.vm0.ai" },
      });

      const response = await middleware(request, createMockEvent());

      expect(capturedClerkCalled).toBe(true);
      expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    });
  });
});
