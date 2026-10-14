jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

process.env.JWT_SECRET = "test_jwt_secret";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const pool = require("../src/config/db");
const app = require("../src/app");

function adminToken() {
  return jwt.sign(
    { adminId: 1, email: "admin@example.com", sessionId: "11111111-1111-1111-1111-111111111111" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

// Every admin route re-checks the session is active before running its
// own query, so each test queues that check first.
function mockActiveSession() {
  pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
}

describe("Admin Read-Only APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("every admin route rejects a missing access token with 401, no DB call", async () => {
    const routes = [
      "/api/admin/dashboard/summary",
      "/api/admin/products",
      "/api/admin/categories",
      "/api/admin/orders",
      "/api/admin/orders/ORD-20261013-ABCDEF0123",
    ];

    for (const route of routes) {
      const response = await request(app).get(route);
      expect(response.status).toBe(401);
    }

    expect(pool.query).not.toHaveBeenCalled();
  });

  describe("GET /api/admin/dashboard/summary", () => {
    test("returns aggregated counts", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({
          rows: [{ total: 10, pending_payment: 2, processing: 5, fulfillment_blocked: 0 }],
        })
        .mockResolvedValueOnce({ rows: [{ total: 4, published: 3 }] })
        .mockResolvedValueOnce({ rows: [{ total: 2, active: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total: "15490.00" }] });

      const response = await request(app)
        .get("/api/admin/dashboard/summary")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.orders.total).toBe(10);
      expect(response.body.data.paidRevenue).toBe("15490.00");
    });
  });

  describe("GET /api/admin/products", () => {
    test("rejects invalid pagination with 400, no products query", async () => {
      mockActiveSession();

      const response = await request(app)
        .get("/api/admin/products?page=0")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(400);
      expect(pool.query).toHaveBeenCalledTimes(1); // only the session check
    });

    test("returns products including unpublished ones", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 1, name: "Draft Product", is_published: false }],
        });

      const response = await request(app)
        .get("/api/admin/products")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data[0].is_published).toBe(false);
      expect(response.body.pagination.total).toBe(1);
    });
  });

  describe("GET /api/admin/categories", () => {
    test("returns categories including inactive ones", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 1, name: "Archived", is_active: false }],
      });

      const response = await request(app)
        .get("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data[0].is_active).toBe(false);
    });
  });

  describe("GET /api/admin/orders", () => {
    test("returns paginated orders", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({ rows: [{ total: 1 }] })
        .mockResolvedValueOnce({
          rows: [{ order_number: "ORD-20261013-ABCDEF0123", status: "processing" }],
        });

      const response = await request(app)
        .get("/api/admin/orders")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
    });

    test("ignores an invalid status filter value rather than erroring", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({ rows: [{ total: 0 }] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get("/api/admin/orders?status=not-a-real-status")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      // The bogus filter value must never reach the query as a bound param.
      expect(pool.query).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(["not-a-real-status"])
      );
    });
  });

  describe("GET /api/admin/orders/:orderNumber", () => {
    test("returns 404 for an unknown order number", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get("/api/admin/orders/ORD-00000000-0000000000")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(404);
    });

    test("returns order detail with items and payment attempts", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 5, order_number: "ORD-20261013-ABCDEF0123", status: "processing" }],
        })
        .mockResolvedValueOnce({ rows: [{ product_name: "Cotton Bedsheet", quantity: 2 }] })
        .mockResolvedValueOnce({ rows: [{ status: "captured", razorpay_payment_id: "pay_123" }] });

      const response = await request(app)
        .get("/api/admin/orders/ORD-20261013-ABCDEF0123")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.order.order_number).toBe("ORD-20261013-ABCDEF0123");
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.payments[0].status).toBe("captured");
    });
  });
});
