// Admin auth routes. No /register -- admins are seeded directly
// (see scripts/seed-admin.js), never self-registered.
const express = require("express");
const authMiddleware = require("../middleware/auth.middleware");
const createRateLimiter = require("../middleware/rateLimit.middleware");
const authService = require("../services/auth.service");

const router = express.Router();

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many login attempts. Please try again later.",
});

// POST /api/auth/login
router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password are required",
    });
  }

  try {
    const result = await authService.login(email, password);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.cookie(
      authService.REFRESH_COOKIE_NAME,
      result.refreshToken,
      authService.refreshCookieOptions()
    );

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error("Admin login failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in",
    });
  }
});

// POST /api/auth/refresh
router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.[authService.REFRESH_COOKIE_NAME];

  try {
    const result = await authService.refresh(refreshToken);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.cookie(
      authService.REFRESH_COOKIE_NAME,
      result.refreshToken,
      authService.refreshCookieOptions()
    );

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error("Admin token refresh failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to refresh session",
    });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.[authService.REFRESH_COOKIE_NAME];

  try {
    const result = await authService.logout(refreshToken);

    res.clearCookie(authService.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: authService.REFRESH_COOKIE_PATH,
    });

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({ success: true, data: { message: "Logged out" } });
  } catch (error) {
    console.error("Admin logout failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log out",
    });
  }
});

// GET /api/auth/profile
router.get("/profile", authMiddleware, async (req, res) => {
  try {
    const result = await authService.getProfile(req.admin.adminId);

    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    console.error("Fetch admin profile failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch profile",
    });
  }
});

module.exports = router;
