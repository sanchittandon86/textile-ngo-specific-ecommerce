// Jest sets NODE_ENV=test, and the middleware itself bypasses rate
// limiting under that env (see rateLimit.middleware.js) so integration
// tests elsewhere aren't tripped up by hitting the same endpoint many
// times. That means this is the only place the limiter's actual
// window/max/429 logic gets exercised -- override NODE_ENV for the
// duration of this file so the real code path runs.
const originalNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";

const createRateLimiter = require("../src/middleware/rateLimit.middleware");

afterAll(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

function mockReq(ip = "1.2.3.4") {
  return { ip };
}

function mockRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("rateLimit.middleware", () => {
  test("allows requests under the limit", () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 3 });
    const req = mockReq();

    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      const next = jest.fn();
      limiter(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBeNull();
    }
  });

  test("rejects the request once max is exceeded, with a 429 and Retry-After header", () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 2, message: "Slow down" });
    const req = mockReq();

    limiter(req, mockRes(), jest.fn());
    limiter(req, mockRes(), jest.fn());

    const res = mockRes();
    const next = jest.fn();
    limiter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ success: false, message: "Slow down" });
    expect(res.headers["Retry-After"]).toBeDefined();
  });

  test("tracks separate IPs independently", () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1 });

    const resA1 = mockRes();
    limiter(mockReq("1.1.1.1"), resA1, jest.fn());
    expect(resA1.statusCode).toBeNull();

    const resB1 = mockRes();
    limiter(mockReq("2.2.2.2"), resB1, jest.fn());
    expect(resB1.statusCode).toBeNull();

    const resA2 = mockRes();
    limiter(mockReq("1.1.1.1"), resA2, jest.fn());
    expect(resA2.statusCode).toBe(429);
  });

  test("resets the count once the window elapses", () => {
    jest.useFakeTimers();

    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    const req = mockReq();

    limiter(req, mockRes(), jest.fn());

    const blocked = mockRes();
    limiter(req, blocked, jest.fn());
    expect(blocked.statusCode).toBe(429);

    jest.advanceTimersByTime(1001);

    const allowed = mockRes();
    const next = jest.fn();
    limiter(req, allowed, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(allowed.statusCode).toBeNull();

    jest.useRealTimers();
  });
});
