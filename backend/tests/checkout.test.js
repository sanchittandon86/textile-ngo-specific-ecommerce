jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const request = require("supertest");
const pool = require("../src/config/db");
const app = require("../src/app");

const VALID_CART_TOKEN = "a".repeat(64);
const VALID_ORDER_TOKEN = "b".repeat(64);

const VALID_PAYLOAD = {
  customer: {
    name: "Test Customer",
    email: "customer@example.com",
    phone: "9876543210",
  },
  shippingAddress: {
    line1: "123 Example Road",
    line2: "Near Main Market",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    country: "India",
  },
  paymentMethod: "online",
};

function makeClient() {
  return {
    query: jest.fn(),
    release: jest.fn(),
  };
}

// Queues up the standard happy-path sequence of client.query calls for a
// single-item Razorpay checkout, starting right after BEGIN. Stock is
// NOT decremented here -- checkout only validates availability; the
// decrement happens later at payment-confirmation time (see
// tests/payments.test.js).
function mockHappyPathQueries(client, { stock = 10 } = {}) {
  client.query
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 2 }] }) // DELETE cart_items RETURNING
    .mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Cotton Bedsheet",
          slug: "cotton-bedsheet",
          price: "1499.00",
          stock_quantity: stock,
          is_published: true,
        },
      ],
    }) // products FOR UPDATE
    .mockResolvedValueOnce({ rows: [{ subtotal: "2998.00" }] }) // subtotal
    .mockResolvedValueOnce({ rows: [{ total: "3048.00" }] }) // total
    .mockResolvedValueOnce({
      rows: [
        {
          id: 42,
          order_number: "ORD-20261013-ABCDEF0123",
          status: "pending_payment",
          payment_status: "pending",
          payment_method: "online",
          subtotal: "2998.00",
          shipping_fee: "50.00",
          discount_amount: "0.00",
          total_amount: "3048.00",
          currency: "INR",
          created_at: "2026-10-13T10:00:00.000Z",
        },
      ],
    }) // INSERT orders
    .mockResolvedValueOnce({
      rows: [
        {
          product_id: 1,
          name: "Cotton Bedsheet",
          slug: "cotton-bedsheet",
          unit_price: "1499.00",
          quantity: 2,
          line_total: "2998.00",
        },
      ],
    }) // INSERT order_items RETURNING
    .mockResolvedValueOnce({}) // UPDATE carts.updated_at
    .mockResolvedValueOnce({}); // COMMIT
}

describe("Guest Checkout APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/checkout", () => {
    test("successful checkout creates an unpaid order awaiting Razorpay payment and clears the cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // guestCart lookup

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      mockHappyPathQueries(client);

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.orderNumber).toBe("ORD-20261013-ABCDEF0123");
      expect(response.body.data.orderToken).toMatch(/^[a-f0-9]{64}$/);
      expect(response.body.data.status).toBe("pending_payment");
      expect(response.body.data.paymentStatus).toBe("pending");
      expect(response.body.data.totalAmount).toBe("3048.00");
      expect(response.body.data.items).toHaveLength(1);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM cart_items"),
        [1]
      );
      expect(client.release).toHaveBeenCalled();
    });

    test("rejects checkout with an empty cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // DELETE cart_items -> nothing deleted
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/empty/i);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    test("rejects checkout with a missing cart token", async () => {
      const response = await request(app)
        .post("/api/checkout")
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects checkout with a malformed cart token", async () => {
      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", "nope")
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects invalid customer data (bad phone) with 400, no DB write", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send({ ...VALID_PAYLOAD, customer: { ...VALID_PAYLOAD.customer, phone: "123" } });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects invalid shipping address with 400", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send({ ...VALID_PAYLOAD, shippingAddress: { ...VALID_PAYLOAD.shippingAddress, city: "" } });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects an unsupported payment method with 400", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send({ ...VALID_PAYLOAD, paymentMethod: "bitcoin" });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects 'cod' with 400 -- Razorpay is the only supported payment method", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send({ ...VALID_PAYLOAD, paymentMethod: "cod" });

      expect(response.status).toBe(400);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects checkout when a cart item is out of stock (409) and does not clear the cart", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 50 }] }) // DELETE cart_items
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              name: "Cotton Bedsheet",
              slug: "cotton-bedsheet",
              price: "1499.00",
              stock_quantity: 5,
              is_published: true,
            },
          ],
        }) // products FOR UPDATE - insufficient stock
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(409);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.query).not.toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO orders"),
        expect.anything()
      );
    });

    test("rejects checkout when a cart item's product no longer exists/is unpublished (404)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 2 }] }) // DELETE cart_items
        .mockResolvedValueOnce({ rows: [] }) // products FOR UPDATE -> product gone
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(404);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
    });

    test("ignores any client-supplied price/total and computes everything server-side", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      mockHappyPathQueries(client);

      const tamperedPayload = {
        ...VALID_PAYLOAD,
        subtotal: "1.00",
        totalAmount: "1.00",
        items: [{ productId: 1, unitPrice: "1.00", quantity: 2 }],
      };

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(tamperedPayload);

      expect(response.status).toBe(201);
      // Server-side mocked DB values win regardless of the tampered body.
      expect(response.body.data.totalAmount).toBe("3048.00");
      expect(response.body.data.items[0].unitPrice).toBe("1499.00");
    });

    test("rolls back and releases the client on a database failure", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ product_id: 1, quantity: 2 }] }) // DELETE cart_items
        .mockRejectedValueOnce(new Error("connection terminated")) // products query fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post("/api/checkout")
        .set("X-Cart-Token", VALID_CART_TOKEN)
        .send(VALID_PAYLOAD);

      expect(response.status).toBe(500);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe("GET /api/checkout/summary", () => {
    test("returns server-computed subtotal/shipping/estimated total", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // guestCart lookup
        .mockResolvedValueOnce({
          rows: [
            {
              product_id: 1,
              name: "Cotton Bedsheet",
              slug: "cotton-bedsheet",
              image_url: null,
              unit_price: "1499.00",
              quantity: 2,
              line_total: "2998.00",
              available_stock: 10,
              is_published: true,
              is_available: true,
            },
          ],
        }) // snapshot items
        .mockResolvedValueOnce({ rows: [{ total: "2998.00" }] }) // snapshot total
        .mockResolvedValueOnce({ rows: [{ estimated_total: "3048.00" }] }); // shipping add

      const response = await request(app)
        .get("/api/checkout/summary")
        .set("X-Cart-Token", VALID_CART_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body.data.subtotal).toBe("2998.00");
      expect(response.body.data.shippingFee).toBe("50.00");
      expect(response.body.data.estimatedTotal).toBe("3048.00");
    });
  });

  describe("GET /api/orders/:orderNumber", () => {
    test("returns order details with a valid order number + token", async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 42,
              order_number: "ORD-20261013-ABCDEF0123",
              status: "pending_payment",
              payment_status: "pending",
              payment_method: "online",
              customer_name: "Test Customer",
              customer_email: "customer@example.com",
              customer_phone: "9876543210",
              shipping_address_line1: "123 Example Road",
              shipping_address_line2: null,
              shipping_city: "Mumbai",
              shipping_state: "Maharashtra",
              shipping_postal_code: "400001",
              shipping_country: "India",
              subtotal: "2998.00",
              shipping_fee: "50.00",
              discount_amount: "0.00",
              total_amount: "3048.00",
              currency: "INR",
              created_at: "2026-10-13T10:00:00.000Z",
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              product_id: 1,
              name: "Cotton Bedsheet",
              slug: "cotton-bedsheet",
              unit_price: "1499.00",
              quantity: 2,
              line_total: "2998.00",
            },
          ],
        });

      const response = await request(app)
        .get("/api/orders/ORD-20261013-ABCDEF0123")
        .set("X-Order-Token", VALID_ORDER_TOKEN);

      expect(response.status).toBe(200);
      expect(response.body.data.orderNumber).toBe("ORD-20261013-ABCDEF0123");
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.totalAmount).toBe("3048.00");
      expect(JSON.stringify(response.body)).not.toMatch(/token_hash/i);
    });

    test("rejects a missing order token with 401", async () => {
      const response = await request(app).get(
        "/api/orders/ORD-20261013-ABCDEF0123"
      );

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects an unknown order number / wrong token with a generic 404", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get("/api/orders/ORD-20261013-ABCDEF0123")
        .set("X-Order-Token", VALID_ORDER_TOKEN);

      expect(response.status).toBe(404);
      expect(response.body.message).toBe("Order not found");
    });

    test("rejects a malformed order number with 400 before touching the DB", async () => {
      const response = await request(app)
        .get("/api/orders/not-a-real-order")
        .set("X-Order-Token", VALID_ORDER_TOKEN);

      expect(response.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    });
  });
});
