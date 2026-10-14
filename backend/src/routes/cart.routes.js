const express = require("express");
const crypto = require("crypto");
const pool = require("../config/db");
const guestCart = require("../middleware/guestCart");
const {
  getCartSnapshot,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  emptyCart,
} = require("../services/cart.service");

const router = express.Router();

const CART_TTL_INTERVAL = "30 days";
const MAX_QUANTITY_PER_ITEM = 999;

function parsePositiveInt(value, max) {
  const num = Number(value);

  if (!Number.isInteger(num) || num < 1) {
    return null;
  }

  if (typeof max === "number" && num > max) {
    return null;
  }

  return num;
}

// POST /api/cart - create a new guest cart. No token required.
router.post("/", async (req, res) => {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    try {
      const result = await pool.query(
        `INSERT INTO carts (token_hash, expires_at)
         VALUES ($1, NOW() + INTERVAL '${CART_TTL_INTERVAL}')
         RETURNING expires_at`,
        [tokenHash]
      );

      return res.status(201).json({
        success: true,
        data: {
          cartToken: rawToken,
          expiresAt: result.rows[0].expires_at,
        },
      });
    } catch (error) {
      // 23505 = unique_violation on token_hash. Astronomically unlikely
      // with a 256-bit token, but retry with a fresh token just in case.
      if (error.code === "23505" && attempt < MAX_ATTEMPTS) {
        continue;
      }

      console.error("Create cart failed:", error.message);

      return res.status(500).json({
        success: false,
        message: "Unable to create cart",
      });
    }
  }
});

// GET /api/cart - fetch the authenticated guest cart.
router.get("/", guestCart, async (req, res) => {
  try {
    const snapshot = await getCartSnapshot(pool, req.cartId);

    return res.status(200).json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    console.error("Fetch cart failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch cart",
    });
  }
});

// DELETE /api/cart - remove all items, keep the cart itself valid.
router.delete("/", guestCart, async (req, res) => {
  try {
    const data = await emptyCart(req.cartId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Empty cart failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to empty cart",
    });
  }
});

// POST /api/cart/items - add a product to the cart (increments if present).
router.post("/items", guestCart, async (req, res) => {
  const productId = parsePositiveInt(req.body?.productId);
  const quantity = parsePositiveInt(req.body?.quantity, MAX_QUANTITY_PER_ITEM);

  if (productId === null || quantity === null) {
    return res.status(400).json({
      success: false,
      message: "productId and quantity must be positive integers",
    });
  }

  try {
    const result = await addItemToCart(req.cartId, productId, quantity);

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
    console.error("Add cart item failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to add item to cart",
    });
  }
});

// PATCH /api/cart/items/:productId - set an item's quantity exactly.
router.patch("/items/:productId", guestCart, async (req, res) => {
  const productId = parsePositiveInt(req.params.productId);
  const quantity = parsePositiveInt(req.body?.quantity, MAX_QUANTITY_PER_ITEM);

  if (productId === null || quantity === null) {
    return res.status(400).json({
      success: false,
      message: "productId and quantity must be positive integers",
    });
  }

  try {
    const result = await updateCartItemQuantity(req.cartId, productId, quantity);

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
    console.error("Update cart item failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to update cart item",
    });
  }
});

// DELETE /api/cart/items/:productId - remove a single item.
router.delete("/items/:productId", guestCart, async (req, res) => {
  const productId = parsePositiveInt(req.params.productId);

  if (productId === null) {
    return res.status(400).json({
      success: false,
      message: "productId must be a positive integer",
    });
  }

  try {
    const result = await removeCartItem(req.cartId, productId);

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
    console.error("Remove cart item failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to remove cart item",
    });
  }
});

module.exports = router;
