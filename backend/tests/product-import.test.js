jest.mock("../src/config/db", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

jest.mock("../src/services/cloudinary.service", () => ({
  uploadProductImage: jest.fn(),
  deleteProductImage: jest.fn(),
}));

process.env.JWT_SECRET = "test_jwt_secret";
process.env.JWT_REFRESH_SECRET = "test_jwt_refresh_secret";

const ExcelJS = require("exceljs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const pool = require("../src/config/db");
const { uploadProductImage, deleteProductImage } = require("../src/services/cloudinary.service");
const { buildImportTemplate } = require("../src/services/product-template.service");
const app = require("../src/app");

function adminToken() {
  return jwt.sign(
    { adminId: 1, email: "admin@example.com", sessionId: "11111111-1111-1111-1111-111111111111" },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
}

const HEADERS = [
  "sku", "name", "slug", "description", "category", "price", "stock_quantity",
  "is_published", "image_1", "alt_text_1", "image_2", "alt_text_2",
  "image_3", "alt_text_3", "image_4", "alt_text_4", "image_5", "alt_text_5",
];

const VALID_ROW = {
  sku: "TS-1001",
  name: "Floral Cotton Bedsheet",
  slug: "floral-cotton-bedsheet",
  description: "Hand block printed.",
  category: "Bedsheets",
  price: 1499,
  stock_quantity: 20,
  is_published: "TRUE",
  image_1: "https://example.com/a.jpg",
  alt_text_1: "front",
};

async function buildWorkbookBuffer(rows, { headers = HEADERS, useCorrectHeaderRow = true } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");

  if (useCorrectHeaderRow) {
    sheet.addRow(headers);
  }

  for (const row of rows) {
    sheet.addRow(headers.map((h) => (row[h] !== undefined ? row[h] : "")));
  }

  return workbook.xlsx.writeBuffer();
}

function setupPool({ categories = [], existingProducts = [], existingImages = [], slugOwners = [] } = {}) {
  pool.query.mockImplementation(async (sql, params = []) => {
    if (sql.includes("FROM categories")) {
      return { rows: categories };
    }
    if (sql.includes("FROM products") && sql.includes("sku = ANY")) {
      return { rows: existingProducts };
    }
    if (sql.includes("FROM products") && sql.includes("slug = ANY")) {
      return { rows: slugOwners };
    }
    if (sql.includes("FROM product_images") && sql.includes("WHERE product_id = $1") && !sql.includes("sort_order = $2")) {
      return { rows: existingImages.filter((i) => i.product_id === params[0]) };
    }
    throw new Error("Unexpected pool.query in test: " + sql);
  });
}

function setupClient({ newProductId = 999 } = {}) {
  const calls = [];
  const client = {
    query: jest.fn(async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.startsWith("INSERT INTO products")) {
        return { rows: [{ id: newProductId }] };
      }
      return {};
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValueOnce(client);
  return { client, calls };
}

const BEDSHEETS_CATEGORY = { id: 1, name: "Bedsheets", slug: "bedsheets" };

describe("Product bulk import", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/admin/products/import/template", () => {
    test("rejects without an access token", async () => {
      const response = await request(app).get("/api/admin/products/import/template");
      expect(response.status).toBe(401);
    });

    test("responds 200 with an xlsx content type", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] }); // auth session check
      pool.query.mockResolvedValueOnce({ rows: [{ name: "Bedsheets", slug: "bedsheets", is_active: true }] });

      const response = await request(app)
        .get("/api/admin/products/import/template")
        .set("Authorization", `Bearer ${adminToken()}`);

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("spreadsheetml");
      expect(response.headers["content-disposition"]).toContain("product-import-template.xlsx");
    });

    // Exercises the workbook-building logic directly (buildImportTemplate
    // already returns an ExcelJS.Workbook, no HTTP binary round-trip
    // needed to inspect its structure).
    test("workbook contains the expected headers and a live categories sheet", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ name: "Bedsheets", slug: "bedsheets", is_active: true }],
      });

      const workbook = await buildImportTemplate();
      const sheet = workbook.getWorksheet("Products");
      const headerRow = sheet.getRow(1).values.filter(Boolean).map(String);

      expect(headerRow.some((h) => h.startsWith("sku"))).toBe(true);
      expect(headerRow.some((h) => h.startsWith("image_1"))).toBe(true);

      const categoriesSheet = workbook.getWorksheet("Valid Categories");
      expect(categoriesSheet).toBeDefined();
      expect(categoriesSheet.getRow(2).getCell(1).value).toBe("Bedsheets");
    });
  });

  describe("POST /api/admin/products/import/validate", () => {
    function post(buffer, filename = "import.xlsx") {
      return request(app)
        .post("/api/admin/products/import/validate")
        .set("Authorization", `Bearer ${adminToken()}`)
        .attach("file", buffer, {
          filename,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
    }

    test("rejects without an access token", async () => {
      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await request(app).post("/api/admin/products/import/validate").attach("file", buffer, "import.xlsx");
      expect(response.status).toBe(401);
    });

    test("rejects a non-xlsx file by extension/mimetype", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] }); // auth session check
      const response = await request(app)
        .post("/api/admin/products/import/validate")
        .set("Authorization", `Bearer ${adminToken()}`)
        .attach("file", Buffer.from("not excel"), { filename: "import.csv", contentType: "text/csv" });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/\.xlsx/);
    });

    test("rejects an oversized file", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const bigBuffer = Buffer.alloc(11 * 1024 * 1024, "a");

      const response = await request(app)
        .post("/api/admin/products/import/validate")
        .set("Authorization", `Bearer ${adminToken()}`)
        .attach("file", bigBuffer, {
          filename: "huge.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toMatch(/too large/i);
    });

    test("rejects a corrupt/invalid workbook", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const response = await post(Buffer.from("this is not a real xlsx file"));

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].message).toMatch(/not a valid/i);
    });

    test("rejects a file missing required columns", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const buffer = await buildWorkbookBuffer([VALID_ROW], { headers: ["sku", "name"] });
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors.some((e) => e.message.includes("slug"))).toBe(true);
    });

    test("rejects an empty file (headers only, no data rows)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const buffer = await buildWorkbookBuffer([]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].message).toMatch(/no data rows/i);
    });

    test("rejects an unknown category", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] }); // session check
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, category: "Totally Made Up" }]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "category", message: expect.stringContaining("does not exist") }),
        ])
      );
    });

    test("matches a category using normalization (case/spacing-insensitive)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, category: "  bedSheets  " }]);
      const response = await post(buffer);

      expect(response.body.success).toBe(true);
    });

    test("rejects duplicate SKUs within the same file", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([
        VALID_ROW,
        { ...VALID_ROW, slug: "floral-cotton-bedsheet-2" },
      ]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors.some((e) => e.field === "sku" && e.message.includes("Duplicate"))).toBe(true);
    });

    test("rejects an invalid (zero/negative) price", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, price: -5 }]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "price" })])
      );
    });

    test("rejects invalid (negative) stock", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, stock_quantity: -1 }]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "stock_quantity" })])
      );
    });

    test("rejects a row missing the required image_1", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, image_1: "" }]);
      const response = await post(buffer);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: "image_1" })])
      );
    });

    test("passes validation for a fully valid file and does not touch Cloudinary", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await post(buffer);

      expect(response.body.success).toBe(true);
      expect(response.body.summary).toEqual({ totalRows: 1, validRows: 1, invalidRows: 0 });
      expect(uploadProductImage).not.toHaveBeenCalled();
      expect(pool.connect).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/admin/products/import", () => {
    function post(buffer) {
      return request(app)
        .post("/api/admin/products/import")
        .set("Authorization", `Bearer ${adminToken()}`)
        .attach("file", buffer, {
          filename: "import.xlsx",
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
    }

    test("rejects without an access token", async () => {
      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await request(app).post("/api/admin/products/import").attach("file", buffer, "import.xlsx");
      expect(response.status).toBe(401);
    });

    test("an invalid file does not touch the database at all", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });

      const buffer = await buildWorkbookBuffer([{ ...VALID_ROW, price: -1 }]);
      const response = await post(buffer);

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(uploadProductImage).not.toHaveBeenCalled();
    });

    test("creates a new product with its image", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });
      uploadProductImage.mockResolvedValueOnce({
        secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/textile-store/products/TS-1001/image-1.jpg",
        publicId: "textile-store/products/TS-1001/image-1",
      });
      const { client, calls } = setupClient({ newProductId: 42 });

      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await post(buffer);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.summary).toEqual({
        totalRows: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        imagesUploaded: 1,
      });
      expect(uploadProductImage).toHaveBeenCalledWith(
        "https://example.com/a.jpg",
        { sku: "TS-1001", slot: 1 }
      );
      expect(calls.some((c) => c.sql.startsWith("INSERT INTO products"))).toBe(true);
      expect(calls.some((c) => c.sql.includes("INSERT INTO product_images"))).toBe(true);
      expect(
        calls.some(
          (c) => c.sql.includes("UPDATE products SET image_url") && c.params[0].includes("image-1.jpg")
        )
      ).toBe(true);
      expect(client.query).toHaveBeenCalledWith("COMMIT");
      expect(client.release).toHaveBeenCalled();
    });

    test("updates an existing product identified by SKU", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const existing = {
        id: 7,
        sku: "TS-1001",
        name: "Old Name",
        slug: "floral-cotton-bedsheet",
        description: "Old description",
        category_id: 1,
        price: "999.00",
        stock_quantity: 5,
        is_published: false,
      };
      setupPool({ categories: [BEDSHEETS_CATEGORY], existingProducts: [existing], existingImages: [] });
      uploadProductImage.mockResolvedValueOnce({
        secureUrl: "https://res.cloudinary.com/demo/image-1.jpg",
        publicId: "textile-store/products/TS-1001/image-1",
      });
      const { client, calls } = setupClient();

      const buffer = await buildWorkbookBuffer([VALID_ROW]); // different name/price/stock/is_published
      const response = await post(buffer);

      expect(response.status).toBe(200);
      expect(response.body.summary.created).toBe(0);
      expect(response.body.summary.updated).toBe(1);
      const updateCall = calls.find((c) => c.sql.startsWith("UPDATE products"));
      expect(updateCall.params).toEqual([
        "Floral Cotton Bedsheet", "floral-cotton-bedsheet", "Hand block printed.", 1, "1499.00", 20, true, 7,
      ]);
    });

    test("multiple images on one row create multiple product_images rows", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });
      uploadProductImage
        .mockResolvedValueOnce({ secureUrl: "https://cdn/1.jpg", publicId: "pub/1" })
        .mockResolvedValueOnce({ secureUrl: "https://cdn/2.jpg", publicId: "pub/2" })
        .mockResolvedValueOnce({ secureUrl: "https://cdn/3.jpg", publicId: "pub/3" });
      const { calls } = setupClient({ newProductId: 42 });

      const row = { ...VALID_ROW, image_2: "https://example.com/b.jpg", image_3: "https://example.com/c.jpg" };
      const buffer = await buildWorkbookBuffer([row]);
      const response = await post(buffer);

      expect(response.body.summary.imagesUploaded).toBe(3);
      const imageInserts = calls.filter((c) => c.sql.includes("INSERT INTO product_images"));
      expect(imageInserts).toHaveLength(3);
    });

    test("re-importing an unchanged file is fully idempotent (no re-upload, row skipped)", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      const existing = {
        id: 7,
        sku: "TS-1001",
        name: "Floral Cotton Bedsheet",
        slug: "floral-cotton-bedsheet",
        description: "Hand block printed.",
        category_id: 1,
        price: "1499.00",
        stock_quantity: 20,
        is_published: true,
      };
      const existingImages = [
        {
          product_id: 7,
          sort_order: 1,
          source_url: "https://example.com/a.jpg",
          cloudinary_public_id: "pub/1",
          image_url: "https://cdn/1.jpg",
        },
      ];
      setupPool({ categories: [BEDSHEETS_CATEGORY], existingProducts: [existing], existingImages });
      setupClient();

      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await post(buffer);

      expect(response.status).toBe(200);
      expect(response.body.summary).toEqual({
        totalRows: 1,
        created: 0,
        updated: 0,
        skipped: 1,
        imagesUploaded: 0,
      });
      expect(uploadProductImage).not.toHaveBeenCalled();
    });

    test("Cloudinary upload failure aborts before any DB write and cleans up partial uploads", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });
      uploadProductImage
        .mockResolvedValueOnce({ secureUrl: "https://cdn/1.jpg", publicId: "pub/1" })
        .mockRejectedValueOnce(new Error("Cloudinary is down"));

      const row1 = { ...VALID_ROW };
      const row2 = { ...VALID_ROW, sku: "TS-1002", slug: "ts-1002", image_1: "https://example.com/bad.jpg" };
      const buffer = await buildWorkbookBuffer([row1, row2]);
      const response = await post(buffer);

      expect(response.status).toBe(422);
      expect(response.body.success).toBe(false);
      expect(response.body.errors[0].message).toMatch(/image upload failed/i);
      expect(pool.connect).not.toHaveBeenCalled();
      expect(deleteProductImage).toHaveBeenCalledWith("pub/1");
    });

    test("database transaction failure rolls back and cleans up uploaded images", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ x: 1 }] });
      setupPool({ categories: [BEDSHEETS_CATEGORY] });
      uploadProductImage.mockResolvedValueOnce({ secureUrl: "https://cdn/1.jpg", publicId: "pub/1" });

      const client = {
        query: jest.fn(async (sql) => {
          if (sql === "BEGIN") return {};
          if (sql.startsWith("INSERT INTO products")) {
            throw new Error("duplicate key value violates unique constraint");
          }
          return {};
        }),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const buffer = await buildWorkbookBuffer([VALID_ROW]);
      const response = await post(buffer);

      expect(response.status).toBe(422);
      expect(response.body.errors[0].field).toBe("database");
      expect(client.query).toHaveBeenCalledWith("ROLLBACK");
      expect(client.release).toHaveBeenCalled();
      expect(deleteProductImage).toHaveBeenCalledWith("pub/1");
    });
  });
});
