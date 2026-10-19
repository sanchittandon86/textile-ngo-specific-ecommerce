require("dotenv").config();

// Lazily constructed, same reasoning as src/config/razorpay.js and
// src/config/cloudinary.js: this module is required at app startup (via
// notification.service.js), and constructing the client eagerly would
// fail every unrelated route if RESEND_API_KEY isn't set yet. Only an
// actual attempt to send an email needs a real key.
let instance = null;

function getResend() {
  if (!instance) {
    if (!process.env.RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY must be set to send email");
    }

    const { Resend } = require("resend");
    instance = new Resend(process.env.RESEND_API_KEY);
  }

  return instance;
}

module.exports = { getResend };
