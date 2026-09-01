import request from "supertest";
import app from "../src/index";
import jwt from "jsonwebtoken";

const JWT_SECRET =
  process.env.JWT_SECRET || "fallback-secret-do-not-use-in-prod";

describe("Auth & Tenant Isolation API Tests", () => {
  it("should block unauthenticated requests to protected routes", async () => {
    const res = await request(app)
      .post("/api/queues")
      .send({ name: "Test Queue" });
    expect(res.statusCode).toBe(401);
  });

  it("should enforce role-based access for queue creation", async () => {
    // Sign a token for a normal user
    const token = jwt.sign(
      { id: "user1", tenantId: "tenant1", role: "USER" },
      JWT_SECRET,
    );

    const res = await request(app)
      .post("/api/queues")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Queue" });

    // Should be forbidden because they are not ORGANIZATION_ADMIN
    expect(res.statusCode).toBe(403);
  });

  it("should reject queue creation without tenant context", async () => {
    // Sign a token with missing tenantId
    const token = jwt.sign(
      { id: "admin1", role: "ORGANIZATION_ADMIN" },
      JWT_SECRET,
    );

    const res = await request(app)
      .post("/api/queues")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Queue" });

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toContain("No tenant context");
  });
});
