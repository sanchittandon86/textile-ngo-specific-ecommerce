// Dedicated Cloudinary service -- the only place the Cloudinary SDK is
// called from. Route handlers and the import service never touch the
// SDK directly.
const { getCloudinary } = require("../config/cloudinary");

const SKU_FOR_PATH_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

function buildFolder(sku) {
  if (!SKU_FOR_PATH_PATTERN.test(sku)) {
    // Defense in depth: the import service validates sku format before
    // any Cloudinary call happens, but this guards against the function
    // ever being called with an unsanitized value from elsewhere.
    throw new Error(`Refusing to build a Cloudinary path from unsafe sku: ${sku}`);
  }

  return `textile-store/products/${sku}`;
}

function buildCategoryFolder(slug) {
  if (!SKU_FOR_PATH_PATTERN.test(slug)) {
    throw new Error(`Refusing to build a Cloudinary path from unsafe category slug: ${slug}`);
  }

  return `textile-store/categories/${slug}`;
}

// Fetches `sourceUrl` (Cloudinary does the fetching server-side) and
// stores it under a deterministic, server-constructed path -- the
// client/Excel never supplies a Cloudinary path directly, only the sku
// (already format-validated) and the slot number (1-5).
async function uploadProductImage(sourceUrl, { sku, slot }) {
  const cloudinary = getCloudinary();

  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder: buildFolder(sku),
    public_id: `image-${slot}`,
    overwrite: true,
    resource_type: "image",
  });

  return { secureUrl: result.secure_url, publicId: result.public_id };
}

// One image per category, same deterministic-path/overwrite approach as
// products -- re-creating a category with the same slug (after a prior
// deactivation, say) safely replaces rather than orphans the old asset.
async function uploadCategoryImage(sourceUrl, { slug }) {
  const cloudinary = getCloudinary();

  const result = await cloudinary.uploader.upload(sourceUrl, {
    folder: buildCategoryFolder(slug),
    public_id: "image",
    overwrite: true,
    resource_type: "image",
  });

  return { secureUrl: result.secure_url, publicId: result.public_id };
}

// Best-effort delete, used both for normal image replacement and for
// cleaning up orphaned uploads after a failed import/create. Never
// throws -- callers are already in a cleanup/error path and a failed
// delete here shouldn't mask or interrupt it (Cloudinary's dashboard
// can always clean up an orphaned asset manually as a last resort).
async function deleteCloudinaryAsset(publicId) {
  try {
    const cloudinary = getCloudinary();
    await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
  } catch (error) {
    console.error(`Failed to delete Cloudinary asset ${publicId}:`, error.message);
  }
}

module.exports = {
  uploadProductImage,
  uploadCategoryImage,
  deleteProductImage: deleteCloudinaryAsset,
  deleteCategoryImage: deleteCloudinaryAsset,
  buildFolder,
  buildCategoryFolder,
};
