const express = require("express");
const pool = require("../config/db");
const guestCart = require("../middleware/guestCart");
const { getCartSnapshot } = require("../services/cart.service");
const {
  SHIPPING_FEE,
  CURRENCY,
  createGuestOrder,
} = require("../services/checkout.service");

const router = express.Router();

// GET /api/checkout/summary - preview only. Checkout itself re-fetches
// prices/stock from the database and recalculates everything; nothing
// here is trusted at order-creation time.
router.get("/summary", guestCart, async (req, res) => {
  try {
    const snapshot = await getCartSnapshot(pool, req.cartId);

    if (snapshot.items.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          items: [],
          subtotal: "0.00",
          shippingFee: "0.00",
          estimatedTotal: "0.00",
          currency: CURRENCY,
        },
      });
    }

    const totalResult = await pool.query(
      `SELECT ($1::numeric + $2::numeric)::numeric(12,2) AS estimated_total`,
      [snapshot.total, SHIPPING_FEE]
    );

    return res.status(200).json({
      success: true,
      data: {
        items: snapshot.items,
        subtotal: snapshot.total,
        shippingFee: SHIPPING_FEE,
        estimatedTotal: totalResult.rows[0].estimated_total,
        currency: CURRENCY,
      },
    });
  } catch (error) {
    console.error("Checkout summary failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to build checkout summary",
    });
  }
});

// POST /api/checkout - create a guest order from the cart.
router.post("/", guestCart, async (req, res) => {
  try {
    const result = await createGuestOrder(req.cartId, req.body);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    const { order, items, orderToken } = result;

    return res.status(201).json({
      success: true,
      data: {
        orderNumber: order.order_number,
        orderToken,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        items,
        subtotal: order.subtotal,
        shippingFee: order.shipping_fee,
        discountAmount: order.discount_amount,
        totalAmount: order.total_amount,
        currency: order.currency,
        createdAt: order.created_at,
      },
    });
  } catch (error) {
    console.error("Checkout failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to complete checkout",
    });
  }
});

module.exports = router;
