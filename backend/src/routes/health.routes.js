const express = require("express");
const pool = require("../config/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      success: true,
      message: "Backend and database are running",
    });
  } catch (error) {
    console.error("Health check failed:", error.message);

    res.status(503).json({
      success: false,
      message: "Database unavailable",
    });
  }
});

module.exports = router;