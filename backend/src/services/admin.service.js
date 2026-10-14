// Read-only admin data access. No mutations here by design -- this is
// the first (read-only) version of the admin dashboard. Unlike the
// public product/category APIs, these intentionally include
// unpublished products and inactive categories, since admins need to
// see everything.
const pool = require("../config/db");

async function listAllProducts({ page, limit }) {
  const offset = (page - 1) * limit;

  const countResult = await pool.query(`SELECT COUNT(*)::int AS total FROM products`);
  const total = countResult.rows[0].total;

  const result = await pool.query(
    `SELECT p.id, p.name, p.slug, p.price, p.stock_quantity, p.image_url,
            p.is_published, p.category_id, c.name AS category_name,
            p.created_at, p.updated_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     ORDER BY p.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return { products: result.rows, total };
}

async function listAllCategories() {
  const result = await pool.query(
    `SELECT id, name, slug, image_url, is_active, created_at
     FROM categories
     ORDER BY name ASC`
  );

  return result.rows;
}

const ORDER_STATUS_VALUES = [
  "pending",
  "pending_payment",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
  "paid_fulfillment_blocked",
];

const PAYMENT_STATUS_VALUES = ["pending", "paid", "failed", "refunded"];

async function listOrders({ page, limit, status, paymentStatus }) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const values = [];

  if (status && ORDER_STATUS_VALUES.includes(status)) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (paymentStatus && PAYMENT_STATUS_VALUES.includes(paymentStatus)) {
    values.push(paymentStatus);
    conditions.push(`payment_status = $${values.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM orders ${whereClause}`,
    values
  );
  const total = countResult.rows[0].total;

  const queryValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT id, order_number, status, payment_status, payment_method,
            customer_name, customer_phone, total_amount, currency, created_at
     FROM orders
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    queryValues
  );

  return { orders: result.rows, total };
}

async function getOrderDetail(orderNumber) {
  const orderResult = await pool.query(
    `SELECT id, order_number, status, payment_status, payment_method,
            customer_name, customer_email, customer_phone,
            shipping_address_line1, shipping_address_line2, shipping_city,
            shipping_state, shipping_postal_code, shipping_country,
            subtotal, shipping_fee, discount_amount, total_amount, currency,
            created_at, updated_at
     FROM orders
     WHERE order_number = $1`,
    [orderNumber]
  );

  if (orderResult.rows.length === 0) {
    return null;
  }

  const order = orderResult.rows[0];

  const itemsResult = await pool.query(
    `SELECT product_id, product_name, product_slug, unit_price, quantity, line_total
     FROM order_items
     WHERE order_id = $1
     ORDER BY id ASC`,
    [order.id]
  );

  // Payment attempts, never the stored token/signature material --
  // just enough for an admin to see what happened (useful for
  // troubleshooting paid_fulfillment_blocked orders).
  const paymentsResult = await pool.query(
    `SELECT id, razorpay_order_id, razorpay_payment_id, amount, currency,
            status, failure_reason, verified_at, created_at
     FROM payments
     WHERE order_id = $1
     ORDER BY created_at DESC`,
    [order.id]
  );

  return { order, items: itemsResult.rows, payments: paymentsResult.rows };
}

async function getDashboardSummary() {
  const [orders, products, categories, revenue] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 'pending_payment')::int AS pending_payment,
         COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
         COUNT(*) FILTER (WHERE status = 'paid_fulfillment_blocked')::int AS fulfillment_blocked
       FROM orders`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_published)::int AS published
       FROM products`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE is_active)::int AS active
       FROM categories`
    ),
    pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::numeric(12,2) AS total
       FROM orders
       WHERE payment_status = 'paid'`
    ),
  ]);

  return {
    orders: orders.rows[0],
    products: products.rows[0],
    categories: categories.rows[0],
    paidRevenue: revenue.rows[0].total,
  };
}

module.exports = {
  listAllProducts,
  listAllCategories,
  listOrders,
  getOrderDetail,
  getDashboardSummary,
};
