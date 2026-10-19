const crypto = require("crypto");
const pool = require("../config/db");
const { getRazorpay } = require("../config/razorpay");
const { findOrderByAccessToken } = require("./checkout.service");
const { sendPaymentSuccessNotifications } = require("./notification.service");

const RAZORPAY_ORDER_ID_PATTERN = /^order_[A-Za-z0-9]+$/;
const RAZORPAY_PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]+$/;
const RAZORPAY_SIGNATURE_PATTERN = /^[a-f0-9]{64}$/i;

function timingSafeEqualHex(expectedHex, actualHex) {
  if (typeof expectedHex !== "string" || typeof actualHex !== "string") {
    return false;
  }

  const expectedBuf = Buffer.from(expectedHex, "hex");
  const actualBuf = Buffer.from(actualHex, "hex");

  if (
    expectedBuf.length === 0 ||
    actualBuf.length === 0 ||
    expectedBuf.length !== actualBuf.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Official documented formula for verifying a Razorpay Checkout payment:
// hmac_sha256(razorpay_order_id + "|" + razorpay_payment_id, key_secret).
function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  return timingSafeEqualHex(expected, signature);
}

// Official documented formula for verifying a Razorpay webhook delivery:
// hmac_sha256(raw_request_body, webhook_secret). Deliberately uses the
// separate webhook secret, never the API key secret.
function verifyWebhookSignature(rawBody, signature) {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  return timingSafeEqualHex(expected, signature);
}

// Decrements stock for an order's items and transitions the order/payment
// to their paid state. Idempotent and safe to call from both
// POST /api/payments/verify and the webhook: the payment row is locked
// with FOR UPDATE first, and if it's already 'captured' (the other path
// won the race), this is a no-op. Stock is therefore decremented exactly
// once per order, no matter how many times capture is triggered.
async function capturePayment(paymentId, razorpayPaymentId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paymentResult = await client.query(
      `SELECT id, order_id, status FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );
    const payment = paymentResult.rows[0];

    if (payment.status === "captured") {
      const existingOrder = await client.query(
        `SELECT order_number, status, payment_status FROM orders WHERE id = $1`,
        [payment.order_id]
      );
      await client.query("COMMIT");

      return {
        ok: true,
        data: {
          orderNumber: existingOrder.rows[0].order_number,
          status: existingOrder.rows[0].status,
          paymentStatus: existingOrder.rows[0].payment_status,
          alreadyProcessed: true,
        },
      };
    }

    const orderResult = await client.query(
      `SELECT id, order_number FROM orders WHERE id = $1 FOR UPDATE`,
      [payment.order_id]
    );
    const order = orderResult.rows[0];

    const itemsResult = await client.query(
      `SELECT product_id, quantity
       FROM order_items
       WHERE order_id = $1 AND product_id IS NOT NULL`,
      [order.id]
    );

    let stockFulfilled = true;

    if (itemsResult.rows.length > 0) {
      const productIds = itemsResult.rows.map((row) => row.product_id);

      // Lock in a consistent (ascending id) order, same convention as
      // checkout, to avoid deadlocking against a concurrent checkout that
      // also locks overlapping products.
      await client.query(
        `SELECT id FROM products WHERE id = ANY($1::bigint[]) ORDER BY id ASC FOR UPDATE`,
        [productIds]
      );

      for (const item of itemsResult.rows) {
        // Guarded decrement: only succeeds if enough stock remains. This
        // is the one and only place stock is decremented for an order.
        const decrementResult = await client.query(
          `UPDATE products
           SET stock_quantity = stock_quantity - $1
           WHERE id = $2 AND stock_quantity >= $1`,
          [item.quantity, item.product_id]
        );

        if (decrementResult.rowCount === 0) {
          stockFulfilled = false;
        }
      }
    }

    await client.query(
      `UPDATE payments
       SET status = 'captured', razorpay_payment_id = $1, verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [razorpayPaymentId, payment.id]
    );

    // Payment succeeded (Razorpay captured real money) regardless of
    // stock outcome -- we never claim automatic refunds, so an oversold
    // item is flagged for manual admin review instead of silently
    // reporting the order as normally processing.
    const newStatus = stockFulfilled ? "processing" : "paid_fulfillment_blocked";

    await client.query(
      `UPDATE orders
       SET payment_status = 'paid', status = $1, updated_at = NOW()
       WHERE id = $2`,
      [newStatus, order.id]
    );

    await client.query("COMMIT");

    // Fire-and-forget, after commit -- this is the single choke point
    // both POST /api/payments/verify and the Razorpay webhook funnel
    // through, and this code path only runs once per real capture (the
    // already-captured short-circuit above returns before reaching
    // here), so a duplicate webhook delivery can never trigger this
    // twice. Never awaited; notification.service.js never throws.
    sendPaymentSuccessNotifications(order.id).catch((error) => {
      // Belt-and-suspenders: notification.service.js is designed to
      // never reject, but this guarantees a defect there can still
      // never surface as an unhandled rejection or affect this response.
      console.error("[notifications] sendPaymentSuccessNotifications rejected unexpectedly:", error.message);
    });

    return {
      ok: true,
      data: {
        orderNumber: order.order_number,
        status: newStatus,
        paymentStatus: "paid",
        alreadyProcessed: false,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// A failed-payment event/callback must never downgrade or overwrite a
// payment that has already been successfully captured.
async function markPaymentFailedIfNotCaptured(paymentId, reason) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT status FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    );
    const payment = result.rows[0];

    if (!payment || payment.status === "captured") {
      await client.query("ROLLBACK");
      return { recorded: false };
    }

    await client.query(
      `UPDATE payments
       SET status = 'failed', failure_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [String(reason || "payment_failed").slice(0, 500), paymentId]
    );

    await client.query("COMMIT");
    return { recorded: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Creates (or resumes) a Razorpay order for an existing, unpaid guest
// order. Never trusts a client-supplied amount -- the amount always comes
// from orders.total_amount in the database.
async function createPaymentOrder(orderNumber, orderToken) {
  const lookup = await findOrderByAccessToken(orderNumber, orderToken);
  if (!lookup.ok) {
    return lookup;
  }

  const order = lookup.order;

  if (order.payment_status === "paid") {
    return { ok: false, status: 409, message: "Order has already been paid" };
  }

  if (order.status !== "pending_payment" || order.payment_status !== "pending") {
    return { ok: false, status: 409, message: "Order is not eligible for payment" };
  }

  // Reserve the one "active attempt" slot for this order. The partial
  // unique index on payments(order_id) WHERE status = 'created' is the
  // sole synchronization point -- it is what prevents two concurrent
  // create-order calls from both proceeding to call Razorpay.
  let payment;

  try {
    const insertResult = await pool.query(
      `INSERT INTO payments (order_id, currency, status)
       VALUES ($1, $2, 'created')
       RETURNING id`,
      [order.id, order.currency]
    );
    payment = insertResult.rows[0];
  } catch (error) {
    if (error.code === "23505") {
      const existingResult = await pool.query(
        `SELECT razorpay_order_id, amount, currency
         FROM payments
         WHERE order_id = $1 AND status = 'created'`,
        [order.id]
      );
      const existing = existingResult.rows[0];

      if (existing && existing.razorpay_order_id) {
        // Idempotent resume: hand back the same in-flight Razorpay order
        // instead of creating a second one.
        return {
          ok: true,
          data: {
            razorpayOrderId: existing.razorpay_order_id,
            amount: existing.amount,
            currency: existing.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            orderNumber: order.order_number,
          },
        };
      }

      return {
        ok: false,
        status: 409,
        message:
          "A payment attempt is already being created for this order, please retry shortly",
      };
    }
    throw error;
  }

  // Rupees -> paise is a fixed unit conversion required by Razorpay's API
  // contract, computed in Postgres rather than JavaScript.
  const amountResult = await pool.query(
    `SELECT ROUND(total_amount * 100)::bigint AS amount_paise FROM orders WHERE id = $1`,
    [order.id]
  );
  const amountPaise = Number(amountResult.rows[0].amount_paise);

  // External API call -- deliberately made with no open DB transaction.
  let razorpayOrder;

  try {
    razorpayOrder = await getRazorpay().orders.create({
      amount: amountPaise,
      currency: order.currency,
      receipt: order.order_number,
      notes: { orderNumber: order.order_number },
    });
  } catch (error) {
    await pool.query(
      `UPDATE payments
       SET status = 'failed', failure_reason = $1, updated_at = NOW()
       WHERE id = $2`,
      [String(error.message || "razorpay_order_creation_failed").slice(0, 500), payment.id]
    );

    console.error("Razorpay order creation failed:", error.message);

    return {
      ok: false,
      status: 500,
      message: "Unable to initiate payment with Razorpay",
    };
  }

  await pool.query(
    `UPDATE payments
     SET razorpay_order_id = $1, amount = $2, updated_at = NOW()
     WHERE id = $3`,
    [razorpayOrder.id, order.total_amount, payment.id]
  );

  return {
    ok: true,
    data: {
      razorpayOrderId: razorpayOrder.id,
      amount: order.total_amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      orderNumber: order.order_number,
    },
  };
}

// Verifies a Razorpay Checkout payment and, if valid, captures it.
// Never trusts the frontend success callback by itself -- the signature
// is independently recomputed server-side from the key secret.
async function verifyPayment(orderNumber, orderToken, body) {
  const razorpayOrderId = String(body?.razorpayOrderId || "").trim();
  const razorpayPaymentId = String(body?.razorpayPaymentId || "").trim();
  const razorpaySignature = String(body?.razorpaySignature || "").trim();

  if (
    !RAZORPAY_ORDER_ID_PATTERN.test(razorpayOrderId) ||
    !RAZORPAY_PAYMENT_ID_PATTERN.test(razorpayPaymentId) ||
    !RAZORPAY_SIGNATURE_PATTERN.test(razorpaySignature)
  ) {
    return {
      ok: false,
      status: 400,
      message: "Invalid or missing payment verification fields",
    };
  }

  const lookup = await findOrderByAccessToken(orderNumber, orderToken);
  if (!lookup.ok) {
    return lookup;
  }

  const order = lookup.order;

  const paymentResult = await pool.query(
    `SELECT id, status
     FROM payments
     WHERE order_id = $1 AND razorpay_order_id = $2`,
    [order.id, razorpayOrderId]
  );

  if (paymentResult.rows.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "Razorpay order ID does not match this order",
    };
  }

  const payment = paymentResult.rows[0];

  if (payment.status === "captured") {
    // Idempotent: a repeated verify call for an already-verified payment
    // succeeds without redoing any work or touching stock again.
    return {
      ok: true,
      data: {
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        alreadyProcessed: true,
      },
    };
  }

  if (payment.status === "failed") {
    return {
      ok: false,
      status: 409,
      message: "This payment attempt already failed",
    };
  }

  const signatureValid = verifyPaymentSignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );

  if (!signatureValid) {
    await markPaymentFailedIfNotCaptured(payment.id, "signature_mismatch");

    return {
      ok: false,
      status: 400,
      message: "Invalid payment signature",
    };
  }

  return capturePayment(payment.id, razorpayPaymentId);
}

// Processes one Razorpay webhook delivery. `rawBody` MUST be the exact
// raw request bytes/string Razorpay sent (not a re-serialized object) --
// the signature is computed over that exact payload.
async function processWebhookEvent(rawBody, signatureHeader) {
  if (!signatureHeader || typeof signatureHeader !== "string") {
    return { ok: false, status: 400, message: "Missing webhook signature" };
  }

  if (!verifyWebhookSignature(rawBody, signatureHeader)) {
    return { ok: false, status: 400, message: "Invalid webhook signature" };
  }

  let event;

  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    return { ok: false, status: 400, message: "Malformed webhook payload" };
  }

  const eventId = String(event?.id || "");
  const eventType = String(event?.event || "");

  if (!eventId || !eventType) {
    return { ok: false, status: 400, message: "Missing event id or type" };
  }

  try {
    await pool.query(
      `INSERT INTO payment_webhook_events (razorpay_event_id, event_type) VALUES ($1, $2)`,
      [eventId, eventType]
    );
  } catch (error) {
    if (error.code === "23505") {
      // Duplicate delivery of an event already processed -- acknowledge
      // without reprocessing.
      return { ok: true, status: 200, message: "Duplicate event acknowledged" };
    }
    throw error;
  }

  const paymentEntity = event?.payload?.payment?.entity;
  const razorpayOrderId = paymentEntity?.order_id;
  const razorpayPaymentId = paymentEntity?.id;

  if (!razorpayOrderId) {
    // Not a payment event we track (e.g. refund/order-level events).
    return { ok: true, status: 200, message: "Event acknowledged" };
  }

  const paymentResult = await pool.query(
    `SELECT id FROM payments WHERE razorpay_order_id = $1`,
    [razorpayOrderId]
  );

  if (paymentResult.rows.length === 0) {
    // Unknown Razorpay order on our side -- acknowledge so Razorpay stops
    // retrying a delivery we can never act on.
    return { ok: true, status: 200, message: "Unknown payment acknowledged" };
  }

  const paymentId = paymentResult.rows[0].id;

  if (eventType === "payment.captured") {
    await capturePayment(paymentId, razorpayPaymentId);
    return { ok: true, status: 200, message: "Payment captured" };
  }

  if (eventType === "payment.failed") {
    const { recorded } = await markPaymentFailedIfNotCaptured(
      paymentId,
      paymentEntity?.error_description || "payment_failed"
    );
    return {
      ok: true,
      status: 200,
      message: recorded
        ? "Payment failure recorded"
        : "Ignored: payment was already captured",
    };
  }

  return { ok: true, status: 200, message: "Event acknowledged" };
}

module.exports = {
  RAZORPAY_ORDER_ID_PATTERN,
  RAZORPAY_PAYMENT_ID_PATTERN,
  RAZORPAY_SIGNATURE_PATTERN,
  verifyPaymentSignature,
  verifyWebhookSignature,
  createPaymentOrder,
  verifyPayment,
  processWebhookEvent,
};
