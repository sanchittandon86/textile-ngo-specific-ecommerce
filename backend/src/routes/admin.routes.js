// Read-only admin endpoints. Every route here requires a valid admin
// access token (authMiddleware, applied once for the whole router).
const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const adminService = require("../services/admin.service");

const router = express.Router();

router.use(authMiddleware);

router.get("/dashboard/summary", async (req, res) => {
  try {
    const summary = await adminService.getDashboardSummary();
    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error("Fetch admin dashboard summary failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch dashboard summary",
    });
  }
});

router.get("/products", async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({
      success: false,
      message: "Invalid pagination parameters",
    });
  }

  try {
    const { products, total } = await adminService.listAllProducts({ page, limit });

    return res.status(200).json({
      success: true,
      data: products,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Fetch admin products failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch products",
    });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const categories = await adminService.listAllCategories();
    return res.status(200).json({ success: true, data: categories });
  } catch (error) {
    console.error("Fetch admin categories failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch categories",
    });
  }
});

router.get("/orders", async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({
      success: false,
      message: "Invalid pagination parameters",
    });
  }

  try {
    const { orders, total } = await adminService.listOrders({
      page,
      limit,
      status: req.query.status,
      paymentStatus: req.query.paymentStatus,
    });

    return res.status(200).json({
      success: true,
      data: orders,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Fetch admin orders failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch orders",
    });
  }
});

router.get("/orders/:orderNumber", async (req, res) => {
  try {
    const detail = await adminService.getOrderDetail(req.params.orderNumber);

    if (!detail) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    return res.status(200).json({ success: true, data: detail });
  } catch (error) {
    console.error("Fetch admin order detail failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch order",
    });
  }
});

module.exports = router;
