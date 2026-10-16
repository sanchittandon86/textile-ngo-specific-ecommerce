// Bulk product catalog import.
//
// Two-phase, safe-by-construction:
//   validateImportFile()  -- Phase 1. Pure read: parses the workbook,
//     validates everything, never touches Postgres or Cloudinary.
//   importFile()           -- Phase 2. Re-runs the exact same validation
//     first (so it's impossible to import a file that wasn't validated),
//     then uploads images and runs one DB transaction. If anything
//     fails before the transaction commits, nothing is left behind:
//     Cloudinary uploads made during this run are deleted and the DB
//     transaction (if it was even reached) is rolled back.
//
// See docs/product-import.md for the full column reference, category
// normalization rule, and idempotency behavior.
const ExcelJS = require("exceljs");
const pool = require("../config/db");
const { uploadProductImage, deleteProductImage } = require("./cloudinary.service");

const MAX_IMAGE_SLOTS = 5;
const IMAGE_UPLOAD_BATCH_SIZE = 5;

const SKU_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const URL_PATTERN = /^https?:\/\/\S+$/i;

const COLUMNS = [
  { key: "sku", header: "sku", required: true },
  { key: "name", header: "name", required: true },
  { key: "slug", header: "slug", required: true },
  { key: "description", header: "description", required: false },
  { key: "category", header: "category", required: true },
  { key: "price", header: "price", required: true },
  { key: "stock_quantity", header: "stock_quantity", required: true },
  { key: "is_published", header: "is_published", required: false },
  { key: "image_1", header: "image_1", required: true },
  { key: "alt_text_1", header: "alt_text_1", required: false },
  { key: "image_2", header: "image_2", required: false },
  { key: "alt_text_2", header: "alt_text_2", required: false },
  { key: "image_3", header: "image_3", required: false },
  { key: "alt_text_3", header: "alt_text_3", required: false },
  { key: "image_4", header: "image_4", required: false },
  { key: "alt_text_4", header: "alt_text_4", required: false },
  { key: "image_5", header: "image_5", required: false },
  { key: "alt_text_5", header: "alt_text_5", required: false },
];

function normalizeCategoryValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return null; // invalid
}

// Reads a cell's plain value, rejecting formula cells outright --
// exceljs never executes formulas, but we don't even want to trust a
// formula's last-cached result for data that becomes a product record.
function readCell(row, columnIndex) {
  const cell = row.getCell(columnIndex);

  if (cell.type === ExcelJS.ValueType.Formula) {
    return { isFormula: true, value: null };
  }

  if (cell.type === ExcelJS.ValueType.Null) {
    return { isFormula: false, value: null };
  }

  if (cell.type === ExcelJS.ValueType.RichText) {
    return { isFormula: false, value: cell.text };
  }

  return { isFormula: false, value: cell.value };
}

async function parseWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error("The uploaded file is not a valid .xlsx workbook."), {
      code: "INVALID_FILE",
    });
  }

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw Object.assign(new Error("The workbook has no worksheets."), {
      code: "INVALID_FILE",
    });
  }

  return worksheet;
}

// Maps each expected column to its 1-based column index by reading the
// header row, case-insensitively. Returns null (and an error) if any
// required header is missing.
function mapHeaders(worksheet) {
  const headerRow = worksheet.getRow(1);
  const indexByKey = {};

  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const header = normalizeHeader(cell.value);
    const column = COLUMNS.find((c) => c.header === header);
    if (column) indexByKey[column.key] = colNumber;
  });

  const missing = COLUMNS.filter((c) => c.required && !indexByKey[c.key]);

  return { indexByKey, missing };
}

function imageSlots(rowValues) {
  const slots = [];

  for (let slot = 1; slot <= MAX_IMAGE_SLOTS; slot += 1) {
    const url = rowValues[`image_${slot}`];
    const altText = rowValues[`alt_text_${slot}`];

    if (url !== null && url !== undefined && String(url).trim() !== "") {
      slots.push({ slot, url: String(url).trim(), altText: altText ? String(altText).trim() : null });
    }
  }

  return slots;
}

// Parses + validates the whole workbook. Never touches Postgres or
// Cloudinary -- category/sku existence checks use a single batched
// lookup each, computed here, not one query per row.
async function validateImportFile(buffer) {
  const errors = [];
  const warnings = [];

  let worksheet;

  try {
    worksheet = await parseWorkbook(buffer);
  } catch (error) {
    return {
      success: false,
      summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
      errors: [{ row: 0, field: "file", message: error.message }],
      warnings: [],
      plan: null,
    };
  }

  const { indexByKey, missing } = mapHeaders(worksheet);

  if (missing.length > 0) {
    return {
      success: false,
      summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
      errors: missing.map((c) => ({
        row: 0,
        field: c.key,
        message: `Required column "${c.header}" is missing from the uploaded file.`,
      })),
      warnings: [],
      plan: null,
    };
  }

  const dataRows = [];
  const lastRow = worksheet.actualRowCount;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (row.cellCount === 0) continue;

    const rowValues = {};
    let hasAnyValue = false;
    let hasFormula = false;

    for (const column of COLUMNS) {
      const colIndex = indexByKey[column.key];
      if (!colIndex) continue;

      const { isFormula, value } = readCell(row, colIndex);
      if (isFormula) hasFormula = true;
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        hasAnyValue = true;
      }
      rowValues[column.key] = value;
    }

    if (!hasAnyValue) continue; // fully blank row, skip silently

    if (hasFormula) {
      errors.push({
        row: rowNumber,
        field: "file",
        message: "Formulas are not allowed in any cell -- use plain values only.",
      });
      continue;
    }

    dataRows.push({ rowNumber, rowValues });
  }

  if (dataRows.length === 0) {
    return {
      success: false,
      summary: { totalRows: 0, validRows: 0, invalidRows: 0 },
      errors: [{ row: 0, field: "file", message: "The file has no data rows." }],
      warnings: [],
      plan: null,
    };
  }

  // ---- per-row field validation ----
  const parsedRows = [];

  for (const { rowNumber, rowValues } of dataRows) {
    const rowErrors = [];

    const sku = String(rowValues.sku || "").trim();
    if (!sku) {
      rowErrors.push({ field: "sku", message: "SKU is required." });
    } else if (!SKU_PATTERN.test(sku)) {
      rowErrors.push({
        field: "sku",
        message: "SKU must be 1-50 characters: letters, numbers, hyphens, underscores only.",
      });
    }

    const name = String(rowValues.name || "").trim();
    if (!name) {
      rowErrors.push({ field: "name", message: "Name is required." });
    } else if (name.length > 200) {
      rowErrors.push({ field: "name", message: "Name must be 200 characters or fewer." });
    }

    const slug = String(rowValues.slug || "").trim().toLowerCase();
    if (!slug) {
      rowErrors.push({ field: "slug", message: "Slug is required." });
    } else if (!SLUG_PATTERN.test(slug)) {
      rowErrors.push({
        field: "slug",
        message: "Slug must be lowercase letters, numbers and hyphens only (e.g. cotton-bedsheet).",
      });
    } else if (slug.length > 220) {
      rowErrors.push({ field: "slug", message: "Slug must be 220 characters or fewer." });
    }

    const description = rowValues.description ? String(rowValues.description).trim() : null;

    const categoryRaw = String(rowValues.category || "").trim();
    const categoryNormalized = normalizeCategoryValue(categoryRaw);
    if (!categoryRaw) {
      rowErrors.push({ field: "category", message: "Category is required." });
    }

    let price = null;
    if (rowValues.price === null || rowValues.price === undefined || rowValues.price === "") {
      rowErrors.push({ field: "price", message: "Price is required." });
    } else {
      price = Number(rowValues.price);
      if (!Number.isFinite(price) || price <= 0) {
        rowErrors.push({ field: "price", message: "Price must be a positive number." });
      }
    }

    let stockQuantity = null;
    if (
      rowValues.stock_quantity === null ||
      rowValues.stock_quantity === undefined ||
      rowValues.stock_quantity === ""
    ) {
      rowErrors.push({ field: "stock_quantity", message: "Stock quantity is required." });
    } else {
      stockQuantity = Number(rowValues.stock_quantity);
      if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        rowErrors.push({
          field: "stock_quantity",
          message: "Stock quantity must be a non-negative whole number.",
        });
      }
    }

    const isPublished = parseBoolean(rowValues.is_published, false);
    if (isPublished === null) {
      rowErrors.push({
        field: "is_published",
        message: 'is_published must be TRUE/FALSE (or blank for FALSE).',
      });
    }

    const images = imageSlots(rowValues);
    const image1 = images.find((i) => i.slot === 1);
    if (!image1) {
      rowErrors.push({ field: "image_1", message: "At least one image (image_1) is required." });
    }
    for (const image of images) {
      if (!URL_PATTERN.test(image.url)) {
        rowErrors.push({
          field: `image_${image.slot}`,
          message: `image_${image.slot} must be a valid http(s) URL.`,
        });
      }
    }

    if (rowErrors.length > 0) {
      for (const err of rowErrors) errors.push({ row: rowNumber, ...err });
      continue;
    }

    parsedRows.push({
      rowNumber,
      sku,
      name,
      slug,
      description,
      categoryRaw,
      categoryNormalized,
      price: price.toFixed(2),
      stockQuantity,
      isPublished,
      images,
    });
  }

  // ---- within-file duplicate / conflict checks ----
  const skuToRows = new Map();
  const slugToRows = new Map();

  for (const row of parsedRows) {
    if (!skuToRows.has(row.sku)) skuToRows.set(row.sku, []);
    skuToRows.get(row.sku).push(row.rowNumber);

    if (!slugToRows.has(row.slug)) slugToRows.set(row.slug, []);
    slugToRows.get(row.slug).push(row.rowNumber);
  }

  const duplicateSkuRows = new Set();
  const duplicateSlugRows = new Set();

  for (const [sku, rows] of skuToRows) {
    if (rows.length > 1) {
      for (const r of rows) {
        errors.push({ row: r, field: "sku", message: `Duplicate SKU "${sku}" appears in multiple rows in this file.` });
        duplicateSkuRows.add(r);
      }
    }
  }

  for (const [slug, rows] of slugToRows) {
    if (rows.length > 1) {
      for (const r of rows) {
        errors.push({ row: r, field: "slug", message: `Duplicate slug "${slug}" appears in multiple rows in this file.` });
        duplicateSlugRows.add(r);
      }
    }
  }

  // ---- category existence (single batched query) ----
  const categoriesResult = await pool.query(`SELECT id, name, slug FROM categories`);
  const categoryBySlug = new Map(categoriesResult.rows.map((c) => [c.slug, c]));

  for (const row of parsedRows) {
    if (duplicateSkuRows.has(row.rowNumber) || duplicateSlugRows.has(row.rowNumber)) continue;

    const category = categoryBySlug.get(row.categoryNormalized);
    if (!category) {
      errors.push({
        row: row.rowNumber,
        field: "category",
        message: `Category "${row.categoryRaw}" does not exist.`,
      });
    }
  }

  // ---- existing products (single batched query) ----
  const skusToLookUp = parsedRows.map((r) => r.sku);
  const existingResult =
    skusToLookUp.length > 0
      ? await pool.query(
          `SELECT id, sku, name, slug, description, category_id, price, stock_quantity, is_published
           FROM products
           WHERE sku = ANY($1::text[])`,
          [skusToLookUp]
        )
      : { rows: [] };
  const existingBySku = new Map(existingResult.rows.map((p) => [p.sku, p]));

  // A row's slug must not collide with a DIFFERENT existing product's slug.
  const slugOwnerResult = await pool.query(`SELECT id, sku, slug FROM products WHERE slug = ANY($1::text[])`, [
    parsedRows.map((r) => r.slug),
  ]);
  const productBySlug = new Map(slugOwnerResult.rows.map((p) => [p.slug, p]));

  for (const row of parsedRows) {
    if (duplicateSkuRows.has(row.rowNumber) || duplicateSlugRows.has(row.rowNumber)) continue;

    const slugOwner = productBySlug.get(row.slug);
    if (slugOwner && slugOwner.sku !== row.sku) {
      errors.push({
        row: row.rowNumber,
        field: "slug",
        message: `Slug "${row.slug}" is already used by a different product (SKU ${slugOwner.sku || slugOwner.id}).`,
      });
    }
  }

  const invalidRowNumbers = new Set(errors.filter((e) => e.row > 0).map((e) => e.row));
  const validRows = parsedRows.filter((r) => !invalidRowNumbers.has(r.rowNumber));

  const summary = {
    totalRows: dataRows.length,
    validRows: dataRows.length - invalidRowNumbers.size,
    invalidRows: invalidRowNumbers.size,
  };

  return {
    success: errors.length === 0,
    summary,
    errors,
    warnings,
    plan:
      errors.length === 0
        ? { rows: validRows, categoryBySlug, existingBySku }
        : null,
  };
}

// Uploads images for one row, skipping any image whose source URL is
// unchanged from what's already stored for that product+slot -- this is
// the idempotency rule: re-importing the same file re-uses existing
// Cloudinary assets instead of re-uploading them.
async function planRowImages(row, existingProduct) {
  let existingImages = [];

  if (existingProduct) {
    const result = await pool.query(
      `SELECT sort_order, source_url, cloudinary_public_id, image_url
       FROM product_images WHERE product_id = $1`,
      [existingProduct.id]
    );
    existingImages = result.rows;
  }

  const existingBySlot = new Map(existingImages.map((i) => [i.sort_order, i]));
  const toUpload = [];
  const reused = [];

  for (const image of row.images) {
    const existing = existingBySlot.get(image.slot);
    if (existing && existing.source_url === image.url) {
      reused.push({ ...image, cloudinaryPublicId: existing.cloudinary_public_id, imageUrl: existing.image_url });
    } else {
      toUpload.push(image);
    }
  }

  // Slots that existed before but are no longer present in this row
  // should be removed (the Excel row defines the full current image set).
  const slotsInRow = new Set(row.images.map((i) => i.slot));
  const toDelete = existingImages.filter((i) => !slotsInRow.has(i.sort_order));

  return { toUpload, reused, toDelete };
}

async function uploadInBatches(items, uploadFn) {
  const results = [];

  for (let i = 0; i < items.length; i += IMAGE_UPLOAD_BATCH_SIZE) {
    const batch = items.slice(i, i + IMAGE_UPLOAD_BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(uploadFn));
    results.push(...batchResults);
  }

  return results;
}

// Phase 2. Re-validates first (never trusts a stale client-side
// "validation passed" state), then uploads images and runs one DB
// transaction for the whole file.
async function importFile(buffer) {
  const validation = await validateImportFile(buffer);

  if (!validation.success) {
    return validation;
  }

  const { rows } = validation.plan;

  // ---- decide what each row needs (no-op / create / update) ----
  const rowPlans = [];

  for (const row of rows) {
    const existing = validation.plan.existingBySku.get(row.sku);
    const imagePlan = await planRowImages(row, existing);

    let isNoOp = false;
    if (existing) {
      const category = validation.plan.categoryBySlug.get(row.categoryNormalized);
      isNoOp =
        imagePlan.toUpload.length === 0 &&
        imagePlan.toDelete.length === 0 &&
        existing.name === row.name &&
        existing.slug === row.slug &&
        (existing.description || null) === row.description &&
        existing.category_id === category.id &&
        Number(existing.price).toFixed(2) === row.price &&
        existing.stock_quantity === row.stockQuantity &&
        existing.is_published === row.isPublished;
    }

    rowPlans.push({ row, existing, imagePlan, isNoOp, isCreate: !existing });
  }

  // ---- upload phase (outside any DB transaction) ----
  const uploaded = []; // every successful upload this run, for cleanup-on-failure
  const uploadQueue = [];

  for (const plan of rowPlans) {
    if (plan.isNoOp) continue;
    for (const image of plan.imagePlan.toUpload) {
      uploadQueue.push({ row: plan.row, image });
    }
  }

  let uploadFailure = null;

  try {
    const results = await uploadInBatches(uploadQueue, async ({ row, image }) => {
      const result = await uploadProductImage(image.url, { sku: row.sku, slot: image.slot });
      uploaded.push(result.publicId);
      return { row, image, ...result };
    });

    // attach upload results back onto their row plan
    for (const { row, image, secureUrl, publicId } of results) {
      const plan = rowPlans.find((p) => p.row === row);
      image.cloudinaryPublicId = publicId;
      image.imageUrl = secureUrl;
    }
  } catch (error) {
    uploadFailure = error;
  }

  if (uploadFailure) {
    for (const publicId of uploaded) {
      await deleteProductImage(publicId);
    }

    return {
      success: false,
      summary: { totalRows: validation.summary.totalRows, validRows: 0, invalidRows: 0 },
      errors: [
        {
          row: 0,
          field: "image",
          message: `Image upload failed: ${uploadFailure.message}. No changes were made.`,
        },
      ],
      warnings: [],
      plan: null,
    };
  }

  // ---- DB transaction ----
  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let imagesUploaded = uploaded.length;

  try {
    await client.query("BEGIN");

    for (const plan of rowPlans) {
      const { row, existing, imagePlan, isNoOp, isCreate } = plan;

      if (isNoOp) {
        skipped += 1;
        continue;
      }

      const category = validation.plan.categoryBySlug.get(row.categoryNormalized);
      let productId;

      if (isCreate) {
        const insertResult = await client.query(
          `INSERT INTO products (sku, name, slug, description, category_id, price, stock_quantity, is_published)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [row.sku, row.name, row.slug, row.description, category.id, row.price, row.stockQuantity, row.isPublished]
        );
        productId = insertResult.rows[0].id;
        created += 1;
      } else {
        await client.query(
          `UPDATE products
           SET name = $1, slug = $2, description = $3, category_id = $4,
               price = $5, stock_quantity = $6, is_published = $7, updated_at = NOW()
           WHERE id = $8`,
          [row.name, row.slug, row.description, category.id, row.price, row.stockQuantity, row.isPublished, existing.id]
        );
        productId = existing.id;
        updated += 1;
      }

      for (const stale of imagePlan.toDelete) {
        await client.query(`DELETE FROM product_images WHERE product_id = $1 AND sort_order = $2`, [
          productId,
          stale.sort_order,
        ]);
      }

      for (const image of row.images) {
        const isReused = imagePlan.reused.some((r) => r.slot === image.slot);

        if (isReused) {
          await client.query(
            `UPDATE product_images SET alt_text = $1, is_primary = $2, updated_at = NOW()
             WHERE product_id = $3 AND sort_order = $4`,
            [image.altText, image.slot === 1, productId, image.slot]
          );
        } else {
          await client.query(
            `INSERT INTO product_images
               (product_id, cloudinary_public_id, image_url, source_url, alt_text, sort_order, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (product_id, sort_order) DO UPDATE
               SET cloudinary_public_id = EXCLUDED.cloudinary_public_id,
                   image_url = EXCLUDED.image_url,
                   source_url = EXCLUDED.source_url,
                   alt_text = EXCLUDED.alt_text,
                   is_primary = EXCLUDED.is_primary,
                   updated_at = NOW()`,
            [
              productId,
              image.cloudinaryPublicId,
              image.imageUrl,
              image.url,
              image.altText,
              image.slot,
              image.slot === 1,
            ]
          );
        }
      }

      // Keep the legacy single-image field in sync for the public
      // storefront, which reads products.image_url directly and is out
      // of scope to modify.
      const primaryImage = row.images.find((i) => i.slot === 1);
      await client.query(`UPDATE products SET image_url = $1 WHERE id = $2`, [
        primaryImage.imageUrl,
        productId,
      ]);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");

    for (const publicId of uploaded) {
      await deleteProductImage(publicId);
    }

    console.error("Product import transaction failed:", error.message);

    return {
      success: false,
      summary: { totalRows: validation.summary.totalRows, validRows: 0, invalidRows: 0 },
      errors: [{ row: 0, field: "database", message: "Import failed while saving to the database. No changes were made." }],
      warnings: [],
      plan: null,
    };
  } finally {
    client.release();
  }

  return {
    success: true,
    summary: {
      totalRows: validation.summary.totalRows,
      created,
      updated,
      skipped,
      imagesUploaded,
    },
    errors: [],
    warnings: validation.warnings,
  };
}

module.exports = {
  COLUMNS,
  normalizeCategoryValue,
  validateImportFile,
  importFile,
};
