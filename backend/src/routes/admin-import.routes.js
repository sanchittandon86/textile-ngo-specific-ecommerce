// Bulk product catalog import endpoints. Mounted at
// /api/admin/products/import -- every route here requires admin auth.
const express = require("express");
const multer = require("multer");
const authMiddleware = require("../middleware/auth.middleware");
const { buildImportTemplate } = require("../services/product-template.service");
const { validateImportFile, importFile } = require("../services/product-import.service");

const router = express.Router();

router.use(authMiddleware);

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const isXlsxExtension = /\.xlsx$/i.test(file.originalname || "");
    const isXlsxMimeType = file.mimetype === XLSX_MIME_TYPE;

    if (!isXlsxExtension || !isXlsxMimeType) {
      return cb(new Error("UNSUPPORTED_FILE_TYPE"));
    }

    cb(null, true);
  },
}).single("file");

// Wraps multer so its errors come back in this API's normal
// { success, message } shape instead of multer's default error page.
function handleUpload(req, res, next) {
  upload(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        success: false,
        message: `File is too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
      });
    }

    if (err.message === "UNSUPPORTED_FILE_TYPE") {
      return res.status(400).json({
        success: false,
        message: "Only .xlsx files are accepted.",
      });
    }

    console.error("Import upload failed:", err.message);
    return res.status(400).json({ success: false, message: "Unable to process the upload." });
  });
}

router.get("/template", async (req, res) => {
  try {
    const workbook = await buildImportTemplate();

    res.setHeader(
      "Content-Type",
      XLSX_MIME_TYPE
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="product-import-template.xlsx"'
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Generate import template failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to generate the import template",
    });
  }
});

router.post("/validate", handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file was uploaded." });
  }

  try {
    const result = await validateImportFile(req.file.buffer);

    return res.status(200).json({
      success: result.success,
      summary: result.summary,
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("Validate import file failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to validate the uploaded file",
    });
  }
});

router.post("/", handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file was uploaded." });
  }

  try {
    const result = await importFile(req.file.buffer);

    if (!result.success) {
      return res.status(422).json({
        success: false,
        summary: result.summary,
        errors: result.errors,
        warnings: result.warnings,
      });
    }

    return res.status(200).json({
      success: true,
      summary: result.summary,
      errors: result.errors,
      warnings: result.warnings,
    });
  } catch (error) {
    console.error("Product import failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Import failed unexpectedly. No changes were made.",
    });
  }
});

module.exports = router;
