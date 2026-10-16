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

    test("returns order detail with items, payment attempts, and status history", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({
          rows: [{ id: 5, order_number: "ORD-20261013-ABCDEF0123", status: "processing" }],
        })
        .mockResolvedValueOnce({ rows: [{ product_name: "Cotton Bedsheet", quantity: 2 }] })
        .mockResolvedValueOnce({ rows: [{ status: "captured", razorpay_payment_id: "pay_123" }] })
        .mockResolvedValueOnce({
          rows: [{ from_status: "pending_payment", to_status: "processing" }],
        });

      const response = await request(app)
        .get("/api/admin/orders/ORD-20261013-ABCDEF0123")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.order.order_number).toBe("ORD-20261013-ABCDEF0123");
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.payments[0].status).toBe("captured");
      expect(response.body.data.statusHistory[0].to_status).toBe("processing");
    });
  });

  describe("PATCH /api/admin/orders/:orderNumber/status", () => {
    function setupClient(currentStatus) {
      const calls = [];
      const client = {
        query: jest.fn(async (sql, params = []) => {
          calls.push({ sql, params });
          if (sql.includes("FOR UPDATE")) {
            return { rows: [{ id: 5, status: currentStatus }] };
          }
          if (sql.startsWith("UPDATE orders")) {
            return {
              rows: [
                {
                  id: 5,
                  order_number: "ORD-20261013-ABCDEF0123",
                  status: params[0],
                  tracking_carrier: params.length > 3 ? params[1] : null,
                  tracking_number: params.length > 3 ? params[2] : null,
                },
              ],
            };
          }
          return {};
        }),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);
      return { client, calls };
    }

    function patch(body) {
      return request(app)
        .patch("/api/admin/orders/ORD-20261013-ABCDEF0123/status")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send(body);
    }

    test("rejects without an access token", async () => {
      const response = await request(app)
        .patch("/api/admin/orders/ORD-20261013-ABCDEF0123/status")
        .send({ status: "shipped", trackingCarrier: "BlueDart", trackingNumber: "BD123" });

      expect(response.status).toBe(401);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects an unsupported target status with 400, no DB transaction opened", async () => {
      mockActiveSession();

      const response = await patch({ status: "delivered_wrong" });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects processing -> shipped without tracking info", async () => {
      mockActiveSession();

      const response = await patch({ status: "shipped" });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("marks a processing order as shipped and records tracking + history", async () => {
      mockActiveSession();
      const { client, calls } = setupClient("processing");

      const response = await patch({
        status: "shipped",
        trackingCarrier: "BlueDart",
        trackingNumber: "BD123456789",
      });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe("shipped");
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(
        calls.some(
          (c) =>
            c.sql.startsWith("INSERT INTO order_status_history") &&
            c.params[1] === "processing" &&
            c.params[2] === "shipped"
        )
      ).toBe(true);
    });

    test("marks a shipped order as delivered", async () => {
      mockActiveSession();
      const { client } = setupClient("shipped");

      const response = await patch({ status: "delivered" });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe("delivered");
      expect(client.query).toHaveBeenCalledWith("COMMIT");
    });

    test("rejects shipping an order that is not currently processing", async () => {
      mockActiveSession();
      const { client } = setupClient("pending_payment");

      const response = await patch({
        status: "shipped",
        trackingCarrier: "BlueDart",
        trackingNumber: "BD123",
      });

      expect(response.status).toBe(409);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    test("returns 404 for an unknown order number", async () => {
      mockActiveSession();
      const client = {
        query: jest.fn(async (sql) => (sql.includes("FOR UPDATE") ? { rows: [] } : {})),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const response = await patch({ status: "delivered" });

      expect(response.status).toBe(404);
    });
  });
});
