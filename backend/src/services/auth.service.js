// Admin authentication. Logic ported from
// https://github.com/sanchittandon86/Login-application: bcrypt password
// hashing, short-lived JWT access token + long-lived httpOnly refresh
// token cookie, refresh-token rotation, single-active-session enforcement
// (logging in revokes any prior session), and DB-backed session
// revocation checked on every access-token verification (so a stolen
// access token stops working immediately after logout, not just at
// natural expiry).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../config/db");

const REFRESH_COOKIE_NAME = "adminRefreshToken";
const REFRESH_COOKIE_PATH = "/api/auth";

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: REFRESH_COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function createAccessToken(admin, sessionId) {
  return jwt.sign(
    { adminId: admin.id, email: admin.email, sessionId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "15m" }
  );
}

function createRefreshToken(admin, sessionId) {
  return jwt.sign(
    { adminId: admin.id, sessionId, jti: crypto.randomUUID() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d" }
  );
}

function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function login(email, password) {
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    console.error("JWT secrets are not configured");
    return { ok: false, status: 500, message: "Internal server error" };
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  const result = await pool.query(
    `SELECT id, name, email, password_hash FROM admin_users WHERE email = $1`,
    [normalizedEmail]
  );

  if (result.rows.length === 0) {
    return { ok: false, status: 401, message: "Invalid email or password" };
  }

  const admin = result.rows[0];
  const isPasswordValid = await bcrypt.compare(password, admin.password_hash);

  if (!isPasswordValid) {
    return { ok: false, status: 401, message: "Invalid email or password" };
  }

  const sessionId = crypto.randomUUID();
  const accessToken = createAccessToken(admin, sessionId);
  const refreshToken = createRefreshToken(admin, sessionId);
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(jwt.decode(refreshToken).exp * 1000);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Serializes concurrent logins for the same admin.
    await client.query("SELECT id FROM admin_users WHERE id = $1 FOR UPDATE", [
      admin.id,
    ]);

    // Only one active session per admin -- revoke any prior session.
    await client.query(
      `UPDATE admin_refresh_tokens
       SET revoked_at = NOW()
       WHERE admin_id = $1 AND revoked_at IS NULL`,
      [admin.id]
    );

    await client.query(
      `INSERT INTO admin_refresh_tokens (admin_id, token_hash, session_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [admin.id, tokenHash, sessionId, expiresAt]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    data: {
      accessToken,
      user: { id: admin.id, name: admin.name, email: admin.email },
    },
    refreshToken,
  };
}

async function refresh(refreshToken) {
  if (!refreshToken) {
    return { ok: false, status: 400, message: "Refresh token is required" };
  }

  if (!process.env.JWT_REFRESH_SECRET || !process.env.JWT_SECRET) {
    console.error("JWT secrets are not configured");
    return { ok: false, status: 500, message: "Internal server error" };
  }

  let decoded;

  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
    });

    if (!decoded.adminId || !decoded.sessionId) {
      return { ok: false, status: 401, message: "Invalid refresh token" };
    }
  } catch {
    return { ok: false, status: 401, message: "Invalid or expired refresh token" };
  }

  const tokenHash = hashRefreshToken(refreshToken);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Revoke the presented token only if it's still active and matches
    // the session encoded in it -- this is also what makes reuse of an
    // already-rotated-away token fail safely.
    const oldToken = await client.query(
      `UPDATE admin_refresh_tokens
       SET revoked_at = NOW()
       WHERE token_hash = $1
         AND admin_id = $2
         AND session_id = $3
         AND revoked_at IS NULL
         AND expires_at > NOW()
       RETURNING admin_id, session_id`,
      [tokenHash, decoded.adminId, decoded.sessionId]
    );

    if (oldToken.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 401,
        message: "Refresh token is invalid, revoked, or already used",
      };
    }

    const adminResult = await client.query(
      `SELECT id, name, email FROM admin_users WHERE id = $1`,
      [oldToken.rows[0].admin_id]
    );

    if (adminResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, status: 401, message: "Admin no longer exists" };
    }

    const admin = adminResult.rows[0];
    const sessionId = oldToken.rows[0].session_id;

    const accessToken = createAccessToken(admin, sessionId);
    const newRefreshToken = createRefreshToken(admin, sessionId);
    const newTokenHash = hashRefreshToken(newRefreshToken);
    const expiresAt = new Date(jwt.decode(newRefreshToken).exp * 1000);

    await client.query(
      `INSERT INTO admin_refresh_tokens (admin_id, token_hash, session_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [admin.id, newTokenHash, sessionId, expiresAt]
    );

    await client.query("COMMIT");

    return { ok: true, data: { accessToken }, refreshToken: newRefreshToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function logout(refreshToken) {
  if (!refreshToken) {
    return { ok: false, status: 400, message: "Refresh token is required" };
  }

  if (!process.env.JWT_REFRESH_SECRET) {
    console.error("JWT_REFRESH_SECRET is not configured");
    return { ok: false, status: 500, message: "Internal server error" };
  }

  let decoded;

  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, {
      algorithms: ["HS256"],
    });
  } catch {
    return { ok: false, status: 401, message: "Invalid or expired refresh token" };
  }

  if (!decoded.adminId || !decoded.sessionId) {
    return { ok: false, status: 401, message: "Invalid refresh token" };
  }

  await pool.query(
    `UPDATE admin_refresh_tokens
     SET revoked_at = NOW()
     WHERE admin_id = $1 AND session_id = $2 AND revoked_at IS NULL`,
    [decoded.adminId, decoded.sessionId]
  );

  return { ok: true };
}

async function getProfile(adminId) {
  const result = await pool.query(
    `SELECT id, name, email, created_at FROM admin_users WHERE id = $1`,
    [adminId]
  );

  if (result.rows.length === 0) {
    return { ok: false, status: 404, message: "Admin not found" };
  }

  return { ok: true, data: result.rows[0] };
}

module.exports = {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  refreshCookieOptions,
  login,
  refresh,
  logout,
  getProfile,
};
