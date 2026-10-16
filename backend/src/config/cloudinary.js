require("dotenv").config();

// Lazily configured, same reasoning as src/config/razorpay.js: this
// module is required at app startup (via the import routes), and the
// Cloudinary SDK would otherwise be configured with undefined
// credentials if the env vars aren't set yet -- failing silently until
// the first real upload, with a confusing error far from the cause.
// Failing loudly, but only when an upload is actually attempted, keeps
// every unrelated route working even if Cloudinary isn't configured.
let configured = false;

function getCloudinary() {
  if (!configured) {
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      throw new Error(
        "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must be set to upload images"
      );
    }

    const cloudinary = require("cloudinary").v2;

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });

    configured = true;
  }

  return require("cloudinary").v2;
}

module.exports = { getCloudinary };
