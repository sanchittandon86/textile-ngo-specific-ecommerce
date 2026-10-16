// Generates the downloadable Excel import template. Dynamic (not a
// static file) so the "Categories" reference sheet always reflects the
// current database, and the columns always match product-import.service.js.
const ExcelJS = require("exceljs");
const pool = require("../config/db");
const { COLUMNS } = require("./product-import.service");

const EXAMPLE_ROW = {
  sku: "TS-1001",
  name: "Floral Cotton Bedsheet",
  slug: "floral-cotton-bedsheet",
  description: "Hand block printed cotton bedsheet.",
  category: "Bedsheets",
  price: "1499.00",
  stock_quantity: "20",
  is_published: "TRUE",
  image_1: "https://example.com/images/ts-1001-1.jpg",
  alt_text_1: "Floral cotton bedsheet, front view",
  image_2: "",
  alt_text_2: "",
  image_3: "",
  alt_text_3: "",
  image_4: "",
  alt_text_4: "",
  image_5: "",
  alt_text_5: "",
};

async function buildImportTemplate() {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet("Products");
  sheet.columns = COLUMNS.map((c) => ({
    header: c.header + (c.required ? " *" : ""),
    key: c.key,
    width: 22,
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(EXAMPLE_ROW);
  sheet.getRow(2).font = { italic: true, color: { argb: "FF888888" } };

  const categoriesResult = await pool.query(
    `SELECT name, slug, is_active FROM categories ORDER BY name ASC`
  );

  const categoriesSheet = workbook.addWorksheet("Valid Categories");
  categoriesSheet.columns = [
    { header: "name (use this in the category column)", key: "name", width: 36 },
    { header: "slug", key: "slug", width: 24 },
    { header: "active", key: "is_active", width: 10 },
  ];
  categoriesSheet.getRow(1).font = { bold: true };
  for (const category of categoriesResult.rows) {
    categoriesSheet.addRow(category);
  }

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.columns = [{ key: "text", width: 100 }];
  const lines = [
    "Bulk Product Import -- Instructions",
    "",
    "1. Fill in the 'Products' sheet. Row 2 is an example -- replace or delete it.",
    "2. Columns marked with * are required.",
    "3. 'category' must exactly match a name on the 'Valid Categories' sheet",
    "   (matching ignores case, spacing, and punctuation -- e.g. 'handmade bags'",
    "   matches 'Handmade Bags'). Categories are not created automatically --",
    "   ask an admin to add a new category first if it's missing.",
    "4. 'sku' is the permanent product identifier. Re-uploading a file with an",
    "   existing SKU updates that product; a new SKU creates a new product.",
    "5. image_1 is required; image_2-5 are optional. Each must be a public",
    "   http(s) URL the server can fetch -- not a local file path.",
    "6. price must be a positive number. stock_quantity must be 0 or more.",
    "7. is_published: TRUE or FALSE (blank = FALSE, not published).",
    "8. Do not use formulas in any cell -- plain values only.",
  ];
  for (const line of lines) instructionsSheet.addRow({ text: line });

  return workbook;
}

module.exports = { buildImportTemplate };
