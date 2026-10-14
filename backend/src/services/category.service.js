const pool = require("../config/db");

async function listActiveCategories() {
  const result = await pool.query(
    `SELECT id, name, slug, image_url
     FROM categories
     WHERE is_active = TRUE
     ORDER BY name ASC`
  );

  return result.rows;
}

module.exports = { listActiveCategories };
