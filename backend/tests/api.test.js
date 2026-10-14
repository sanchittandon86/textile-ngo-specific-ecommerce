jest.mock("../src/config/db", () => ({
  query: jest.fn(),
}));

const request = require("supertest");
const pool = require("../src/config/db");
const app = require("../src/app");

describe("Public E-commerce APIs", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("GET / returns API welcome message", async () => {
    const response = await request(app).get("/");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test("GET /api/health returns healthy status", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });

    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  test("GET /api/categories returns active categories", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Bedsheets",
          slug: "bedsheets",
          image_url: null,
        },
      ],
    });

    const response = await request(app).get("/api/categories");

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].slug).toBe("bedsheets");
  });

  test("GET /api/products rejects invalid pagination", async () => {
    const response = await request(app).get(
      "/api/products?page=0&limit=12"
    );

    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("GET /api/products/search rejects an empty query", async () => {
    const response = await request(app).get(
      "/api/products/search"
    );

    expect(response.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  test("GET /api/products/search returns matching products", async () => {
    pool.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          name: "Floral Cotton Bedsheet",
          slug: "floral-cotton-bedsheet",
          price: "1499.00",
        },
      ],
      rowCount: 1,
    });

    const response = await request(app).get(
      "/api/products/search?q=bedsheet"
    );

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
    expect(response.body.data[0].slug).toBe(
      "floral-cotton-bedsheet"
    );
  });
});