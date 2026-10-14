const Razorpay = require("razorpay");
require("dotenv").config();

// Lazily constructed: the Razorpay SDK throws synchronously if key_id is
// missing. Since this module is required at app startup (via the payments
// router), constructing eagerly would crash the ENTIRE server -- including
// every unrelated route -- whenever Razorpay credentials aren't configured
// yet (e.g. local dev, CI). Only an actual attempt to create a payment
// order needs real credentials, so only that call path fails.
let instance = null;

function getRazorpay() {
  if (!instance) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error(
        "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set to process payments"
      );
    }

    instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  return instance;
}

module.exports = { getRazorpay };
