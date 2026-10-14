const express = require("express");
const {
  SORT_COLUMNS,
  listProducts,
  searchProducts,
  getProductBySlug,
} = require("../services/product.service");

const router = express.Router();

// GET /api/products?page=1&limit=12&category=bedsheets
// Optional: &sortBy=price&order=asc
router.get("/", async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 12);
  const category = req.query.category;
  const sortBy = req.query.sortBy || "created_at";
  const order = String(req.query.order || "desc").toLowerCase();

  if (
    !Number.isInteger(page) ||
    !Number.isInteger(limit) ||
    page < 1 ||
    limit < 1 ||
    limit > 50
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid pagination parameters",
    });
  }

  if (
    !Object.hasOwn(SORT_COLUMNS, sortBy) ||
    !["asc", "desc"].includes(order)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid sorting parameters",
    });
  }

  try {
    const { products, total } = await listProducts({
      page,
      limit,
      category,
      sortBy,
      order,
    });

    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Fetch products failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch products",
    });
  }
});

// GET /api/products/search?q=bedsheet
router.get("/search", async (req, res) => {
  const search = String(req.query.q || "").trim();

  if (!search || search.length > 100) {
    return res.status(400).json({
      success: false,
      message: "Search query must contain 1 to 100 characters",
    });
  }

  try {
    const { products, count } = await searchProducts(search);

    return res.status(200).json({
      success: true,
      data: products,
      count,
    });
  } catch (error) {
    console.error("Search products failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to search products",
    });
  }
});

// GET /api/products/:slug
router.get("/:slug", async (req, res) => {
  try {
    const product = await getProductBySlug(req.params.slug);

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (error) {
    console.error("Fetch product failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch product",
    });
  }
});

module.exports = router;
