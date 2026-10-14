const crypto = require("crypto");
const pool = require("../config/db");

// Razorpay is the only supported payment method -- no COD, no alternatives.
const PAYMENT_METHODS = ["online"];

// Flat guest-checkout shipping fee. No free-shipping-threshold logic exists
// yet; this is a deliberately simple placeholder for a future pricing rule.
const SHIPPING_FEE = "50.00";
const DISCOUNT_AMOUNT = "0.00"; // No discount-code feature exists yet.
const CURRENCY = "INR";

const MAX_NAME_LENGTH = 150;
const PHONE_PATTERN = /^[0-9]{10,15}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ORDER_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const ORDER_NUMBER_PATTERN = /^ORD-\d{8}-[A-F0-9]{10}$/;

function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

function generateOrderToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashOrderToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function mapOrderItemRow(row) {
  return {
    productId: row.product_id,
    name: row.name,
    slug: row.slug,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    lineTotal: row.line_total,
  };
}

function validateCustomer(customer) {
  if (!customer || typeof customer !== "object") {
    return null;
  }

  const name = String(customer.name || "").trim();
  const phone = String(customer.phone || "").trim();
  const email = customer.email ? String(customer.email).trim() : null;

  if (!name || name.length > MAX_NAME_LENGTH) {
    return null;
  }

  if (!PHONE_PATTERN.test(phone)) {
    return null;
  }

  if (email && !EMAIL_PATTERN.test(email)) {
    return null;
  }

  return { name, phone, email };
}

function validateShippingAddress(address) {
  if (!address || typeof address !== "object") {
    return null;
  }

  const line1 = String(address.line1 || "").trim();
  const line2 = address.line2 ? String(address.line2).trim() : null;
  const city = String(address.city || "").trim();
  const state = String(address.state || "").trim();
  const postalCode = String(address.postalCode || "").trim();
  const country = String(address.country || "India").trim();

  if (!line1 || line1.length > 255) return null;
  if (line2 && line2.length > 255) return null;
  if (!city || city.length > 100) return null;
  if (!state || state.length > 100) return null;
  if (!postalCode || postalCode.length > 20) return null;
  if (!country || country.length > 100) return null;

  return { line1, line2, city, state, postalCode, country };
}

// Looks up a guest order by its public order number + secret access token,
// the same mechanism GET /api/orders/:orderNumber uses. Returns
// { ok: false, status, message } for a format/auth/not-found failure, or
// { ok: true, order } with the full order row otherwise. Shared by
// order.routes.js and payments.service.js so both endpoints authorize
// guest order access identically.
async function findOrderByAccessToken(orderNumber, token) {
  if (!ORDER_NUMBER_PATTERN.test(String(orderNumber || ""))) {
    return { ok: false, status: 400, message: "Invalid order number format" };
  }

  if (!token || !ORDER_TOKEN_PATTERN.test(token)) {
    return {
      ok: false,
      status: 401,
      message: "Missing or malformed order access token",
    };
  }

  const tokenHash = hashOrderToken(token);

  const result = await pool.query(
    `SELECT id, order_number, status, payment_status, payment_method,
            customer_name, customer_email, customer_phone,
            shipping_address_line1, shipping_address_line2, shipping_city,
            shipping_state, shipping_postal_code, shipping_country,
            subtotal, shipping_fee, discount_amount, total_amount,
            currency, created_at
     FROM orders
     WHERE order_number = $1 AND order_token_hash = $2`,
    [orderNumber, tokenHash]
  );

  if (result.rows.length === 0) {
    // Generic 404 whether the order number is unknown or the token just
    // doesn't match -- never reveal which, to prevent enumeration.
    return { ok: false, status: 404, message: "Order not found" };
  }

  return { ok: true, order: result.rows[0] };
}

// Creates a guest order from the cart identified by cartId.
// Returns { ok: true, order, items, orderToken } on success, or
// { ok: false, status, message } on a handled validation/conflict failure.
// Throws only on unexpected database errors (caller maps those to 500).
async function createGuestOrder(cartId, body) {
  const customer = validateCustomer(body?.customer);
  if (!customer) {
    return {
      ok: false,
      status: 400,
      message: "Invalid or missing customer details",
    };
  }

  const shippingAddress = validateShippingAddress(body?.shippingAddress);
  if (!shippingAddress) {
    return {
      ok: false,
      status: 400,
      message: "Invalid or missing shipping address",
    };
  }

  const paymentMethod = String(body?.paymentMethod || "").trim();
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return {
      ok: false,
      status: 400,
      message: "Unsupported payment method",
    };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Atomically consume the cart. This DELETE takes row locks on the
    // cart's items: a second, truly concurrent checkout request for the
    // SAME cart blocks here until this transaction finishes. If this
    // transaction commits, the second request's DELETE affects 0 rows
    // (already gone) and it is rejected as an empty cart -- no duplicate
    // order. If this transaction rolls back (any failure below), the
    // DELETE is undone and the cart is restored exactly as it was.
    const cartItemsResult = await client.query(
      `DELETE FROM cart_items WHERE cart_id = $1 RETURNING product_id, quantity`,
      [cartId]
    );

    if (cartItemsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 400, message: "Cart is empty" };
    }

    const productIds = cartItemsResult.rows.map((row) => row.product_id);

    // Lock product rows in a consistent (ascending id) order so concurrent
    // checkouts touching overlapping product sets can't deadlock.
    const productsResult = await client.query(
      `SELECT id, name, slug, price, stock_quantity, is_published
       FROM products
       WHERE id = ANY($1::bigint[])
       ORDER BY id ASC
       FOR UPDATE`,
      [productIds]
    );

    const productsById = new Map(
      productsResult.rows.map((p) => [String(p.id), p])
    );

    const orderItemInputs = [];

    for (const row of cartItemsResult.rows) {
      const product = productsById.get(String(row.product_id));

      if (!product || !product.is_published) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 404,
          message: `Product ${row.product_id} is no longer available`,
        };
      }

      if (row.quantity > product.stock_quantity) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          status: 409,
          message: `Insufficient stock for "${product.name}"`,
        };
      }

      orderItemInputs.push({
        productId: product.id,
        name: product.name,
        slug: product.slug,
        unitPrice: product.price,
        quantity: row.quantity,
      });
    }

    // All monetary arithmetic below runs in Postgres, never in JavaScript.
    const subtotalResult = await client.query(
      `SELECT COALESCE(SUM(uprice * qty), 0)::numeric(12,2) AS subtotal
       FROM UNNEST($1::numeric[], $2::int[]) AS t(uprice, qty)`,
      [
        orderItemInputs.map((i) => i.unitPrice),
        orderItemInputs.map((i) => i.quantity),
      ]
    );
    const subtotal = subtotalResult.rows[0].subtotal;

    const totalResult = await client.query(
      `SELECT ($1::numeric + $2::numeric - $3::numeric)::numeric(12,2) AS total`,
      [subtotal, SHIPPING_FEE, DISCOUNT_AMOUNT]
    );
    const totalAmount = totalResult.rows[0].total;

    // Every order starts unpaid and awaiting a Razorpay payment. Stock is
    // deliberately NOT decremented here -- see payments.service.js, which
    // decrements it exactly once, at the point a payment is actually
    // confirmed (via /api/payments/verify or the Razorpay webhook).
    const status = "pending_payment";

    let order;
    const MAX_INSERT_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt += 1) {
      const orderNumber = generateOrderNumber();
      const rawOrderToken = generateOrderToken();
      const orderTokenHash = hashOrderToken(rawOrderToken);

      try {
        const orderInsert = await client.query(
          `INSERT INTO orders (
             order_number, order_token_hash, status, payment_status,
             payment_method, customer_name, customer_email, customer_phone,
             shipping_address_line1, shipping_address_line2, shipping_city,
             shipping_state, shipping_postal_code, shipping_country,
             subtotal, shipping_fee, discount_amount, total_amount, currency
           ) VALUES (
             $1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12,
             $13, $14, $15, $16, $17, $18
           )
           RETURNING id, order_number, status, payment_status, payment_method,
                     subtotal, shipping_fee, discount_amount, total_amount,
                     currency, created_at`,
          [
            orderNumber,
            orderTokenHash,
            status,
            paymentMethod,
            customer.name,
            customer.email,
            customer.phone,
            shippingAddress.line1,
            shippingAddress.line2,
            shippingAddress.city,
            shippingAddress.state,
            shippingAddress.postalCode,
            shippingAddress.country,
            subtotal,
            SHIPPING_FEE,
            DISCOUNT_AMOUNT,
            totalAmount,
            CURRENCY,
          ]
        );

        order = { ...orderInsert.rows[0], rawOrderToken };
        break;
      } catch (error) {
        // 23505 = unique_violation on order_number/order_token_hash.
        // Astronomically unlikely, but retry with fresh values just in case.
        if (error.code === "23505" && attempt < MAX_INSERT_ATTEMPTS) {
          continue;
        }
        throw error;
      }
    }

    const itemsResult = await client.query(
      `INSERT INTO order_items (
         order_id, product_id, product_name, product_slug, unit_price,
         quantity, line_total
       )
       SELECT $1, pid, pname, pslug, uprice, qty, (uprice * qty)::numeric(12,2)
       FROM UNNEST($2::bigint[], $3::text[], $4::text[], $5::numeric[], $6::int[])
            AS t(pid, pname, pslug, uprice, qty)
       RETURNING product_id, product_name AS name, product_slug AS slug,
                 unit_price, quantity, line_total`,
      [
        order.id,
        orderItemInputs.map((i) => i.productId),
        orderItemInputs.map((i) => i.name),
        orderItemInputs.map((i) => i.slug),
        orderItemInputs.map((i) => i.unitPrice),
        orderItemInputs.map((i) => i.quantity),
      ]
    );

    // Stock is intentionally NOT decremented here. The product rows above
    // were only locked/read to validate availability and snapshot price --
    // decrementing happens later, exactly once, when payment is confirmed
    // (see payments.service.js). This avoids permanently consuming stock
    // for orders where the customer never completes payment.

    await client.query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [
      cartId,
    ]);

    await client.query("COMMIT");

    return {
      ok: true,
      order,
      items: itemsResult.rows.map(mapOrderItemRow),
      orderToken: order.rawOrderToken,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  PAYMENT_METHODS,
  SHIPPING_FEE,
  DISCOUNT_AMOUNT,
  CURRENCY,
  ORDER_TOKEN_PATTERN,
  ORDER_NUMBER_PATTERN,
  generateOrderNumber,
  generateOrderToken,
  hashOrderToken,
  mapOrderItemRow,
  validateCustomer,
  validateShippingAddress,
  findOrderByAccessToken,
  createGuestOrder,
};
