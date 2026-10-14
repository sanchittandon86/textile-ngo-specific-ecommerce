const crypto = require("crypto");
const pool = require("../config/db");

// Raw guest tokens are 32 random bytes hex-encoded (64 hex characters).
const TOKEN_HEX_PATTERN = /^[a-f0-9]{64}$/i;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function guestCart(req, res, next) {
  const token = req.header("X-Cart-Token");

  if (!token || !TOKEN_HEX_PATTERN.test(token)) {
    return res.status(401).json({
      success: false,
      message: "Missing or malformed cart token",
    });
  }

  try {
    const tokenHash = hashToken(token);

    const result = await pool.query(
      `SELECT id
       FROM carts
       WHERE token_hash = $1
         AND expires_at > NOW()`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Cart token is invalid or expired",
      });
    }

    req.cartId = result.rows[0].id;
    return next();
  } catch (error) {
    console.error("Guest cart lookup failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to validate cart token",
    });
  }
}

module.exports = guestCart;
module.exports.hashToken = hashToken;
module.exports.TOKEN_HEX_PATTERN = TOKEN_HEX_PATTERN;
