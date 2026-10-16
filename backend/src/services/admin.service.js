// Admin data access, plus a small set of admin-driven mutations
// (fulfillment status advancement, category create/activate). Unlike the
// public product/category APIs, reads here intentionally include
// unpublished products and inactive categories, since admins need to
// see everything.
const pool = require("../config/db");
const { normalizeCategoryValue } = require("./product-import.service");
const { uploadCategoryImage, deleteCategoryImage } = require("./cloudinary.service");

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

// Create-only (no rename/edit) -- matches the bulk-import rule that
// categories are never silently renamed. imageUrl, if given, is a
// source URL the admin supplies; Cloudinary fetches it server-side and
// we store the returned secure_url, never the raw input, as image_url.
async function createCategory({ name, imageUrl }) {
  const trimmedName = String(name || "").trim();

  if (!trimmedName) {
    return { ok: false, httpStatus: 400, message: "Category name is required" };
  }

  if (trimmedName.length > 150) {
    return { ok: false, httpStatus: 400, message: "Category name is too long" };
  }

  const slug = normalizeCategoryValue(trimmedName);

  if (!slug) {
    return { ok: false, httpStatus: 400, message: "Category name must contain at least one letter or number" };
  }

  const existing = await pool.query(`SELECT id FROM categories WHERE slug = $1`, [slug]);
  if (existing.rows.length > 0) {
    return { ok: false, httpStatus: 409, message: `A category matching "${trimmedName}" already exists` };
  }

  let resolvedImageUrl = null;
  let uploadedPublicId = null;

  const trimmedImageUrl = String(imageUrl || "").trim();
  if (trimmedImageUrl) {
    try {
      const uploaded = await uploadCategoryImage(trimmedImageUrl, { slug });
      resolvedImageUrl = uploaded.secureUrl;
      uploadedPublicId = uploaded.publicId;
    } catch (error) {
      console.error("Category image upload failed:", error.message);
      return { ok: false, httpStatus: 502, message: "Unable to upload the category image" };
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO categories (name, slug, image_url, is_active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, name, slug, image_url, is_active, created_at`,
      [trimmedName, slug, resolvedImageUrl]
    );

    return { ok: true, category: result.rows[0] };
  } catch (error) {
    // Image already landed in Cloudinary -- don't leave it orphaned if
    // the DB insert fails for any reason (e.g. a race on the slug
    // uniqueness check above).
    if (uploadedPublicId) {
      await deleteCategoryImage(uploadedPublicId);
    }
    throw error;
  }
}

async function setCategoryActive(id, isActive) {
  const result = await pool.query(
    `UPDATE categories SET is_active = $1 WHERE id = $2
     RETURNING id, name, slug, image_url, is_active, created_at`,
    [isActive, id]
  );

  if (result.rows.length === 0) {
    return { ok: false, httpStatus: 404, message: "Category not found" };
  }

  return { ok: true, category: result.rows[0] };
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
            tracking_carrier, tracking_number,
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

  const historyResult = await pool.query(
    `SELECT id, from_status, to_status, created_at
     FROM order_status_history
     WHERE order_id = $1
     ORDER BY created_at ASC`,
    [order.id]
  );

  return {
    order,
    items: itemsResult.rows,
    payments: paymentsResult.rows,
    statusHistory: historyResult.rows,
  };
}

// Admin-driven fulfillment advancement. Only two forward transitions are
// allowed, each from exactly one required prior status -- this is not a
// general order-editing endpoint:
//   processing -> shipped   (requires trackingCarrier + trackingNumber)
//   shipped    -> delivered
// Cancellation and resolving paid_fulfillment_blocked orders are out of
// scope here (handled elsewhere, or not yet built).
const REQUIRED_PRIOR_STATUS = {
  shipped: "processing",
  delivered: "shipped",
};

async function updateOrderFulfillment(orderNumber, { status, trackingCarrier, trackingNumber }) {
  if (!Object.prototype.hasOwnProperty.call(REQUIRED_PRIOR_STATUS, status)) {
    return { ok: false, httpStatus: 400, message: "Invalid status transition" };
  }

  let carrier = null;
  let number = null;

  if (status === "shipped") {
    carrier = String(trackingCarrier || "").trim();
    number = String(trackingNumber || "").trim();

    if (!carrier || !number) {
      return {
        ok: false,
        httpStatus: 400,
        message: "Tracking carrier and tracking number are required to mark an order as shipped",
      };
    }

    if (carrier.length > 100 || number.length > 100) {
      return { ok: false, httpStatus: 400, message: "Tracking carrier/number is too long" };
    }
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT id, status FROM orders WHERE order_number = $1 FOR UPDATE`,
      [orderNumber]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, httpStatus: 404, message: "Order not found" };
    }

    const order = orderResult.rows[0];
    const requiredPrior = REQUIRED_PRIOR_STATUS[status];

    if (order.status !== requiredPrior) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        httpStatus: 409,
        message: `Cannot mark order as ${status} -- current status is ${order.status}, expected ${requiredPrior}`,
      };
    }

    const updateResult =
      status === "shipped"
        ? await client.query(
            `UPDATE orders
             SET status = $1, tracking_carrier = $2, tracking_number = $3, updated_at = NOW()
             WHERE id = $4
             RETURNING id, order_number, status, tracking_carrier, tracking_number, updated_at`,
            [status, carrier, number, order.id]
          )
        : await client.query(
            `UPDATE orders
             SET status = $1, updated_at = NOW()
             WHERE id = $2
             RETURNING id, order_number, status, tracking_carrier, tracking_number, updated_at`,
            [status, order.id]
          );

    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status) VALUES ($1, $2, $3)`,
      [order.id, order.status, status]
    );

    await client.query("COMMIT");

    return { ok: true, order: updateResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  createCategory,
  setCategoryActive,
  listOrders,
  getOrderDetail,
  updateOrderFulfillment,
  getDashboardSummary,
};
