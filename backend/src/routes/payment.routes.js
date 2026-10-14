const express = require("express");
const {
  createPaymentOrder,
  verifyPayment,
  processWebhookEvent,
} = require("../services/payments.service");

const router = express.Router();

// POST /api/payments/create-order - create (or resume) a Razorpay order
// for an existing, unpaid guest order. Guest-authenticated the same way
// as GET /api/orders/:orderNumber: order number + X-Order-Token.
router.post("/create-order", async (req, res) => {
  const orderNumber = String(req.body?.orderNumber || "").trim();
  const orderToken = req.header("X-Order-Token");

  try {
    const result = await createPaymentOrder(orderNumber, orderToken);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(201).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Create payment order failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order",
    });
  }
});

// POST /api/payments/verify - verify a completed Razorpay Checkout
// payment. Never trusts the frontend success callback alone; the
// signature is independently recomputed from the key secret server-side.
router.post("/verify", async (req, res) => {
  const orderNumber = String(req.body?.orderNumber || "").trim();
  const orderToken = req.header("X-Order-Token");

  try {
    const result = await verifyPayment(orderNumber, orderToken, req.body);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("Verify payment failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to verify payment",
    });
  }
});

// POST /api/payments/webhook - Razorpay server-to-server webhook.
// req.body is a raw Buffer here (see app.js), NOT parsed JSON -- the
// signature must be verified against the exact raw bytes Razorpay sent.
router.post("/webhook", async (req, res) => {
  const signature = req.header("X-Razorpay-Signature");

  if (!Buffer.isBuffer(req.body)) {
    // Misconfiguration guard: this route must receive a raw body, not
    // JSON parsed by the global express.json() middleware.
    console.error("Webhook received non-raw body; check app.js middleware order");

    return res.status(500).json({
      success: false,
      message: "Webhook misconfigured",
    });
  }

  try {
    const result = await processWebhookEvent(req.body, signature);

    return res.status(result.status).json({
      success: result.ok,
      message: result.message,
    });
  } catch (error) {
    console.error("Webhook processing failed:", error.message);

    // 500 so Razorpay retries -- this path is for unexpected/transient
    // failures only; signature/validation failures already returned
    // above with a 4xx that Razorpay should not blindly retry forever.
    return res.status(500).json({
      success: false,
      message: "Unable to process webhook",
    });
  }
});

module.exports = router;
