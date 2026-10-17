// Fails fast at startup instead of letting a missing/weak env var
// surface as a confusing failure deep inside some later request (e.g.
// JWT_SECRET missing only showing up the first time someone hits an
// admin route). Only checks vars the app is fundamentally unusable
// without -- Razorpay/Cloudinary stay lazily validated at the point of
// use (see config/razorpay.js, config/cloudinary.js), since those are
// optional features, not core to booting the server.
const REQUIRED_VARS = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
];

const MIN_SECRET_LENGTH = 32;

function validateEnv() {
  const errors = [];

  for (const key of REQUIRED_VARS) {
    if (!process.env[key] || !String(process.env[key]).trim()) {
      errors.push(`${key} is required but not set`);
    }
  }

  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < MIN_SECRET_LENGTH) {
    errors.push(`JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  if (process.env.JWT_REFRESH_SECRET && process.env.JWT_REFRESH_SECRET.length < MIN_SECRET_LENGTH) {
    errors.push(`JWT_REFRESH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  if (
    process.env.JWT_SECRET &&
    process.env.JWT_REFRESH_SECRET &&
    process.env.JWT_SECRET === process.env.JWT_REFRESH_SECRET
  ) {
    errors.push("JWT_SECRET and JWT_REFRESH_SECRET must be different values");
  }

  if (process.env.NODE_ENV === "production" && !process.env.CLIENT_URL) {
    errors.push("CLIENT_URL is required in production (CORS would otherwise default to localhost)");
  }

  return errors;
}

module.exports = validateEnv;
