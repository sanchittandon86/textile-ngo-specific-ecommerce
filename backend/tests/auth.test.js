jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

process.env.JWT_SECRET = "test_jwt_secret";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const pool = require("../src/config/db");
const app = require("../src/app");

function makeClient() {
  return { query: jest.fn(), release: jest.fn() };
}

describe("Admin Auth APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/auth/login", () => {
    test("rejects missing email/password with 400, no DB call", async () => {
      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "admin@example.com" });

      expect(response.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects an unknown email with 401", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "nobody@example.com", password: "whatever123" });

      expect(response.status).toBe(401);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects a wrong password with 401", async () => {
      const hash = await bcrypt.hash("correct-password", 10);
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: "Admin", email: "admin@example.com", password_hash: hash }],
      });

      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "admin@example.com", password: "wrong-password" });

      expect(response.status).toBe(401);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("logs in successfully, revokes prior sessions, and sets the refresh cookie", async () => {
      const hash = await bcrypt.hash("correct-password", 10);
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: "Admin", email: "admin@example.com", password_hash: hash }],
      });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({}) // UPDATE revoke prior sessions
        .mockResolvedValueOnce({}) // INSERT new session
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/api/auth/login")
        .send({ email: "admin@example.com", password: "correct-password" });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.user).toEqual({
        id: 1,
        name: "Admin",
        email: "admin@example.com",
      });
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE admin_refresh_tokens"),
        [1]
      );
      const setCookie = response.headers["set-cookie"];
      expect(setCookie.some((c) => c.startsWith("adminRefreshToken="))).toBe(true);
    });
  });

  describe("GET /api/auth/profile", () => {
    test("rejects a missing access token with 401, no DB call", async () => {
      const response = await request(app).get("/api/auth/profile");

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects a revoked/unknown session with 401", async () => {
      const token = jwt.sign(
        { adminId: 1, email: "admin@example.com", sessionId: "11111111-1111-1111-1111-111111111111" },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );
      pool.query.mockResolvedValueOnce({ rows: [] }); // session not found/revoked

      const response = await request(app)
        .get("/api/auth/profile")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(401);
    });

    test("returns the admin profile for a valid, active session", async () => {
      const token = jwt.sign(
        { adminId: 1, email: "admin@example.com", sessionId: "11111111-1111-1111-1111-111111111111" },
        process.env.JWT_SECRET,
        { expiresIn: "15m" }
      );
      pool.query
        .mockResolvedValueOnce({ rows: [{ x: 1 }] }) // middleware: session active
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: "Admin", email: "admin@example.com", created_at: "2026-01-01" }],
        }); // getProfile

      const response = await request(app)
        .get("/api/auth/profile")
        .set("Authorization", `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe("admin@example.com");
    });
  });

  describe("POST /api/auth/refresh", () => {
    test("rejects a missing refresh cookie with 400", async () => {
      const response = await request(app).post("/api/auth/refresh");

      expect(response.status).toBe(400);
    });

    test("rotates a valid refresh token and returns a new access token", async () => {
      const sessionId = "22222222-2222-2222-2222-222222222222";
      const refreshToken = jwt.sign(
        { adminId: 1, sessionId, jti: "abc" },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" }
      );

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ admin_id: 1, session_id: sessionId }] }) // revoke old
        .mockResolvedValueOnce({ rows: [{ id: 1, name: "Admin", email: "admin@example.com" }] }) // select admin
        .mockResolvedValueOnce({}) // insert new token
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", [`adminRefreshToken=${refreshToken}`]);

      expect(response.status).toBe(200);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
      const setCookie = response.headers["set-cookie"];
      expect(setCookie.some((c) => c.startsWith("adminRefreshToken="))).toBe(true);
    });

    test("rejects a reused/revoked refresh token with 401", async () => {
      const sessionId = "33333333-3333-3333-3333-333333333333";
      const refreshToken = jwt.sign(
        { adminId: 1, sessionId, jti: "xyz" },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" }
      );

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no matching active token
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", [`adminRefreshToken=${refreshToken}`]);

      expect(response.status).toBe(401);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    });
  });

  describe("POST /api/auth/logout", () => {
    test("rejects a missing refresh cookie with 400", async () => {
      const response = await request(app).post("/api/auth/logout");

      expect(response.status).toBe(400);
    });

    test("revokes the session and clears the cookie", async () => {
      const sessionId = "44444444-4444-4444-4444-444444444444";
      const refreshToken = jwt.sign(
        { adminId: 1, sessionId, jti: "logout" },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: "7d" }
      );
      pool.query.mockResolvedValueOnce({});

      const response = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", [`adminRefreshToken=${refreshToken}`]);

      expect(response.status).toBe(200);
      const setCookie = response.headers["set-cookie"];
      expect(setCookie.some((c) => c.includes("adminRefreshToken=;"))).toBe(true);
    });
  });
});
