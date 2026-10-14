const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const app = express();

// Middleware
// credentials: true is required for the admin refresh-token cookie
// (httpOnly, cross-port between the frontend and this API) to be sent
// and accepted; it has no effect on the public guest APIs, which never
// rely on cookies.
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}));

app.use(cookieParser());

// The Razorpay webhook needs the exact raw request bytes to verify its
// signature -- it must be registered BEFORE the global express.json()
// below. body-parser middleware (what express.json/raw use internally)
// skips re-parsing once a body has already been parsed, so this scopes
// raw-body handling to only this one path; every other route still gets
// normal parsed JSON via express.json() further down.
app.use(
  "/api/payments/webhook",
  express.raw({ type: "application/json", limit: "1mb" })
);

app.use(express.json({ limit: "100kb" }));

// Routes
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Textile Store API is running",
  });
});

app.use("/api/health", require("./routes/health.routes"));
app.use("/api/categories", require("./routes/category.routes"));
app.use("/api/products", require("./routes/product.routes"));
app.use("/api/cart", require("./routes/cart.routes"));
app.use("/api/checkout", require("./routes/checkout.routes"));
app.use("/api/orders", require("./routes/order.routes"));
app.use("/api/payments", require("./routes/payment.routes"));
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/admin", require("./routes/admin.routes"));

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler - catches malformed JSON bodies (express.json()) and any
// other error passed to next(err). Must stay last and keep 4 arguments.
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON in request body",
    });
  }

  console.error("Unhandled error:", err.message);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
});

module.exports = app;