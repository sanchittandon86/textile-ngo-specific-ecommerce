const pool = require("../config/db");

// Builds the { items, total } snapshot for a cart using Postgres numeric
// arithmetic (never JavaScript floating-point math) for prices/totals.
// `db` may be the shared pool (plain reads) or a checked-out client
// (reads inside an open transaction, so callers see their own writes).
async function getCartSnapshot(db, cartId) {
  const itemsResult = await db.query(
    `SELECT p.id AS product_id,
            p.name,
            p.slug,
            p.image_url,
            p.price AS unit_price,
            ci.quantity,
            (p.price * ci.quantity) AS line_total,
            p.stock_quantity AS available_stock,
            p.is_published,
            (p.is_published AND p.stock_quantity >= ci.quantity) AS is_available
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1
     ORDER BY ci.created_at ASC`,
    [cartId]
  );

  const totalResult = await db.query(
    `SELECT COALESCE(SUM(p.price * ci.quantity), 0.00)::numeric(12,2) AS total
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = $1
       AND p.is_published = TRUE
       AND p.stock_quantity >= ci.quantity`,
    [cartId]
  );

  return {
    items: itemsResult.rows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      slug: row.slug,
      imageUrl: row.image_url,
      unitPrice: row.unit_price,
      quantity: row.quantity,
      lineTotal: row.line_total,
      availableStock: row.available_stock,
      isPublished: row.is_published,
      isAvailable: row.is_available,
    })),
    total: totalResult.rows[0].total,
  };
}

// Adds a product to the cart, incrementing its quantity if it's already
// present. Returns { ok: true, data } on success or
// { ok: false, status, message } for a handled validation/conflict
// failure (caller maps this directly to the HTTP response). Throws only
// on unexpected database errors, after rolling back, so the route's
// catch block can map that to a 500 exactly as before.
async function addItemToCart(cartId, productId, quantity) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `SELECT stock_quantity, is_published
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    if (
      productResult.rows.length === 0 ||
      !productResult.rows[0].is_published
    ) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 404,
        message: "Product not found or unavailable",
      };
    }

    const { stock_quantity: stockQuantity } = productResult.rows[0];

    const existingResult = await client.query(
      `SELECT quantity
       FROM cart_items
       WHERE cart_id = $1 AND product_id = $2
       FOR UPDATE`,
      [cartId, productId]
    );

    const existingQuantity =
      existingResult.rows.length > 0 ? existingResult.rows[0].quantity : 0;
    const newQuantity = existingQuantity + quantity;

    if (newQuantity > stockQuantity) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Requested quantity exceeds available stock",
      };
    }

    if (existingResult.rows.length > 0) {
      await client.query(
        `UPDATE cart_items
         SET quantity = $1, updated_at = NOW()
         WHERE cart_id = $2 AND product_id = $3`,
        [newQuantity, cartId, productId]
      );
    } else {
      await client.query(
        `INSERT INTO cart_items (cart_id, product_id, quantity)
         VALUES ($1, $2, $3)`,
        [cartId, productId, newQuantity]
      );
    }

    await client.query(
      "UPDATE carts SET updated_at = NOW() WHERE id = $1",
      [cartId]
    );

    const snapshot = await getCartSnapshot(client, cartId);

    await client.query("COMMIT");

    return { ok: true, data: snapshot };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Sets an item's quantity to exactly the requested value (not an
// increment). Same return/throw contract as addItemToCart.
async function updateCartItemQuantity(cartId, productId, quantity) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const productResult = await client.query(
      `SELECT stock_quantity, is_published
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    if (
      productResult.rows.length === 0 ||
      !productResult.rows[0].is_published
    ) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 404,
        message: "Product not found or unavailable",
      };
    }

    const { stock_quantity: stockQuantity } = productResult.rows[0];

    const existingResult = await client.query(
      `SELECT id
       FROM cart_items
       WHERE cart_id = $1 AND product_id = $2
       FOR UPDATE`,
      [cartId, productId]
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 404,
        message: "Item not found in cart",
      };
    }

    if (quantity > stockQuantity) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        message: "Requested quantity exceeds available stock",
      };
    }

    await client.query(
      `UPDATE cart_items
       SET quantity = $1, updated_at = NOW()
       WHERE cart_id = $2 AND product_id = $3`,
      [quantity, cartId, productId]
    );

    await client.query(
      "UPDATE carts SET updated_at = NOW() WHERE id = $1",
      [cartId]
    );

    const snapshot = await getCartSnapshot(client, cartId);

    await client.query("COMMIT");

    return { ok: true, data: snapshot };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Removes a single item from the cart. A single DELETE...RETURNING
// statement is already atomic, so no explicit transaction is needed here
// (matches the pre-refactor behavior).
async function removeCartItem(cartId, productId) {
  const deleteResult = await pool.query(
    `DELETE FROM cart_items
     WHERE cart_id = $1 AND product_id = $2
     RETURNING id`,
    [cartId, productId]
  );

  if (deleteResult.rowCount === 0) {
    return { ok: false, status: 404, message: "Item not found in cart" };
  }

  const snapshot = await getCartSnapshot(pool, cartId);
  return { ok: true, data: snapshot };
}

// Removes all items from a cart, keeping the cart itself valid.
async function emptyCart(cartId) {
  await pool.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
  return { items: [], total: "0.00" };
}

module.exports = {
  getCartSnapshot,
  addItemToCart,
  updateCartItemQuantity,
  removeCartItem,
  emptyCart,
};
