jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const request = require("supertest");
const pool = require("../src/config/db");
const app = require("../src/app");

const VALID_TOKEN = "a".repeat(64);

function makeClient() {
  return {
    query: jest.fn(),
    release: jest.fn(),
  };
}

describe("Guest Cart APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/cart (create cart)", () => {
    test("creates a cart and returns a raw token + expiry", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ expires_at: "2026-11-12T00:00:00.000Z" }],
      });

      const response = await request(app).post("/api/cart");

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.cartToken).toMatch(/^[a-f0-9]{64}$/);
      expect(response.body.data.expiresAt).toBe("2026-11-12T00:00:00.000Z");
    });
  });

  describe("Guest token validation", () => {
    test("GET /api/cart without a token returns 401", async () => {
      const response = await request(app).get("/api/cart");

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("GET /api/cart with a malformed token returns 401", async () => {
      const response = await request(app)
        .get("/api/cart")
        .set("X-Cart-Token", "not-a-valid-token");

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("GET /api/cart with an expired/unknown token returns 401", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get("/api/cart")
        .set("X-Cart-Token", VALID_TOKEN);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe("GET /api/cart", () => {
    test("returns an empty cart with zero total", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // guestCart lookup
        .mockResolvedValueOnce({ rows: [] }) // items
        .mockResolvedValueOnce({ rows: [{ total: "0.00" }] }); // total

      const response = await request(app)
        .get("/api/cart")
        .set("X-Cart-Token", VALID_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual([]);
      expect(response.body.data.total).toBe("0.00");
    });
  });

  describe("POST /api/cart/items", () => {
    test("adds a valid product to the cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // guestCart lookup

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: true }],
        }) // product lookup
        .mockResolvedValueOnce({ rows: [] }) // existing cart_items lookup
        .mockResolvedValueOnce({}) // INSERT cart_items
        .mockResolvedValueOnce({}) // UPDATE carts.updated_at
        .mockResolvedValueOnce({
          rows: [
            {
              product_id: 5,
              name: "Cotton Sheet",
              slug: "cotton-sheet",
              image_url: null,
              unit_price: "500.00",
              quantity: 2,
              line_total: "1000.00",
              available_stock: 10,
              is_published: true,
              is_available: true,
            },
          ],
        }) // snapshot items
        .mockResolvedValueOnce({ rows: [{ total: "1000.00" }] }) // snapshot total
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 5, quantity: 2 });

      expect(response.status).toBe(200);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.total).toBe("1000.00");
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();
    });

    test("returns 404 for a nonexistent product", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // product not found
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 999, quantity: 1 });

      expect(response.status).toBe(404);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalled();
    });

    test("returns 404 for an unpublished product", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: false }],
        })
        .mockResolvedValueOnce({});

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 7, quantity: 1 });

      expect(response.status).toBe(404);
    });

    test("rejects an invalid (zero) quantity with 400", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 1, quantity: 0 });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("returns 409 when requested quantity exceeds stock", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 3, is_published: true }],
        }) // product
        .mockResolvedValueOnce({ rows: [] }) // no existing item
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 3, quantity: 5 });

      expect(response.status).toBe(409);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    test("increments quantity when the product is already in the cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: true }],
        })
        .mockResolvedValueOnce({ rows: [{ quantity: 3 }] }) // existing qty 3
        .mockResolvedValueOnce({}) // UPDATE cart_items
        .mockResolvedValueOnce({}) // UPDATE carts
        .mockResolvedValueOnce({ rows: [] }) // snapshot items
        .mockResolvedValueOnce({ rows: [{ total: "0.00" }] })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 3, quantity: 2 });

      expect(response.status).toBe(200);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE cart_items"),
        [5, 1, 3]
      );
    });
  });

  describe("PATCH /api/cart/items/:productId", () => {
    test("updates quantity to the exact requested value", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: true }],
        }) // product
        .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // existing cart item
        .mockResolvedValueOnce({}) // UPDATE cart_items
        .mockResolvedValueOnce({}) // UPDATE carts
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total: "0.00" }] })
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .patch("/api/cart/items/3")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ quantity: 7 });

      expect(response.status).toBe(200);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
    });

    test("returns 404 when the item is not in the cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: true }],
        })
        .mockResolvedValueOnce({ rows: [] }) // not in cart
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .patch("/api/cart/items/3")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ quantity: 2 });

      expect(response.status).toBe(404);
    });

    test("returns 409 when the requested quantity exceeds stock", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 4, is_published: true }],
        })
        .mockResolvedValueOnce({ rows: [{ id: 42 }] })
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .patch("/api/cart/items/3")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ quantity: 20 });

      expect(response.status).toBe(409);
    });
  });

  describe("DELETE /api/cart/items/:productId", () => {
    test("removes an existing item", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // guestCart lookup
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 99 }] }) // DELETE
        .mockResolvedValueOnce({ rows: [] }) // snapshot items
        .mockResolvedValueOnce({ rows: [{ total: "0.00" }] }); // snapshot total

      const response = await request(app)
        .delete("/api/cart/items/3")
        .set("X-Cart-Token", VALID_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body.data.items).toEqual([]);
    });

    test("returns 404 when the item does not exist in the cart", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const response = await request(app)
        .delete("/api/cart/items/3")
        .set("X-Cart-Token", VALID_TOKEN);

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/cart (empty cart)", () => {
    test("removes all items and returns a zero total", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // guestCart lookup
        .mockResolvedValueOnce({}); // DELETE FROM cart_items

      const response = await request(app)
        .delete("/api/cart")
        .set("X-Cart-Token", VALID_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({ items: [], total: "0.00" });
    });
  });

  describe("Transaction rollback on database failure", () => {
    test("rolls back and releases the client when a write fails", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ stock_quantity: 10, is_published: true }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error("connection terminated")) // INSERT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .send({ productId: 1, quantity: 1 });

      expect(response.status).toBe(500);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe("Invalid JSON body", () => {
    test("rejects malformed JSON with 400", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/cart/items")
        .set("X-Cart-Token", VALID_TOKEN)
        .set("Content-Type", "application/json")
        .send('{"productId": 1, "quantity": }');

      expect(response.status).toBe(400);
    });
  });
});
