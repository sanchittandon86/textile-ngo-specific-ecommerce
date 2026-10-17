const express = require("express");
const pool = require("../config/db");
const createRateLimiter = require("../middleware/rateLimit.middleware");
const {
  mapOrderItemRow,
  findOrderByAccessToken,
} = require("../services/checkout.service");

const router = express.Router();

// The order_token_hash itself makes brute-forcing computationally
// infeasible (SHA-256 of a 256-bit random token), but this still limits
// how fast someone can hammer the endpoint guessing order numbers/tokens
// or just scraping order data.
const orderLookupLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many order lookups from this address. Please try again later.",
});

// GET /api/orders/:orderNumber - guest order lookup.
// Requires BOTH a well-formed order number AND the matching X-Order-Token.
// Order number or database id alone is never sufficient -- see
// findOrderByAccessToken in checkout.service.js, shared with the payments
// endpoints so guest order access is authorized identically everywhere.
router.get("/:orderNumber", orderLookupLimiter, async (req, res) => {
  const orderNumber = String(req.params.orderNumber || "").trim();
  const token = req.header("X-Order-Token");

  try {
    const lookup = await findOrderByAccessToken(orderNumber, token);

    if (!lookup.ok) {
      return res.status(lookup.status).json({
        success: false,
        message: lookup.message,
      });
    }

    const order = lookup.order;

    const itemsResult = await pool.query(
      `SELECT product_id, product_name AS name, product_slug AS slug,
              unit_price, quantity, line_total
       FROM order_items
       WHERE order_id = $1
       ORDER BY id ASC`,
      [order.id]
    );

    return res.status(200).json({
      success: true,
      data: {
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        customer: {
          name: order.customer_name,
          email: order.customer_email,
          phone: order.customer_phone,
        },
        shippingAddress: {
          line1: order.shipping_address_line1,
          line2: order.shipping_address_line2,
          city: order.shipping_city,
          state: order.shipping_state,
          postalCode: order.shipping_postal_code,
          country: order.shipping_country,
        },
        items: itemsResult.rows.map(mapOrderItemRow),
        subtotal: order.subtotal,
        shippingFee: order.shipping_fee,
        discountAmount: order.discount_amount,
        totalAmount: order.total_amount,
        currency: order.currency,
        createdAt: order.created_at,
      },
    });
  } catch (error) {
    console.error("Fetch order failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order",
    });
  }
});

module.exports = router;
