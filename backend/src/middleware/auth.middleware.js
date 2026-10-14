// Protects admin routes. Verifies the JWT access token AND re-checks
// that its session is still active (not revoked/expired) in Postgres on
// every request -- so logging out (or a forced session revocation on
// next login) takes effect immediately, not just when the access token
// naturally expires. Ported from
// https://github.com/sanchittandon86/Login-application.
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token is required",
    });
  }

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured");
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    if (!decoded.adminId || !decoded.sessionId) {
      return res.status(401).json({
        success: false,
        message: "Invalid or revoked session",
      });
    }

    const result = await pool.query(
      `SELECT 1
       FROM admin_refresh_tokens
       WHERE admin_id = $1
         AND session_id = $2
         AND revoked_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [decoded.adminId, decoded.sessionId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Session expired or revoked. Please log in again.",
      });
    }

    req.admin = decoded;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Access token has expired",
      });
    }

    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid access token",
      });
    }

    console.error("Admin auth error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
}

module.exports = authMiddleware;
