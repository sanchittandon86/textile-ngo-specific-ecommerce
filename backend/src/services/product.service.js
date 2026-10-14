const pool = require("../config/db");

const SORT_COLUMNS = {
  name: "p.name",
  price: "p.price",
  created_at: "p.created_at",
};

async function listProducts({ page, limit, category, sortBy, order }) {
  const conditions = ["p.is_published = TRUE"];
  const values = [];

  if (category) {
    values.push(category);
    conditions.push(
      `EXISTS (
        SELECT 1
        FROM categories c
        WHERE c.id = p.category_id
          AND c.slug = $${values.length}
          AND c.is_active = TRUE
      )`
    );
  }

  const whereClause = conditions.join(" AND ");

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM products p
     WHERE ${whereClause}`,
    values
  );

  const total = countResult.rows[0].total;
  const offset = (page - 1) * limit;

  const queryValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description,
            p.price, p.stock_quantity, p.image_url,
            p.category_id, p.created_at
     FROM products p
     WHERE ${whereClause}
     ORDER BY ${SORT_COLUMNS[sortBy]} ${order.toUpperCase()}
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    queryValues
  );

  return { products: result.rows, total };
}

async function searchProducts(search) {
  const result = await pool.query(
    `SELECT id, name, slug, description, price,
            stock_quantity, image_url, category_id
     FROM products
     WHERE is_published = TRUE
       AND (
         name ILIKE $1
         OR COALESCE(description, '') ILIKE $1
       )
     ORDER BY created_at DESC
     LIMIT 50`,
    [`%${search}%`]
  );

  return { products: result.rows, count: result.rowCount };
}

async function getProductBySlug(slug) {
  const result = await pool.query(
    `SELECT p.id, p.name, p.slug, p.description,
            p.price, p.stock_quantity, p.image_url,
            p.category_id
     FROM products p
     WHERE p.slug = $1
       AND p.is_published = TRUE`,
    [slug]
  );

  return result.rows[0] || null;
}

module.exports = {
  SORT_COLUMNS,
  listProducts,
  searchProducts,
  getProductBySlug,
};
