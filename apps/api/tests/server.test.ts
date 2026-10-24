import dotenv from "dotenv";
dotenv.config();

// In-Memory Prisma Mock for isolated execution
jest.mock("@prisma/client", () => {
  return {
    PrismaClient: jest.fn().mockImplementation(() => {
      return {
        tenant: {
          findFirst: jest
            .fn()
            .mockResolvedValue({
              id: "tenant-1",
              slug: "demo",
              status: "ACTIVE",
            }),
          findUnique: jest
            .fn()
            .mockResolvedValue({
              id: "tenant-1",
              slug: "demo",
              status: "ACTIVE",
            }),
        },
        user: {
          findFirst: jest.fn().mockResolvedValue(null),
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ id: "user-1", ...data }),
            ),
        },
        queue: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve({ id: "q-1", ...data }),
            ),
        },
      };
    }),
  };
});

import express from "express";
import request from "supertest";
import app, { validateTrustProxyHops, TRUST_PROXY_HOPS } from "../src/index";

/**
 * ARCHITECTURE TESTING BOUNDARY & SCOPE DECLARATION:
 *
 * WHAT THESE TESTS PROVE:
 * 1. Express's in-process `proxy-addr` resolution with `trust proxy: 1` correctly evaluates
 *    `X-Forwarded-For` from right to left, trusting strictly the single rightmost proxy hop.
 * 2. Attacker-supplied `X-Forwarded-For` prefixes (single or multiple) are ignored when selecting `req.ip`.
 * 3. Rate-limiting quotas are correctly partitioned into independent buckets by the resolved rightmost IP.
 * 4. An attacker mutating prepended prefixes cannot bypass, reset, or split their rate-limiting quota.
 * 5. Startup configuration parser `validateTrustProxyHops` rejects zero, negative, malformed, non-integer,
 *    and unreasonable (> 2) hop values with fatal configuration errors, preventing silent fallback.
 *
 * WHAT THESE TESTS CANNOT PROVE ABOUT RENDER INFRASTRUCTURE:
 * 1. These tests run in memory; they CANNOT prove how many proxy hops Render's live network topology adds.
 * 2. They CANNOT prove whether Render's ingress router appends, replaces, or normalizes incoming `X-Forwarded-For`.
 * 3. They CANNOT prove whether Cloudflare Anycast edge proxies sit in front of Render on custom domains or
 *    `*.onrender.com`, or whether Cloudflare's egress IP is appended as a second hop.
 * 4. Staging verification with live cross-network traffic (e.g. comparing `RateLimit-Remaining` across distinct ISPs)
 *    is required to verify live infrastructure behavior before production approval.
 */

describe("Server Infrastructure & Hardening Regression Tests", () => {
  describe("ISSUE 1A: Startup Proxy Configuration Validation", () => {
    it("CONFIG-01: Defaults to 1 hop when TRUST_PROXY_HOPS is undefined, null, or empty string", () => {
      expect(validateTrustProxyHops(undefined)).toBe(1);
      expect(validateTrustProxyHops(null as any)).toBe(1);
      expect(validateTrustProxyHops("")).toBe(1);
      expect(validateTrustProxyHops("   ")).toBe(1);
    });

    it("CONFIG-02: Accepts valid integer strings within safe architectural bounds (1 to 2)", () => {
      expect(validateTrustProxyHops("1")).toBe(1);
      expect(validateTrustProxyHops(" 1 ")).toBe(1);
      expect(validateTrustProxyHops("2")).toBe(2);
      expect(validateTrustProxyHops(" 2 ")).toBe(2);
    });

    it("CONFIG-03: Rejects zero ('0') with fatal configuration error", () => {
      expect(() => validateTrustProxyHops("0")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be greater than 0/,
      );
    });

    it("CONFIG-04: Rejects negative values ('-1', '-5') with fatal configuration error", () => {
      expect(() => validateTrustProxyHops("-1")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be a positive integer/,
      );
      expect(() => validateTrustProxyHops("-5")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be a positive integer/,
      );
    });

    it("CONFIG-05: Rejects non-integer, decimal, and malformed strings without silent fallback", () => {
      expect(() => validateTrustProxyHops("abc")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be a positive integer/,
      );
      expect(() => validateTrustProxyHops("true")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be a positive integer/,
      );
      expect(() => validateTrustProxyHops("1.5")).toThrow(
        /FATAL CONFIGURATION ERROR: TRUST_PROXY_HOPS must be a positive integer/,
      );
    });

    it("CONFIG-06: Rejects unreasonable hop counts (> 2) to prevent over-trusting and IP spoofing", () => {
      expect(() => validateTrustProxyHops("3")).toThrow(
        /exceeds maximum safe limit \(2\)\. Excessive hop trust permits client IP spoofing\./,
      );
      expect(() => validateTrustProxyHops("99")).toThrow(
        /exceeds maximum safe limit \(2\)\. Excessive hop trust permits client IP spoofing\./,
      );
    });
  });

  describe("ISSUE 1B: Express Proxy & Rate Limiter Configuration", () => {
    it("PROXY-01: Health endpoint responds 200 OK", async () => {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });

    it("PROXY-02: Handles X-Forwarded-For header without ERR_ERL_UNEXPECTED_X_FORWARDED_FOR error", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "203.0.113.195");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("PROXY-03: Rate limiter returns standard RateLimit headers on /api routes", async () => {
      const res = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "198.51.100.42");

      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty("ratelimit-limit");
      expect(res.headers).toHaveProperty("ratelimit-remaining");
      expect(res.headers).toHaveProperty("ratelimit-reset");
    });

    it("PROXY-04: Single-hop trust proxy configuration is set on Express", () => {
      expect(app.get("trust proxy")).toBe(1);
      expect(TRUST_PROXY_HOPS).toBe(1);
    });

    it("PROXY-05: Multi-hop header extracts rightmost IP and ignores attacker-supplied prefix", async () => {
      // In a separate test express instance matching production's trust proxy: 1
      const hopTestApp = express();
      hopTestApp.set("trust proxy", 1);
      hopTestApp.get("/test/ip", (req, res) => res.json({ ip: req.ip }));

      // Attacker sends forged IP 198.51.100.99; proxy appends genuine client IP 203.0.113.195
      const res = await request(hopTestApp)
        .get("/test/ip")
        .set("X-Forwarded-For", "198.51.100.99, 203.0.113.195");

      expect(res.body.ip).toBe("203.0.113.195");
      expect(res.body.ip).not.toBe("198.51.100.99");
    });

    it("PROXY-06: Evaluates only rightmost IP even when attacker prepends multiple spoofed IPs", async () => {
      const hopTestApp = express();
      hopTestApp.set("trust proxy", 1);
      hopTestApp.get("/test/ip", (req, res) => res.json({ ip: req.ip }));

      // Attacker prepends multiple forged private/public IPs
      const res = await request(hopTestApp)
        .get("/test/ip")
        .set(
          "X-Forwarded-For",
          "10.0.0.1, 172.16.0.1, 192.168.1.1, 203.0.113.195",
        );

      expect(res.body.ip).toBe("203.0.113.195");
    });

    it("PROXY-07: Distinct client IPs are partitioned into independent rate-limit buckets", async () => {
      // Make 2 requests from Client A (203.0.113.10)
      const resA1 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "203.0.113.10");
      const remA1 = parseInt(resA1.headers["ratelimit-remaining"], 10);

      const resA2 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "203.0.113.10");
      const remA2 = parseInt(resA2.headers["ratelimit-remaining"], 10);

      // Make 1 request from Client B (198.51.100.20)
      const resB1 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "198.51.100.20");
      const remB1 = parseInt(resB1.headers["ratelimit-remaining"], 10);

      // Client A's quota decremented by 1 between calls
      expect(remA2).toBe(remA1 - 1);

      // Client B's bucket is independent: remB1 must be higher than Client A's decremented state remA2
      expect(remB1).toBeGreaterThan(remA2);
    });

    it("PROXY-08: Attacker mutating prepended X-Forwarded-For prefixes cannot evade rate-limit quota", async () => {
      // Attacker attempts to evade rate limiting by mutating the prepended spoofed IP on each request
      // while their real IP (203.0.113.77) is consistently appended by the proxy
      const res1 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "attacker-forgery-1, 203.0.113.77");
      const rem1 = parseInt(res1.headers["ratelimit-remaining"], 10);

      const res2 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "attacker-forgery-2, 203.0.113.77");
      const rem2 = parseInt(res2.headers["ratelimit-remaining"], 10);

      const res3 = await request(app)
        .get("/api/health")
        .set("X-Forwarded-For", "attacker-forgery-3, 203.0.113.77");
      const rem3 = parseInt(res3.headers["ratelimit-remaining"], 10);

      // Quota MUST decrement sequentially despite different attacker prefixes,
      // proving that trust proxy: 1 anchors rate-limiting to the rightmost IP
      expect(rem2).toBe(rem1 - 1);
      expect(rem3).toBe(rem1 - 2);
    });
  });

  describe("ISSUE 2: Malformed JSON Body Parsing & Error Handling", () => {
    it("JSON-01: Returns HTTP 400 Bad Request on malformed JSON payload", async () => {
      // Simulate client sending invalid JSON with application/json header
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send("{invalid_json_payload: true,");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body).toHaveProperty("error");
      expect(res.body.error).toBe("Bad Request: Malformed JSON payload");
    });

    it("JSON-02: SyntaxError at line 1 column 2 returns clean JSON 400 without stack trace", async () => {
      // Matches the exact Render log error: "Expected property name or '}' in JSON at position 1 (line 1 column 2)"
      // E.g. unquoted key like {key: 'val'}
      const res = await request(app)
        .post("/api/auth/signup")
        .set("Content-Type", "application/json")
        .send("{name: 'test'}");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.body.error).toBe("Bad Request: Malformed JSON payload");
      // Must NOT leak stack trace or internal code files
      expect(res.body).not.toHaveProperty("stack");
      expect(JSON.stringify(res.body)).not.toContain("node_modules");
      expect(JSON.stringify(res.body)).not.toContain("SyntaxError");
    });

    it("JSON-03: Valid JSON payload is parsed and handled normally", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email: "valid.user@example.com", password: "password123" });

      // Valid JSON is parsed correctly. Reaching 401 proves JSON parsing succeeded.
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("JSON-04: Non-syntax error 400s (e.g. Zod validation errors) are not masked", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .set("Content-Type", "application/json")
        .send({ email: "not-an-email", password: "123" }); // Invalid format & short password

      expect(res.status).toBe(400);
      // Valid JSON with schema invalidity must NOT return "Malformed JSON payload"
      expect(res.body.error).not.toBe("Bad Request: Malformed JSON payload");
    });
  });
});
