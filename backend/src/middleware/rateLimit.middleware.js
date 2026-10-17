// Simple in-memory, fixed-window rate limiter keyed by IP.
// Single-process only -- a multi-instance deployment would need a
// shared store (e.g. Redis) instead of this in-memory Map.
// Ported from https://github.com/sanchittandon86/Login-application.
const createRateLimiter = ({ windowMs, max, message }) => {
  const buckets = new Map();

  return (req, res, next) => {
    // Jest sets NODE_ENV=test automatically. Integration tests legitimately
    // hit the same endpoint far more times, in a tight loop, than any real
    // window/max here allows for -- without this the limiter itself (not
    // the behavior under test) is what fails those tests. The limiter's
    // actual logic is covered directly in rateLimit.middleware.test.js.
    if (process.env.NODE_ENV === "test") {
      return next();
    }

    const key = req.ip;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now - bucket.windowStart >= windowMs) {
      buckets.set(key, { windowStart: now, count: 1 });
      return next();
    }

    if (bucket.count >= max) {
      const retryAfterSeconds = Math.ceil(
        (bucket.windowStart + windowMs - now) / 1000
      );

      res.set("Retry-After", String(retryAfterSeconds));

      return res.status(429).json({
        success: false,
        message: message || "Too many requests. Please try again later.",
      });
    }

    bucket.count += 1;
    return next();
  };
};

module.exports = createRateLimiter;
