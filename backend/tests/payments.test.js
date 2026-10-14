jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../src/config/razorpay", () => ({
  getRazorpay: jest.fn(),
}));

const crypto = require("crypto");
const request = require("supertest");
const pool = require("../src/config/db");
const { getRazorpay } = require("../src/config/razorpay");

process.env.RAZORPAY_KEY_ID = "rzp_test_fakekeyid";
process.env.RAZORPAY_KEY_SECRET = "test_key_secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";

const app = require("../src/app");

const VALID_ORDER_TOKEN = "b".repeat(64);
const ORDER_NUMBER = "ORD-20261013-ABCDEF0123";
const RAZORPAY_ORDER_ID = "order_RAZORPAYFAKE123";
const RAZORPAY_PAYMENT_ID = "pay_RAZORPAYFAKE456";

function makeClient() {
  return { query: jest.fn(), release: jest.fn() };
}

function unpaidOrderRow(overrides = {}) {
  return {
    id: 1,
    order_number: ORDER_NUMBER,
    status: "pending_payment",
    payment_status: "pending",
    payment_method: "online",
    customer_name: "Test Customer",
    customer_email: "customer@example.com",
    customer_phone: "9876543210",
    subtotal: "2998.00",
    shipping_fee: "50.00",
    discount_amount: "0.00",
    total_amount: "3048.00",
    currency: "INR",
    created_at: "2026-10-13T10:00:00.000Z",
    ...overrides,
  };
}

function validPaymentSignature(orderId, paymentId) {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
}

function validWebhookSignature(rawBody) {
  return crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
}

// Queues the client.query sequence for capturePayment()'s happy path:
// BEGIN, lock payment, lock order, read order_items, lock products,
// decrement stock, mark payment captured, mark order paid, COMMIT.
function mockCaptureHappyPath(client, { quantity = 2, orderNumber = ORDER_NUMBER } = {}) {
  client.query
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 1, status: "created" }] }) // lock payment
    .mockResolvedValueOnce({ rows: [{ id: 1, order_number: orderNumber }] }) // lock order
    .mockResolvedValueOnce({ rows: [{ product_id: 5, quantity }] }) // order_items
    .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // lock products
    .mockResolvedValueOnce({ rowCount: 1 }) // UPDATE products stock (success)
    .mockResolvedValueOnce({}) // UPDATE payments captured
    .mockResolvedValueOnce({}) // UPDATE orders paid
    .mockResolvedValueOnce({}); // COMMIT
}

describe("Razorpay Payment APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/payments/create-order", () => {
    test("creates a Razorpay order for a valid unpaid order", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] }) // findOrderByAccessToken
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // INSERT payments (reserve slot)
        .mockResolvedValueOnce({ rows: [{ amount_paise: "304800" }] }) // amount conversion
        .mockResolvedValueOnce({}); // UPDATE payments with razorpay_order_id

      const create = jest.fn().mockResolvedValueOnce({
        id: RAZORPAY_ORDER_ID,
        amount: 304800,
        currency: "INR",
      });
      getRazorpay.mockReturnValue({ orders: { create } });

      const response = await request(app)
        .post("/api/payments/create-order")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({ orderNumber: ORDER_NUMBER });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.razorpayOrderId).toBe(RAZORPAY_ORDER_ID);
      expect(response.body.data.amount).toBe("3048.00");
      expect(response.body.data.currency).toBe("INR");
      expect(response.body.data.keyId).toBe(process.env.RAZORPAY_KEY_ID);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 304800, currency: "INR" })
      );
    });

    test("rejects a missing order access token with 401, no DB call", async () => {
      const response = await request(app)
        .post("/api/payments/create-order")
        .send({ orderNumber: ORDER_NUMBER });

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rejects an unknown order number / wrong token with a generic 404", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post("/api/payments/create-order")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({ orderNumber: ORDER_NUMBER });

      expect(response.status).toBe(404);
    });

    test("rejects payment creation for an already-paid order with 409", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [unpaidOrderRow({ status: "processing", payment_status: "paid" })],
      });

      const response = await request(app)
        .post("/api/payments/create-order")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({ orderNumber: ORDER_NUMBER });

      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/already been paid/i);
      expect(pool.query).toHaveBeenCalledTimes(1);
      expect(getRazorpay).not.toHaveBeenCalled();
    });

    test("marks the attempt failed and returns 500 if the Razorpay API call fails", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] })
        .mockResolvedValueOnce({ rows: [{ id: 7 }] })
        .mockResolvedValueOnce({ rows: [{ amount_paise: "304800" }] })
        .mockResolvedValueOnce({}); // UPDATE payments SET status='failed'

      const create = jest.fn().mockRejectedValueOnce(new Error("Razorpay auth failed"));
      getRazorpay.mockReturnValue({ orders: { create } });

      const response = await request(app)
        .post("/api/payments/create-order")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({ orderNumber: ORDER_NUMBER });

      expect(response.status).toBe(500);
      expect(pool.query).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining("status = 'failed'"),
        expect.arrayContaining([expect.anything(), 7])
      );
    });
  });

  describe("POST /api/payments/verify", () => {
    test("successfully verifies payment, captures it, and decrements stock", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] }) // findOrderByAccessToken
        .mockResolvedValueOnce({ rows: [{ id: 7, status: "created" }] }); // payment lookup

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      mockCaptureHappyPath(client);

      const signature = validPaymentSignature(RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID);

      const response = await request(app)
        .post("/api/payments/verify")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: RAZORPAY_ORDER_ID,
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: signature,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.status).toBe("processing");
      expect(response.body.data.paymentStatus).toBe("paid");
      expect(response.body.data.alreadyProcessed).toBe(false);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();
    });

    test("duplicate verification requests are idempotent (second call short-circuits)", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] })
        .mockResolvedValueOnce({ rows: [{ id: 7, status: "captured" }] }); // already captured

      const signature = validPaymentSignature(RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID);

      const response = await request(app)
        .post("/api/payments/verify")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: RAZORPAY_ORDER_ID,
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: signature,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.alreadyProcessed).toBe(true);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    test("rejects an invalid signature with 400 and marks the attempt failed", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] })
        .mockResolvedValueOnce({ rows: [{ id: 7, status: "created" }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ status: "created" }] }) // lock payment
        .mockResolvedValueOnce({}) // UPDATE payments SET failed
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post("/api/payments/verify")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: RAZORPAY_ORDER_ID,
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: "f".repeat(64), // well-formed but wrong
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/invalid payment signature/i);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
    });

    test("rejects a mismatched Razorpay order ID with 400", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] })
        .mockResolvedValueOnce({ rows: [] }); // no payment row for this order+razorpayOrderId combo

      const signature = validPaymentSignature(RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID);

      const response = await request(app)
        .post("/api/payments/verify")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: "order_SOMEOTHERORDERID9",
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: signature,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/does not match this order/i);
    });

    test("rejects unauthorized guest-order access with 401", async () => {
      const response = await request(app)
        .post("/api/payments/verify")
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: RAZORPAY_ORDER_ID,
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: "a".repeat(64),
        });

      expect(response.status).toBe(401);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("rolls back and releases the client on a database failure during capture", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [unpaidOrderRow()] })
        .mockResolvedValueOnce({ rows: [{ id: 7, status: "created" }] });

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 1, status: "created" }] }) // lock payment
        .mockRejectedValueOnce(new Error("connection terminated")) // lock order fails
        .mockResolvedValueOnce({}); // ROLLBACK

      const signature = validPaymentSignature(RAZORPAY_ORDER_ID, RAZORPAY_PAYMENT_ID);

      const response = await request(app)
        .post("/api/payments/verify")
        .set("X-Order-Token", VALID_ORDER_TOKEN)
        .send({
          orderNumber: ORDER_NUMBER,
          razorpayOrderId: RAZORPAY_ORDER_ID,
          razorpayPaymentId: RAZORPAY_PAYMENT_ID,
          razorpaySignature: signature,
        });

      expect(response.status).toBe(500);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe("POST /api/payments/webhook", () => {
    function webhookBody(eventType, { orderId = RAZORPAY_ORDER_ID, paymentId = RAZORPAY_PAYMENT_ID, eventId = "evt_1" } = {}) {
      return JSON.stringify({
        id: eventId,
        event: eventType,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              status: eventType === "payment.captured" ? "captured" : "failed",
              error_description: eventType === "payment.failed" ? "card declined" : undefined,
            },
          },
        },
      });
    }

    test("accepts a valid webhook signature and captures the payment", async () => {
      const body = webhookBody("payment.captured");
      const signature = validWebhookSignature(body);

      pool.query
        .mockResolvedValueOnce({}) // INSERT payment_webhook_events
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // payments lookup by razorpay_order_id

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      mockCaptureHappyPath(client);

      const response = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
    });

    test("rejects an invalid webhook signature with 400, without touching the DB", async () => {
      const body = webhookBody("payment.captured");

      const response = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", "0".repeat(64))
        .send(body);

      expect(response.status).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
    });

    test("acknowledges a duplicate webhook delivery without reprocessing", async () => {
      const body = webhookBody("payment.captured", { eventId: "evt_dup" });
      const signature = validWebhookSignature(body);

      const duplicateError = new Error("duplicate key value");
      duplicateError.code = "23505";
      pool.query.mockRejectedValueOnce(duplicateError); // INSERT payment_webhook_events conflicts

      const response = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(response.body.message).toMatch(/duplicate/i);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    test("a failed-payment event never overwrites an already-captured payment", async () => {
      const body = webhookBody("payment.failed", { eventId: "evt_failed_after_captured" });
      const signature = validWebhookSignature(body);

      pool.query
        .mockResolvedValueOnce({}) // INSERT payment_webhook_events
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }); // payments lookup

      const client = makeClient();
      pool.connect.mockResolvedValueOnce(client);
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ status: "captured" }] }) // lock payment -- already captured
        .mockResolvedValueOnce({}); // ROLLBACK (no-op, never downgrades)

      const response = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .send(body);

      expect(response.status).toBe(200);
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.query).not.toHaveBeenCalledWith(
        expect.stringContaining("status = 'failed'"),
        expect.anything()
      );
    });

    test("a failed attempt followed by a successful retry leaves the order paid", async () => {
      // Attempt 1 fails.
      const failedBody = webhookBody("payment.failed", {
        orderId: "order_ATTEMPT1FAILED",
        paymentId: "pay_ATTEMPT1FAILED",
        eventId: "evt_attempt1_failed",
      });
      const failedSignature = validWebhookSignature(failedBody);

      pool.query
        .mockResolvedValueOnce({}) // INSERT payment_webhook_events
        .mockResolvedValueOnce({ rows: [{ id: 10 }] }); // payments lookup for attempt 1

      const failClient = makeClient();
      pool.connect.mockResolvedValueOnce(failClient);
      failClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ status: "created" }] }) // lock payment 1
        .mockResolvedValueOnce({}) // UPDATE payments SET failed
        .mockResolvedValueOnce({}); // COMMIT

      const failResponse = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", failedSignature)
        .send(failedBody);

      expect(failResponse.status).toBe(200);

      // Attempt 2 (retry) succeeds.
      const capturedBody = webhookBody("payment.captured", {
        orderId: "order_ATTEMPT2SUCCESS",
        paymentId: "pay_ATTEMPT2SUCCESS",
        eventId: "evt_attempt2_captured",
      });
      const capturedSignature = validWebhookSignature(capturedBody);

      pool.query
        .mockResolvedValueOnce({}) // INSERT payment_webhook_events
        .mockResolvedValueOnce({ rows: [{ id: 11 }] }); // payments lookup for attempt 2

      const captureClient = makeClient();
      pool.connect.mockResolvedValueOnce(captureClient);
      mockCaptureHappyPath(captureClient);

      const captureResponse = await request(app)
        .post("/api/payments/webhook")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", capturedSignature)
        .send(capturedBody);

      expect(captureResponse.status).toBe(200);
      expect(captureClient.query).toHaveBeenCalledWith("COMMIT");
    });
  });
});
