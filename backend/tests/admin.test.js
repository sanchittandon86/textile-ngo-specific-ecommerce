jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../src/services/cloudinary.service", () => ({
  uploadCategoryImage: jest.fn(),
  deleteCategoryImage: jest.fn(),
}));

process.env.JWT_SECRET = "test_jwt_secret";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const pool = require("../src/config/db");
const { uploadCategoryImage, deleteCategoryImage } = require("../src/services/cloudinary.service");
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
      "/api/admin/analytics",
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

  describe("GET /api/admin/analytics", () => {
    // Pg's DATE parser returns a Date built from UTC date components
    // matching the stored calendar date -- mirrored here so mocked rows
    // look like what pool.query would really return.
    function pgDate(isoDate) {
      return new Date(`${isoDate}T00:00:00.000Z`);
    }

    function todayIST() {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    }

    test("rejects without an access token", async () => {
      const response = await request(app).get("/api/admin/analytics");
      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects an unsupported days value with 400", async () => {
      mockActiveSession();

      const response = await request(app)
        .get("/api/admin/analytics?days=15")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(400);
      expect(pool.query).toHaveBeenCalledTimes(1); // only the session check
    });

    test("defaults to 30 days and zero-fills days with no activity", async () => {
      mockActiveSession();
      const today = todayIST();
      pool.query
        .mockResolvedValueOnce({ rows: [{ day: pgDate(today), revenue: "500.00" }] })
        .mockResolvedValueOnce({ rows: [{ day: pgDate(today), count: 2 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              product_id: 7,
              product_name: "Hand Block Print Tote Bag",
              product_slug: "hand-block-print-tote-bag",
              quantity_sold: 3,
              revenue: "2697.00",
            },
          ],
        });

      const response = await request(app)
        .get("/api/admin/analytics")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.days).toBe(30);
      expect(response.body.data.revenueByDay).toHaveLength(30);
      expect(response.body.data.ordersByDay).toHaveLength(30);

      const todayRevenueEntry = response.body.data.revenueByDay.find((d) => d.date === today);
      expect(todayRevenueEntry.revenue).toBe("500.00");

      const zeroDay = response.body.data.revenueByDay.find((d) => d.date !== today);
      expect(zeroDay.revenue).toBe("0.00");

      expect(response.body.data.topProducts[0].name).toBe("Hand Block Print Tote Bag");
      expect(response.body.data.topProducts[0].quantitySold).toBe(3);
    });

    test("accepts days=7", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get("/api/admin/analytics?days=7")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.body.data.days).toBe(7);
      expect(response.body.data.revenueByDay).toHaveLength(7);
      expect(response.body.data.topProducts).toEqual([]);
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

  describe("POST /api/admin/categories", () => {
    test("rejects without an access token", async () => {
      const response = await request(app).post("/api/admin/categories").send({ name: "Scarves" });
      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects a missing name with 400, no DB call", async () => {
      mockActiveSession();

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "   " });

      expect(response.status).toBe(400);
      expect(pool.query).toHaveBeenCalledTimes(1); // only the session check
    });

    test("rejects a duplicate category (matched by normalized slug)", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({ rows: [{ id: 3 }] }); // existing slug match

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "  Bags  " });

      expect(response.status).toBe(409);
      expect(uploadCategoryImage).not.toHaveBeenCalled();
    });

    test("creates a category without an image", async () => {
      mockActiveSession();
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // no existing slug
        .mockResolvedValueOnce({
          rows: [{ id: 9, name: "Scarves", slug: "scarves", image_url: null, is_active: true }],
        });

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Scarves" });

      expect(response.status).toBe(201);
      expect(response.body.data.slug).toBe("scarves");
      expect(uploadCategoryImage).not.toHaveBeenCalled();
    });

    test("creates a category with an image, uploading via Cloudinary", async () => {
      mockActiveSession();
      uploadCategoryImage.mockResolvedValueOnce({
        secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/textile-store/categories/scarves/image.jpg",
        publicId: "textile-store/categories/scarves/image",
      });
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ id: 9, name: "Scarves", slug: "scarves", image_url: "https://res.cloudinary.com/x.jpg", is_active: true }],
        });

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Scarves", imageUrl: "https://example.com/scarf.jpg" });

      expect(response.status).toBe(201);
      expect(uploadCategoryImage).toHaveBeenCalledWith("https://example.com/scarf.jpg", { slug: "scarves" });
    });

    test("returns 502 and skips the DB insert when the Cloudinary upload fails", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({ rows: [] }); // no existing slug
      uploadCategoryImage.mockRejectedValueOnce(new Error("cloudinary down"));

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Scarves", imageUrl: "https://example.com/scarf.jpg" });

      expect(response.status).toBe(502);
      expect(pool.query).toHaveBeenCalledTimes(2); // session check + slug lookup only
    });

    test("cleans up the uploaded Cloudinary asset if the DB insert fails", async () => {
      mockActiveSession();
      uploadCategoryImage.mockResolvedValueOnce({
        secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/textile-store/categories/scarves/image.jpg",
        publicId: "textile-store/categories/scarves/image",
      });
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // no existing slug
        .mockRejectedValueOnce(new Error("insert failed")); // DB insert itself fails

      const response = await request(app)
        .post("/api/admin/categories")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ name: "Scarves", imageUrl: "https://example.com/scarf.jpg" });

      expect(response.status).toBe(500);
      expect(deleteCategoryImage).toHaveBeenCalledWith("textile-store/categories/scarves/image");
    });
  });

  describe("PATCH /api/admin/categories/:id/status", () => {
    test("rejects without an access token", async () => {
      const response = await request(app).patch("/api/admin/categories/3/status").send({ isActive: false });
      expect(response.status).toBe(401);
    });

    test("rejects a non-boolean isActive with 400", async () => {
      mockActiveSession();

      const response = await request(app)
        .patch("/api/admin/categories/3/status")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ isActive: "false" });

      expect(response.status).toBe(400);
    });

    test("deactivates a category", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({
        rows: [{ id: 3, name: "Bags", slug: "bags", is_active: false }],
      });

      const response = await request(app)
        .patch("/api/admin/categories/3/status")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ isActive: false });

      expect(response.status).toBe(200);
      expect(response.body.data.is_active).toBe(false);
    });

    test("returns 404 for an unknown category id", async () => {
      mockActiveSession();
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .patch("/api/admin/categories/999/status")
        .set("Authorization", `Bearer ${adminToken()}`)
        .send({ isActive: true });

      expect(response.status).toBe(404);
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
