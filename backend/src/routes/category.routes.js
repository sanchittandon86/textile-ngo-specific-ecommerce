const express = require("express");
const { listActiveCategories } = require("../services/category.service");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const categories = await listActiveCategories();

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Fetch categories failed:", error.message);

    res.status(500).json({
      success: false,
      message: "Unable to fetch categories",
    });
  }
});

module.exports = router;
